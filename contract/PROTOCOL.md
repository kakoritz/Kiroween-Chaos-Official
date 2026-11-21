> **Contract v1.1 (additive) is in `contract/V1_1.md` and wins where it differs** (pace slow, travel gaps, laps, reviews, decisions, new faults, new endpoints, rules 40 to 47).

# Protocol (contract v1, complete)

Part of the contract. Read with [CONTRACT.md](CONTRACT.md). **Where this file differs from CONTRACT.md, this file wins.** Changes follow the contract rules in `docs/SWIMLANES.md`.

## Transport

- REST and SSE on `http://127.0.0.1:7070`. CORS allows any `http://localhost:*` and `http://127.0.0.1:*` origin so the UI dev server (port 5173) can call it.
- UI static files: core serves `packages/arena-ui/dist/` at `/`. The build uses relative asset paths (`base: './'`) so GitHub Pages can host it.
- In `mode: "browser"` there is no HTTP. The UI uses `window.__haunt`, which has the same operations as the REST calls (`getState()`, `startWave(opts)`, `chaos(opts)`, and so on) and `subscribe(fn, {since})`. The UI API client has one `transport` switch (`http` or `inpage`). Everything else is identical.
- Internal ports the UI never calls: provider 7071, helpdesk 7072, chaos proxies 7073 and up.

## SSE details

- `GET /api/events?since=<seq>`, `Content-Type: text/event-stream`. One JSON event per `data:` line.
- First message: `{"type":"hello","contractVersion":1,"mode":"live","seq":812,"app":"orders"}`.
- Heartbeat: a `: ping` comment every 15 s.
- The server keeps the last 5000 events. If `since` is older, it answers `410 {error:{code:"gone"}}`. The UI then reloads `GET /api/state` and subscribes without `since`.
- `seq` strictly increases for the life of the server process. A new **run** (server restart, app switch, or `POST /_mock/reset`) emits `{"type":"reset"}` and the UI clears its state. A new **wave** does not emit `reset`.
- `ts` is server epoch ms. The UI must not use its own clock for ordering.

## Event types (full list)

| type | detail | when |
|---|---|---|
| `hello` | see above | first message |
| `reset` | `{}` | server started a new run |
| `wave_start` | `{orders, seed, tiers: "race"\|"allPhoenix", lanes, speed, app, pace}` | wave begins |
| `wave_end` | `{summary: {lane: {score, completed, failed, parked, quarantined, repeats}}, stopped?}` | wave ends |
| `lane_ready` | `{tier, label, parts: [partId]}` | once per lane after `wave_start` |
| `order_start` | `{index, total}` | lane picks the next order |
| `stage_start` | `{attempt}` | stage begins |
| `stage_progress` | `{pct, label}` | 0..100, at least every 300 ms during a stage |
| `stage_done` | `{ms, skipped, reconciled?}` | `skipped: true` when replayed from the journal |
| `stage_fail` | `{error, retryable, attempt, degraded?}` | stage errored |
| `chaos` | `{creature, fault, scope, depth, injectedAt, source, deferred?}` | fault armed. `source`: `user`, `random`, `boss`, `demo`, `sweep` |
| `chaos_absorbed` | `{creature, fault, reason}` | fault had no visible effect (disk_full on a tier with no journal, a slow link under the timeout) |
| `process_dead` | `{reason, restartInMs}` | bot process killed |
| `process_up` | `{attempt}` | bot restarted |
| `recover_start` | `{action: "replay"\|"reconcile"\|"retry"\|"backoff"\|"restart", depth}` | recovery begins |
| `recover_done` | `{action, ms, depth}` | recovery ended |
| `effect` | `{kind, key, amount?, replayed}` | a side effect row was created. `replayed: true` if the provider returned an existing row by key (no new row) |
| `repeat` | `{kind, key, count}` | the ledger has more than one row for the same effect. `count` is the total rows |
| `breaker` | `{service, state: "open"\|"half_open"\|"closed"}` | circuit breaker change |
| `order_done` | `{clean, ms, repeats}` | order completed |
| `order_failed` | `{stage, error}` | order failed, lane continues |
| `order_parked` | `{stage, reason}` | order set aside (offline queue) |
| `order_resumed` | `{stage}` | a parked order restarts |
| `order_quarantined` | `{stage, reason}` | poison order set aside for good |
| `order_abandoned` | `{}` | lane halted before this order started |
| `lane_halted` | `{reason}` | lane stopped. No more events for it except `order_abandoned` |
| `part_added` | `{part, source: "hardening_spec"\|"manual", spec?}` | a tier started using a part it did not use before |
| `boss_warning`, `boss_start`, `boss_end` | `{boss, startsInMs?, durationMs?}` | `startsInMs` is 8000 ms at 1x, so real ms are `8000 / speed` (rule 21) |
| `score` | `{delta, total, reason}` | after the event that caused it |
| `hardening_spec` | `{spec, title, path, findings}` | the reviewer wrote a hardening spec |
| `fix_applied` | `{spec, files: [{path, add, del}], recorded}` | Kiro applied the spec (or a recorded fix was applied in browser mode) |

Effect kinds: `account_create`, `charge`, `email`, `dispatch`, `notify`, `ticket`.

## Ordering rules (checked by `npm run validate:events`)

1. `hello`, then optional `reset`, then `wave_start`. `wave_end` is the last event **of its wave** (several waves can follow in one stream, rule 26). One `lane_ready` per lane after `wave_start`.
2. Per (lane, order): `order_start`, then stages in pipeline order. Each stage is `stage_start`, zero or more `stage_progress`, then `stage_done` or `stage_fail`. A skipped stage is a `stage_start` directly followed by `stage_done{skipped:true}` (rule 27). A stage left open by a kill has no terminal event until the restart (rule 6).
3. After `stage_fail`, exactly one of: `recover_start{retry|backoff}` then `recover_done`, after which **the same stage continues** (no new `stage_start`; it ends in `stage_done` or another `stage_fail`); or `order_failed`; or `order_parked`; or `order_quarantined`; or `lane_halted`; or, if `degraded:true`, the next stage's `stage_start`. A new `stage_start` (higher `attempt`) appears only when a stage restarts from the top (after a restart, a resume, or an order restart).
4. After `order_failed`, `order_parked` or `order_quarantined` the lane emits `order_start` for the next order, or the lane is done.
5. `order_done` comes right after the last stage's `stage_done` (`handoff` or `archive`).
6. `process_dead` is followed by `process_up`. Between them that lane emits no stage events. **`process_dead` implicitly closes the lane's open stage as killed** (no terminal event is emitted for it; validators treat it as closed). After `process_up` come `recover_start{action:"replay"}`, then skipped-stage pairs (rule 27), then any reconcile pair (rule 13), then `recover_done{replay}` (nested pairs close last in, first out, rules 13 and 30). A tier with no journal emits `recover_start{action:"restart"}`, `recover_done`, then `stage_start` at stage 1.
7. Every `chaos` is followed in the same lane by one of: `chaos_absorbed`, `stage_fail`, `process_dead`, `recover_start`, `lane_halted`, `order_parked`.
8. `effect` is emitted after the provider call returns. If the request was processed but timed out, `effect` is emitted and the timeout `stage_fail` follows it. `repeat` immediately follows the `effect` that caused it.
9. `score` follows the event that caused it. `score.total` is the lane total after the delta.
10. `boss_warning` precedes `boss_start` by `startsInMs`. `boss_start` is followed by one `chaos{source:"boss"}` per lane. `boss_end` comes after all lanes settled.
11. `order_parked` is followed later by `order_resumed`, unless the wave ends first.
12. A lane's events are totally ordered by `seq`. Events from different lanes interleave.

## `GET /api/state` response

```json
{
  "contractVersion": 1, "mode": "live", "app": "orders",
  "wave": {"n": 1, "running": true, "seed": 7, "speed": 1, "orders": 12, "tiers": "race", "startedAt": 1760000000000},
  "chaos": {"mode": "manual", "frequency": 0.3, "seed": 7},
  "stages": [{"id": "intake", "label": "Order intake", "icon": "mail", "workAnimation": "read_mail"}],
  "lanes": [{
    "lane": 1, "tier": "rookie", "label": "Rookie", "state": "working",
    "order": "ord-0004", "stage": "payment", "stageIndex": 2,
    "orderIndex": 4, "ordersTotal": 12, "score": 340,
    "counts": {"completed": 3, "failed": 0, "parked": 0, "quarantined": 0, "repeats": 1},
    "depth": 0,
    "parts": [{"id": "retry", "label": "Lantern", "installed": false}]
  }],
  "boss": {"next": "boss_power_outage", "startsInMs": null, "active": false},
  "demo": {"scripts": ["hero", "full", "loop"], "running": null}
}
```

- `lane.state`: `idle | working | recovering | dead | halted | done`.
- `workAnimation` ids for orders: `read_mail, fill_form, swipe_card, write_letter, load_scooter, send_bubbles, scooter_road, doorstep`. For the inbox: `read_mail, think, file_ticket, write_letter, send_letter, archive_box`. The UI must have a generic fallback for an unknown id.
- Part labels (gear): `journal` Spellbook, `idempotency` Seal, `retry` Lantern, `breaker` Shield, `offline_queue` Coffin Stash. Labels come from the server.

## REST: request and response shapes

| Call | Request | Success response |
|---|---|---|
| `POST /api/wave/start` | `{orders?: 12, seed?: int, tiers?: "race"\|"allPhoenix", lanes?: 1..5, speed?: 0.5\|1\|2\|4, pace?: "normal"\|"show", app?: "orders"\|"inbox"}` | `200 {wave: n}` |
| `POST /api/wave/stop` | none | `200 {}` |
| `POST /api/speed` | `{speed}` (0.5, 1, 2 or 4) | `200 {speed}` |
| `POST /api/chaos` | `{lane?, creature?, fault?, scope?: "inner"\|"outer", point?}` (`lane` may be omitted only for a boss fault, which fires on all lanes after the 8 s warning) | `200 {chaosId, creature, fault, depth, deferred}` |
| `POST /api/chaos/mode` | `{mode: "off"\|"manual"\|"random", frequency?: 0..1, seed?}` | `200 {}` |
| `POST /api/demo/start` | `{script: "hero"\|"full"\|"loop", speed?}` (in **mock mode** any fixture name is also accepted) | `200 {}` |
| `POST /api/demo/stop` | none | `200 {}` |
| `GET /api/creatures` | | `[{id, label, family, sprite, causes: [fault], boss: bool, apps: ["orders","inbox"], description}]` |
| `GET /api/apps` | | `[{id, label, stages}]` |
| `POST /api/app` | `{app}` | `200 {}` |
| `GET /api/lane/:lane/stage/:stage?order=` | | `{lane, order, stage, status, attempts: [{attempt, startTs, endTs, status, error?}], events: [], effects: [], chaos: [], recover: [], journal: []}` |
| `GET /api/lane/:lane/log?order=&since=` | | `{lines: [{seq, ts, level, type, stage, order, text}]}`, `level` is `info\|warn\|error\|good` |
| `GET /api/ledger` | | `{lanes: [{lane, byKind: {charge: {rows, repeats}}, rows: []}]}` |
| `GET /api/waves` | | `[{n, startedAt, endedAt, grade?, grades?: {lane: grade}, score}]` where `grade` is the **worst lane grade** |
| `GET /api/waves/:n/report` | | report JSON (see `.kiro/specs/engine/runtime.md` section 9) |
| `GET /api/waves/:n/compare/:m` | | `{a: {score, grade, repeats}, b: {}, cells: []}` |
| `GET /api/waves/:n/postmortem` | | `text/markdown`, or `404 {error:{code:"not_ready"}}` before the wave ends |

Errors: `{"error":{"code","message"}}`. Codes: `no_wave` (409), `wave_running` (409), `bad_lane` (400), `bad_creature` (400), `bad_fault` (400), `not_applicable` (409, only when a fault cannot be deferred), `depth_limit` (409), `bad_request` (400), `gone` (410).

`POST /api/chaos` with neither `creature` nor `fault` picks a random applicable one. A `creature` with several faults picks one (random, seeded). `chaos` detail uses the fields `creature` and `fault`.

## Demo mode

- `POST /api/demo/start {script}` runs a **scripted fault plan** on a fixed seed with the real engine (live) or replays the matching fixture (mock). The UI never contains its own script. It calls this and renders events.
- `hero`: about 75 s at 1x (show pacing, 5 orders). Calm race, Payment crash on lanes 1 and 5, ledger compare. See `STORYBOARDS.md`.
- `full`: about 165 s at 1x (show pacing, 11 orders). Hero, then stacked chaos on lane 5, then the Lich boss, then wave end. After `wave_end` the UI shows the postmortem from `/api/waves/:n/postmortem`.
- Demo `chaos` events carry `source: "demo"`.

## What the mock server must do

1. Serve every endpoint above with valid data.
2. `GET /api/events` replays a fixture by default (`calm`).
3. `POST /api/chaos` runs a small simulator that follows `.kiro/specs/engine/acceptance.md` table A for the given tier and fault, emitting valid events with plausible timing. No real processes needed. The UI therefore sees correct outcomes for every creature.
4. `POST /api/demo/start` replays the named fixture.
5. `GET /api/health` returns `mode: "mock"`.
6. Passes the same contract test suite as live (`npm run test:contract`).

## Fixtures

Generated by `tools/make-fixtures.ts` from `STORYBOARDS.md`, not typed by hand, so timing and ordering are consistent. Part of task H0.

## Amendments (complete the protocol; these rules apply together with the rules above)

### More ordering rules
13. Recovery pairs may nest and close last in, first out: `recover_start{replay}`, skipped `stage_done` events, `recover_start{reconcile}`, `effect{replayed:true}`, `recover_done{reconcile}`, `recover_done{replay}`.
14. The followers allowed after a `chaos` also include `order_failed`, `order_quarantined`, `order_abandoned` and `recover_start`. A duplicate request skipped by a journal emits `chaos_absorbed{reason:"duplicate skipped by journal"}`.
15. `effect{replayed:true}` is also used when a reconcile lookup found the existing row (no provider write happened).
16. Envelope: `lane` is **absent** (never null) for global events: `hello, reset, wave_start, wave_end, boss_warning, boss_start, boss_end, hardening_spec, fix_applied`. All other events carry `lane`. `wave` is present on every event except `hello` and `reset`.
17. `GET /api/events?since=N` is exclusive (returns events with `seq > N`). Unknown event types and unknown fields are ignored by clients.
18. `boss` in boss events is the **fault id** (`boss_power_outage`, ...). The creature to draw comes from `/api/creatures` (`causes` contains that fault id), and the `chaos` events of a boss carry `creature` (`lich`, ...).
19. Stage ids: orders app `intake, account, payment, confirmation, dispatch, updates, tracking, handoff`. Inbox app `fetch, classify, ticket, draft, reply, archive`. Icons: orders `mail, user, card, envelope, box, bubbles, road, door`; inbox `mail, brain, ticket, envelope, plane, archive`. Inbox work animations: `read_mail, think, file_ticket, write_letter, send_letter, archive_box`.

### Inspector response (exact shapes)
`GET /api/lane/:lane/stage/:stage?order=` returns
```
{lane, order, stage, status: "pending"|"active"|"done"|"failed"|"dead"|"parked"|"quarantined",
 input:  {order: {id, email, items, total}} | null,
 output: {id: "ch_12", ...} | null,
 attempts: [{attempt, startTs, endTs, status: "done"|"failed"|"killed", error?}],
 events:  [<contract events for this lane, order, stage>],
 effects: [{ts, kind, key, amount?, replayed, rowId}],
 chaos:   [<chaos events that hit this stage>],
 recover: [<recover_start and recover_done events>],
 journal: [{t, ts, ...record}]}
```
`GET /api/lane/:lane/orders` returns the order ids this lane has processed so far, with their outcome (`done|failed|parked|quarantined|abandoned|active`), for the inspector's order picker.

### Compare, report, hardening
- `GET /api/waves/:n/compare/:m` returns `{a:{score,grade,repeats}, b:{score,grade,repeats}, cells:[...]}`. For **sweep reports** each cell is `{stage, fault, point?, a, b, change}` with matrix result codes. For **wave comparisons** each cell is `{lane, tier, a:{grade,score,repeats}, b:{grade,score,repeats}, change: "improved"|"worse"|"same"}`.
- `GET /api/waves/:n/report` returns the report JSON defined in `.kiro/specs/engine/runtime.md` section 9.
- `GET /api/waves/:n/hardening` returns `{spec, title, files:[{path, content}]}` (the hardening spec the reviewer wrote), or `404 {error:{code:"not_ready"}}`.
- `GET /api/lane/:lane/log` line `text` is a short sentence generated by the server from the event (for example "Payment failed: 503 from provider (attempt 2)").

### Demo script `loop` (new)
About 130 s at show pacing. Wave 1: 4 orders, 2 lanes (lane 1 Rookie, lane 2 Phoenix), crash on both at Payment `after_effect_before_journal` on **every order**. Rookie repeats. `wave_end`. Then `hardening_spec`, `fix_applied` (recorded), `part_added` x3 on lane 1 (`retry`, `journal`, `idempotency`), then wave 2 with the same crash on every order: lane 1 is now clean. Wave grades go from F to A. The UI shows the compare view.

### Mock requirements added (H0)
In addition to the earlier list the mock must provide: fixtures for **parked** (Phoenix A13), **breaker**, **part_added**, **chaos_absorbed**, **deferred chaos**, all three bosses, the **inbox** app (2 lanes), `full`, `loop`, a **stress** stream (200 events per second for 30 s), sample **reports** (waves 1 and 2, grades F and A), a sample **postmortem**, a sample **hardening spec**, `POST /_mock/fault {kind: "drop_sse"|"gone"|"slow"}` to test client transport errors, and a stub `window.__haunt` implementation in `packages/core/inpage-stub.js` for Lane B to develop the in-page transport against. The mock handles `POST /api/wave/start` with any parameters by scaling the fixture timeline (orders, lanes, speed) and ignoring seeds beyond naming.

### Error codes (complete)
`no_wave` (409), `wave_running` (409), `bad_lane` (400), `bad_creature` (400), `bad_fault` (400), `lane_not_active` (409, chaos on a halted, done or idle lane), `not_applicable` (409), `depth_limit` (409), `not_ready` (404), `bad_request` (400), `gone` (410). `POST /api/app` while a wave runs returns `wave_running`.

### More rules (round 2)
20. Every `chaos` is closed by exactly one of its consequences (rule 7 and 14) **or** by a `chaos_absorbed` when the fault caused no failure. For `duplicate_request` on a tier with no journal (it is processed twice) the closer is `chaos_absorbed{reason:"processed twice"}`. For `disk_full` on a tier that retries its journal write, `chaos_absorbed{reason:"journal write retried"}`.
21. **All millisecond values in events are real wall-clock ms**, already divided by `speed` (`restartInMs`, `startsInMs`, `durationMs`, `ms`).
22. **Max chaos depth is 5.** Pressing again returns `depth_limit`. `depth` resets to 0 when the process comes back up (`process_up`).
23. `order_resumed` is always followed by an `order_start` for the same order when the lane picks it up.
24. Boss faults on a lane that cannot be hit now (for example hazard storm while a lane is not at dispatch or tracking) emit `chaos{deferred:true}` and land at the next applicable stage.

### Mock server modes and selectors (answers to "how do I load a fixture")
The mock has two modes.
- **sim** (default at boot and after `POST /api/wave/start`): a simulator builds a synthetic wave from the stage duration model and accepts chaos. `POST /api/chaos` hits that lane's current stage and applies the outcome template for (tier, fault) from acceptance table A. `POST /api/chaos {fault:"boss_*"}` (no lane) emits `boss_warning`, waits `startsInMs`, then emits `boss_start` and one `chaos{source:"boss"}` per lane with the outcome of that fault for each lane's current stage. `POST /api/chaos/mode {mode:"random"}` makes it fire `source:"random"` chaos at the given frequency. Fresh boot has an idle quiet state.
- **replay** (after `POST /api/demo/start {script}` or `POST /_mock/fixture {name}`): a fixture plays at `speed`. Chaos presses during a replay return `409 {error:{code:"bad_request", message:"replay mode"}}`.
- `GET /_mock/fixtures` lists fixture names. `POST /_mock/fixture {name}` loads one. `POST /_mock/reset {samples: true|false}` returns to sim mode; with `samples:false` `GET /api/waves` is empty (empty state), with `true` (default) waves 1 and 2 exist with sample reports, postmortems and a hardening spec.
- `POST /_mock/fault {kind: "drop_sse"|"gone"|"slow"|"version"|"unreachable"}`: `version` makes `hello` report `contractVersion: 2`.
- Fixtures named in this protocol that exist: `calm, hero-crash, stacked-chaos, boss-power, meltdown, full, loop, parked, absorbed, deferred, boss-internet, boss-storm, inbox, stress, breaker, part-added`.

### Round 3 rules
25. `stage_fail` may carry `degraded: true` (non-critical stage such as `updates`). A degraded `stage_fail` may be followed directly by the next `stage_start`.
26. A stream can contain **several waves**: `wave_end` is the last event **of its wave**. Events about a finished wave (`hardening_spec`, `fix_applied`, `part_added`) carry that wave number. The next `wave_start` continues `seq` with no `reset`.
27. A skipped stage is always a pair: `stage_start{attempt}` immediately followed by `stage_done{skipped:true}` (no progress between). A stage finished by reconcile is `stage_start`, the reconcile events, then `stage_done{skipped:false, reconciled:true}`.
28. `chaos` is emitted **when the fault is armed (the press)**, before any consequence. `injectedAt` is the phase where it will fire: `before | during | after_effect | recovery`. A crash-family `chaos` therefore comes before the `effect` of its stage.
29. `attempt` on `stage_start` is assigned by the server: the count of earlier `stage_start` events for that lane, order and stage, plus 1. It keeps counting across restarts.
30. Recovery pairs may nest (rule 13): each `recover_start` has its own `recover_done`, closed last in, first out. In the hero beat there are two `recover_done` for lane 5.
31. `recover_start.depth` and `recover_done.depth` are the current stack depth at that time, so 0 is possible after a restart.
32. **Lane to tier mapping** (also in `engine/runtime.md` section 11): race mode with 5 lanes is lane n = tier n (1 Rookie to 5 Phoenix). With fewer lanes: 1 lane Phoenix; 2 lanes Rookie, Phoenix; 3 lanes Rookie, Journaler, Phoenix; 4 lanes Rookie, Retrier, Journaler, Phoenix. `allPhoenix`: all lanes Phoenix. The UI reads tier names from `lane_ready`. `lanes` accepts 1 to 5 for every app.
33. **All millisecond values are real wall-clock ms**, and reports normalize durations to 1x (runtime.md section 17).

### `window.__haunt` (exact functions; each mirrors the REST call of the same name and returns a Promise of the JSON body, or rejects with `{code, message}`)
`getHealth()`, `getState()`, `startWave(opts)`, `stopWave()`, `setSpeed(speed)`, `chaos(opts)`, `setChaosMode(opts)`, `startDemo(script)`, `stopDemo()`, `getCreatures()`, `getApps()`, `setApp(app)`, `getLaneStage(lane, stage, order)`, `getLaneLog(lane, opts)`, `getLaneOrders(lane)`, `getLedger()`, `getWaves()`, `getReport(n)`, `getCompare(n, m)`, `getPostmortem(n)`, `getHardening(n)`, and `subscribe(fn, {since}) -> unsubscribe`.

### Mock corrections
- A fresh mock boot streams only `hello` (quiet) until a wave starts, a demo starts, or a fixture is loaded. (This replaces "replays `calm` by default".)
- In the mock, `POST /api/wave/start` runs the **simulator** (a synthetic wave built from the duration model). It does not scale a fixture.
- Demo script lengths: `hero` 5 orders about 75 s, `full` 9 orders about 165 s, `loop` 3 orders per wave about 125 s in total, all show pace.

### Round 4 rules and shapes
34. **In-stage retries** emit `stage_fail`, `recover_start{retry|backoff}`, `recover_done` and the same stage goes on (rule 3). The UI chip shows retrying from `recover_start`.
35. **Idle state** (`GET /api/state` when no wave exists): `wave: null`, `lanes: []`, `boss: {next: null, startsInMs: null, active: false}`, `chaos` at its defaults, `stages` for the current app, `demo: {scripts: [...], running: null}`.
36. **Wave grade:** `GET /api/waves` `grade` is the worst lane grade; `grades` has each lane. See `engine/runtime.md` section 23.
37. **Detail fields** (in addition to the table): `stage_done.reconciled`, `stage_fail.degraded`, `chaos.deferred`, `wave_end.stopped`, `wave_end.summary[lane].grade`, `process_dead.restartInMs`.
38. Fault lifecycle, the `input_read` hook, waves isolation, and live `part_added` timing are in `engine/runtime.md` sections 29 to 32.
39. Demo script lengths: `hero` 5 orders about 75 s, `full` 9 orders about 165 s, `loop` 3 orders per wave about 125 s, all show pace.
