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
- `seq` strictly increases for the life of the server process. A new run emits `{"type":"reset"}` and the UI clears its state.
- `ts` is server epoch ms. The UI must not use its own clock for ordering.

## Event types (full list)

| type | detail | when |
|---|---|---|
| `hello` | see above | first message |
| `reset` | `{}` | server started a new run |
| `wave_start` | `{orders, seed, tiers: "race"\|"allPhoenix", lanes, speed, app}` | wave begins |
| `wave_end` | `{summary: {lane: {score, completed, failed, parked, quarantined, repeats}}}` | wave ends |
| `lane_ready` | `{tier, label, parts: [partId]}` | once per lane after `wave_start` |
| `order_start` | `{index, total}` | lane picks the next order |
| `stage_start` | `{attempt}` | stage begins |
| `stage_progress` | `{pct, label}` | 0..100, at least every 300 ms during a stage |
| `stage_done` | `{ms, skipped}` | `skipped: true` when replayed from the journal |
| `stage_fail` | `{error, retryable, attempt}` | stage errored |
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
| `boss_warning`, `boss_start`, `boss_end` | `{boss, startsInMs?, durationMs?}` | `startsInMs` is 8000 |
| `score` | `{delta, total, reason}` | after the event that caused it |

Effect kinds: `account_create`, `charge`, `email`, `dispatch`, `notify`, `ticket`.

## Ordering rules (checked by `npm run validate:events`)

1. `hello`, then optional `reset`, then `wave_start`. `wave_end` is last. One `lane_ready` per lane after `wave_start`.
2. Per (lane, order): `order_start`, then stages in pipeline order. Each stage is `stage_start`, zero or more `stage_progress`, then `stage_done` or `stage_fail`. A `stage_done` with `skipped: true` has no progress.
3. After `stage_fail`, exactly one of: `recover_start`, then `recover_done`, then `stage_start` with `attempt + 1`; or `order_failed`; or `order_parked`; or `order_quarantined`; or `lane_halted`.
4. After `order_failed`, `order_parked` or `order_quarantined` the lane emits `order_start` for the next order, or the lane is done.
5. `order_done` comes right after the last stage's `stage_done` (`handoff` or `archive`).
6. `process_dead` is followed by `process_up`. Between them that lane emits no stage events. After `process_up` come `recover_start{action:"replay"}`, then one `stage_done{skipped:true}` per journaled stage, then `recover_done`. A tier with no journal emits `recover_start{action:"restart"}`, `recover_done`, then `stage_start` at stage 1.
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
  "demo": {"scripts": ["hero", "full"], "running": null}
}
```

- `lane.state`: `idle | working | recovering | dead | halted | done`.
- `workAnimation` ids for orders: `read_mail, fill_form, swipe_card, write_letter, load_scooter, send_bubbles, scooter_road, doorstep`. For the inbox: `read_mail, think, file_ticket, write_letter, send_letter, archive_box`. The UI must have a generic fallback for an unknown id.
- Part labels (gear): `journal` Spellbook, `idempotency` Seal, `retry` Lantern, `breaker` Shield, `offline_queue` Coffin Stash. Labels come from the server.

## REST: request and response shapes

| Call | Request | Success response |
|---|---|---|
| `POST /api/wave/start` | `{orders?: 12, seed?: int, tiers?: "race"\|"allPhoenix", lanes?: 1..5, speed?: 0.5\|1\|2\|4, app?: "orders"\|"inbox"}` | `200 {wave: n}` |
| `POST /api/wave/stop` | none | `200 {}` |
| `POST /api/speed` | `{speed}` | `200 {speed}` |
| `POST /api/chaos` | `{lane, creature?, fault?, scope?: "inner"\|"outer", point?}` | `200 {chaosId, creature, fault, depth, deferred}` |
| `POST /api/chaos/mode` | `{mode: "off"\|"manual"\|"random", frequency?: 0..1, seed?}` | `200 {}` |
| `POST /api/demo/start` | `{script: "hero"\|"full", speed?}` | `200 {}` |
| `POST /api/demo/stop` | none | `200 {}` |
| `GET /api/creatures` | | `[{id, label, family, sprite, causes: [fault], boss: bool, description}]` |
| `GET /api/apps` | | `[{id, label, stages}]` |
| `POST /api/app` | `{app}` | `200 {}` |
| `GET /api/lane/:lane/stage/:stage?order=` | | `{lane, order, stage, status, attempts: [{attempt, startTs, endTs, status, error?}], events: [], effects: [], chaos: [], recover: [], journal: []}` |
| `GET /api/lane/:lane/log?order=&since=` | | `{lines: [{seq, ts, level, type, stage, order, text}]}`, `level` is `info\|warn\|error\|good` |
| `GET /api/ledger` | | `{lanes: [{lane, byKind: {charge: {rows, repeats}}, rows: []}]}` |
| `GET /api/waves` | | `[{n, startedAt, endedAt, grade?, score}]` |
| `GET /api/waves/:n/report` | | report JSON (see `.kiro/specs/engine/design.md` section 8) |
| `GET /api/waves/:n/compare/:m` | | `{a: {score, grade, repeats}, b: {}, cells: []}` |
| `GET /api/waves/:n/postmortem` | | `text/markdown` |

Errors: `{"error":{"code","message"}}`. Codes: `no_wave` (409), `wave_running` (409), `bad_lane` (400), `bad_creature` (400), `bad_fault` (400), `not_applicable` (409, only when a fault cannot be deferred), `depth_limit` (409), `bad_request` (400), `gone` (410).

`POST /api/chaos` with neither `creature` nor `fault` picks a random applicable one. A `creature` with several faults picks one (random, seeded). `chaos` detail uses the fields `creature` and `fault`. (The earlier table in CONTRACT.md says `monkey`. That is stale.)

## Demo mode

- `POST /api/demo/start {script}` runs a **scripted fault plan** on a fixed seed with the real engine (live) or replays the matching fixture (mock). The UI never contains its own script. It calls this and renders events.
- `hero`: about 60 s at 1x. Calm race, Payment crash on lanes 1 and 5, ledger compare. See `STORYBOARDS.md`.
- `full`: about 170 s at 1x. Hero, then stacked chaos on lane 5, then the Lich boss, then wave end. After `wave_end` the UI shows the postmortem from `/api/waves/:n/postmortem`.
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
