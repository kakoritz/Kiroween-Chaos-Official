> **Play-test v2 changes:** pace `slow`, travel scheduler (`hold`), scoring v2, new faults, wrong-order decisions: see `.kiro/specs/playtest-v2/design.md`. Where it differs from sections 8, 23 and 33 here, the play-test v2 file wins.

# Engine runtime contract (Lane A)

Closes the gaps between `engine/design.md` (the rules) and code. If this file and `design.md` differ, **this file wins**. Read after `design.md`.

## 1. How a bot runs

- **Bots are TypeScript, bundled with esbuild.** `npm run build:bots` writes `dist/bots/<tier>.js` (one self-contained file per bot, also usable as a Web Worker entry). No `tsx`, no wrapper.
- The runner spawns **`process.execPath dist/bots/<tier>.js` directly** (no shell, no `npx`, `windowsHide: true`). The pid it kills is the real bot, so SIGKILL on Windows and Linux hits the right process.
- **All five bots use the SDK.** A bot file looks like this (illustrative signature, exact types are Lane A's):
```ts
import { defineBot, retry, journal, idempotency } from '@haunt/sdk';
export default defineBot({
  tier: 'reconciler',
  use: [retry({ attempts: 3, delayMs: 500 }), journal(), idempotency()],
  async process(order, sdk) {
    await sdk.stage('intake',  async s => s.readOrderFile());
    await sdk.stage('account', async s => s.effect('account_create', { key: s.key('account') }));
    await sdk.stage('payment', async s => s.effect('charge', { amount: order.total, key: s.key('charge') }));
    // ...
  },
});
```
- `sdk.stage()` and `s.effect()` always exist and always provide the hooks, events and parts report. **Parts are code the bot opts into** with `use([...])` and by passing `key:`. A Rookie has `use: []` and passes no keys, so the SDK is a passthrough for it: no journal writes, no retries, no keys. This is how a bare Rookie still reaches crash points, and how the SDK reports which parts a bot used (from `use()` and from `key:` presence).
- The **hardening fix is a real code edit**: add `retry(...)`, `journal()`, `idempotency()` to `use`, and add `key: s.key('charge')` to each effect call. The diff is small but it is real source.
- Entry: the bundle calls `defineBot(...)`'s runner, which reads the environment below and runs until all orders are processed or it is killed.

### Spawn environment (all bots, TS and Python)

| Variable | Meaning |
|---|---|
| `HAUNT_RUN_DIR` | Run folder (journals, logs) |
| `HAUNT_LANE` | Lane number 1..5 |
| `HAUNT_TIER` | `rookie` ... `phoenix` |
| `HAUNT_SEED` | Wave seed (integer) |
| `HAUNT_PROVIDER` | Provider base URL, default `http://127.0.0.1:7071` |
| `HAUNT_ORDERS_DIR` | This lane's input folder (see section 5) |
| `HAUNT_SPEED` | Speed multiplier |
| `HAUNT_ATTEMPT` | Restart count for this lane's process, 1 on first start |
| `HAUNT_CONCURRENCY` | Orders in flight, default 1 (only `ramp` raises it) |

## 2. Bot and runner channel

JSON lines (one object per line, UTF-8). Bot to runner on **stdout**, runner to bot on **stdin**. Logs go to stderr. In the browser the same objects go over `postMessage`.

**Bot to runner.** An event-shaped object without the envelope. The runner adds `seq`, `ts`, `wave`, `lane` and forwards it as a contract event.
```
{"type":"stage_start","order":"ord-0001","stage":"payment","detail":{"attempt":1}}
{"type":"stage_progress","order":"...","stage":"...","detail":{"pct":40,"label":"Charging"}}
```
Bots emit: `order_start`, `stage_start`, `stage_progress`, `stage_done`, `stage_fail`, `recover_start`, `recover_done`, `order_done`, `order_failed`, `order_parked`, `order_resumed`, `order_quarantined`, `lane_halted`, `breaker`.
Bots also emit control messages (not forwarded): `{"k":"hello","tier":"...","parts":["retry","journal"],"pid":123}` at start, `{"k":"at_point","point":"after_effect_before_journal","order":"...","stage":"payment","id":"<armId>"}`, `{"k":"reconciled","kind":"charge","key":"..."}`, `{"k":"duplicate_skipped","order":"..."}`, `{"k":"absorbed","reason":"journal write retried"}`, `{"k":"idle"}` when the lane has no more work.
`stage_progress` is emitted at least every 300 ms during a stage.

**The runner, not the bot, emits** (from the provider ledger and its own state): `effect`, `repeat`, `chaos`, `chaos_absorbed`, `process_dead`, `process_up`, `score`, `wave_*`, `lane_ready`, `boss_*`, `part_added`. For `{"k":"reconciled"}` it emits `effect{replayed:true}`. For `duplicate_skipped` it emits `chaos_absorbed{reason:"duplicate skipped by journal"}`. For `absorbed` it emits `chaos_absorbed` with that reason. A duplicate processed twice by a no-journal bot is closed by the runner with `chaos_absorbed{reason:"processed twice"}` when that order finishes.

**Runner to bot (stdin):**
```
{"k":"arm","id":"c12","fault":"crash","point":"after_effect_before_journal","scope":"outer"}
{"k":"disarm","id":"c12"}
{"k":"speed","speed":2}
{"k":"shutdown"}
```

## 3. How chaos is armed and how a crash is real

**Kill rendezvous (deterministic real SIGKILL at an exact point):** when a crash fault is armed for a lane, the SDK, on reaching the armed hook, sends `at_point` and **blocks reading stdin**. The runner receives it and **SIGKILLs the bot**. If no crash is armed the SDK never blocks. A user press mid-run just sends `arm`; the SDK checks its armed list at every hook (the stdin listener runs asynchronously).

**Hooks** inside `sdk.stage` and `s.effect`, in this order for an effect stage:
`startup` (once per process, before the first order) → `stage_start` journaled → `before_effect` → `intent` journaled → provider call → `after_effect_before_journal` → `result` journaled → `after_journal` → `stage_done` journaled.
For stages with no effect: `mid_stage` (halfway through the work sleep).
Recovery hooks: `during_replay` (before replaying each journaled stage), `during_reconcile` (before each lookup), `during_backoff` (during each retry wait).

**Arming rules:**
- `crash`, `out_of_memory`, `power_outage` arm a **point**. Default `point` = the next hook reached. Explicit `point` is one of the hooks above.
- Provider faults (`timeout`, `http_*`, `endpoint_down`, `internet_outage`, `slow_link`, `hazard_event`, `driver_unreachable`) are applied by the runner as `POST /_fault` on the provider and do not need the bot. `scope: "inner"` simply means the fault is queued to hit the **next provider call made by recovery code** (reconcile lookup, retry, or replayed call): the runner sets `_fault` with `count:1` and `nextCaller: "recovery"` (the SDK adds header `X-Haunt-Phase: recovery` to calls made during recovery, `normal` otherwise).
- File faults (`missing_file`, `malformed_payload`, `duplicate_request`) act on the lane's input folder (section 5).
- `disk_full`: arm `{"fault":"disk_full"}`. The SDK's journal throws `ENOSPC` once on the next write. A bot with no `journal` ignores it, and the runner emits `chaos_absorbed`.
- **Inner crash:** fires at the next **recovery hook**. A bot with no recovery code (Rookie, Retrier, which just restart) has the hook `startup` as its recovery hook, so an inner crash kills it again at startup before any work. Restart delay doubles per nested crash, cap 8000 ms.
- A fault that cannot apply to the current stage is deferred (engine design section 5) and the `chaos` event carries `deferred: true`.

## 4. Provider API (exact)

All on `127.0.0.1:7071`. JSON. Every call includes `lane` and `order`. Base latency per call: seeded `uniform(20, 100)` ms.

| Call | Body | 2xx response |
|---|---|---|
| `POST /accounts` | `{lane, order, email}` | `201 {id:"acct_<n>"}` |
| `POST /charges` | `{lane, order, amount}` (amount in cents) | `201 {id:"ch_<n>", amount}` |
| `POST /emails` | `{lane, order, template}` | `201 {id:"em_<n>"}` |
| `POST /shipments` | `{lane, order}` | `201 {id:"sh_<n>"}` |
| `POST /notifications` | `{lane, order, index}` | `201 {id:"nt_<n>", index}` |
| `POST /tickets` | `{lane, order, class}` | `201 {id:"tk_<n>"}` |
| `POST /replies` | `{lane, order}` | `201 {id:"rp_<n>"}` |
| `GET /tracking/:shipment?lane=` | none | `200 {status:"in_transit", pct}` for polls 1..4, `{status:"delivered", pct:100}` on poll 5 |
| `GET /lookup?lane=&kind=&key=` | none | `200 {found:true,row}` or `200 {found:false}` |
| `GET /ledger?lane=` | none | `200 {rows:[...]}` |
| `POST /_fault` | see below | `200 {}` |
| `POST /_reset` | none | `200 {}` |

- **Idempotency:** header `Idempotency-Key: <order>:<effectKey>` where `effectKey` is `account`, `charge`, `email`, `dispatch`, `notify:1`, `notify:2`, `ticket`, `reply`. Same key in the same lane gives the **original response** and header `Idempotent-Replayed: true`, no new row.
- **Rows are written only for processed requests.** 404, 429, 500, 503 and dropped connections are **not processed** (no row). A latency fault over the client timeout (1500 ms for effects, 800 ms for a tracking poll) is **processed** (row written, the client sees a timeout).
- **Stage time vs provider time:** each stage's duration (engine design section 1) is the bot's simulated **work sleep**, then the provider call. The client timeout applies only to the call.
- **`POST /_fault`:**
```
{lane, service: "account|charge|email|dispatch|notify|ticket|reply|tracking|*",
 mode: "latency"|"status"|"drop"|"stall"|"no_driver",
 value: 3000 | 404 | ...,            // ms for latency and stall, code for status
 count?: 2,                          // apply to the next N matching calls
 forMs?: 8000,                       // or for a time window (one of count or forMs)
 headers?: {"Retry-After":"2"},
 nextCaller?: "recovery"}            // only calls with X-Haunt-Phase: recovery
```
`stall` holds the connection for `value` ms and then answers `200 {status:"in_transit", reroute:true}` (tracking). `no_driver` answers `200 {status:"no_driver"}`.
- **Capacity model (makes ramp meaningful):** the provider serves up to **8 concurrent requests** per lane at base latency. Each request above 8 in flight adds **+50 ms**. Above **24** in flight it answers `503` (not processed).

Fault durations used by creatures: `internet_outage` 8000 ms (`mode:drop, forMs`), `endpoint_down` 10000 ms (`status 503, forMs`), `timeout` `latency 3000 count 1`, `slow_link` `latency 600 forMs 6000` (**600 ms**, under every client timeout), `http_404` and `http_500` `count 2`, `http_429` `count 3` with `Retry-After: 2`, `hazard_event` `stall 5000 forMs 5000`, `driver_unreachable` `no_driver forMs 3000` (**3000 ms**).

## 5. Order input layout and queue

The runner creates, per lane and per wave: `<run>/lane-<n>/orders/ord-0001.json ... ord-<N>.json` (it writes them all at wave start from the order generator), plus empty `done/`, `failed/`, `parked/`, `quarantine/` folders. Nothing is read from the repo; no input folder lives on a network share.

- **Next order** = the lowest-named file in `orders/`. The bot re-lists the folder each time it needs the next order.
- **Done** orders are moved to `done/` at `handoff`. **Failed** to `failed/`. **Parked** to `parked/` (offline queue retries these when its condition clears). **Quarantined** to `quarantine/`.
- A bot with **no journal** has no memory except the folder: after a restart the in-flight order's file is still in `orders/`, so it starts that order again from stage 1. This is exactly the "no memory" behavior.
- **`duplicate_request`:** the runner copies the current order file to `ord-<N>.dup.json` (same order id inside). It sorts after the original. A bot with a journal sees `order_end(done)` for that id and emits `duplicate_skipped`, moves the file to `done/`. A bot without a journal processes it again.
- **`missing_file`:** the runner renames `orders/ord-<k>.json` to `ord-<k>.json.haunted` and renames it back after `forMs`. The bot's read throws `ENOENT`.
- **`malformed_payload`:** the runner overwrites the next unread file with truncated JSON, saving the original in `<run>/lane-<n>/orig/`.
- A **halted** lane's process is not restarted. Files left in `orders/` are counted as abandoned and the runner emits `order_abandoned` for each.

**Order generator:** PRNG `mulberry32`. `orderRng = mulberry32(fnv1a32(seed + "|orders"))`. Order `i`: id `ord-<i padded to 4>`, email `user<i>@example.test`, 1 to 3 items from a fixed 12-SKU table, qty 1 to 3, prices from the table, `total` in cents. Inbox emails similar (`inbox/<id>.json` with a fixed 12-message corpus and classes).

**Durations (stateless, shared by TS and Python):** `u = mulberry32(fnv1a32(seed|lane|order|stage|attempt))()` first output in [0,1). Duration = `min + u*(max-min)` ms, divided by `speed`. The bot sleeps this long as work time. Baseline for the speed bonus = sum of the attempt-1 durations of all stages for that order, divided by speed.

## 6. Journal and resume (fixes to design.md section 3)

Write order for an effect stage: `stage_start` → hook `before_effect` → `intent` → provider call → hook `after_effect_before_journal` → `result` → hook `after_journal` → `stage_done`. (So `before_effect` is **before** `intent`.)

Extra records: `{t:"order_end", order, outcome:"done"|"failed"|"parked"|"quarantined"}` written when the order leaves `orders/`.

**Resume rules** (replaces the earlier algorithm). For each order from the folder:
1. If journal has `order_end` of `done`, `failed` or `quarantined` for this id: skip (a duplicate emits `duplicate_skipped`).
2. For each stage in order: if `stage_done` exists, or **`result` exists without `stage_done`** (crash at `after_journal`), treat as done and emit `stage_done{skipped:true}`.
3. If `intent` exists without `result`: with `idempotency` run **reconcile** (GET `/lookup`, record the result, emit `{"k":"reconciled"}`, or re-send with the same key if not found). Without `idempotency` re-execute the effect with no key.
4. Otherwise run the stage normally.

## 7. Retry, breaker and park rules (replaces design.md section 4 wording)

- **Transient provider errors** (retryable by `retry`): client timeout, drop, any 404, 429, 5xx or 503, `no_driver`, a stall that trips the poll timeout. **Input errors** (not retryable): missing input file, malformed JSON.
- `retry`: **3 attempts total** (the first call plus 2 retries), fixed 500 ms between attempts. Ignores `Retry-After`.
- `breaker` (Phoenix): up to **5 attempts total**, backoff after attempt n is `max(500 * 2^(n-1), Retry-After)` ms (500, 1000, 2000, 4000). The circuit **opens after 4 consecutive failures** to a service (the service is the effect kind or `tracking`), stays open **5000 ms**, then half-opens with one probe. While open the bot does not call; if it cannot proceed it **parks** the order via `offline_queue`. Parked orders are retried at each half-open probe.
- `offline_queue` also covers input errors: missing file parks and resumes when the file is back; malformed JSON quarantines.
- With `retry` but **no** `offline_queue`, an input error fails the order (lane continues). With **no** `retry`, an input error halts the lane.
- The breaker counts 429 and every other transient error as a failure.

## 8. Scoring clarifications (design.md section 7)

- **Survival bonus** is per attack: each attack adds `25 x its depth` when it was armed (depth 1, 2, 3 add 25, 50, 75), paid when the order completes clean. Three stacked attacks = 150.
- **Repeat deduction:** `-150` per **extra ledger row** (rows minus 1 per `(kind, order, discriminator)`). Six duplicated kinds (A6, A17) = `-900`.
- **Reliability penalty:** `-15` per extra ledger row, floor 0.
- A **clean completion** in the reliability formula means completed with zero extra rows.
- **Sweep denominator:** one order per cell, so `orders` = number of applicable cells.
- **`recovered_late`:** a cell that passed but whose recovery exceeded `targets.recoverMs` (default 20000, 1x ms).
- **Lost order** (replaces design.md): an order that is **paid but not fulfilled** (charge row present and no dispatch row; for the inbox, a ticket row and no reply row) or **abandoned** (never started because the lane halted). A plain `failed` order is not lost.
- **Boss expected duration:** `expectedMs = orders x 7350 x pace / speed`, warning at `0.4 x expectedMs`. `pace` is 1 normally and 2 for show pacing (section 10).
- **Random chaos tick:** every `1000 / speed` ms, cooldown 2500 ms per lane.

## 9. Schemas

### `contract/events.schema.json`
JSON Schema draft 2020-12, one `oneOf` over per-type definitions. Envelope required for all: `seq` (integer), `ts` (integer), `type` (string). `wave` required for every type except `hello` and `reset`. `lane` required for lane-level types and **absent** (never null) for global types (`hello, reset, wave_start, wave_end, boss_warning, boss_start, boss_end, hardening_spec, fix_applied`). `order` and `stage` present when meaningful. `detail` has per-type required fields as in PROTOCOL; `additionalProperties: true` everywhere (the contract is additive). `ajv` is allowed as a **dev dependency** for validation.

### `haunt.yaml` (full)
```yaml
name: string                      # required
start: string                     # required. Command line for the adapter (process) or ignored for sdk
adapter: sdk | proxy | process    # default sdk. May be a list
stages:                           # required, ordered
  - id: intake
    label: Order intake
    role: input | work | effect | poll | final     # drives which faults apply
    effects: [{ kind: charge, key: charge, idempotent: required | preferred }]   # zero or more
    duration: [400, 900]          # ms min,max
inputs: ./orders/                 # optional; folder the process reads
truth: http://127.0.0.1:7071      # required for effect stages (ledger base URL)
targets:
  recoverMs: 20000                # default (1x ms)
  repeats: 0                      # default
  throughputPerMin: 60            # optional
  concurrency: 8                  # default, used for scalability grade
```
Fault applicability by **role**: `input` takes `missing_file`, `malformed_payload`, `duplicate_request`; `effect` takes provider faults; `poll` takes `hazard_event`, `driver_unreachable`; every role takes `crash`-family and `disk_full`. `idempotent: required` with an effect called without a key produces a high-severity finding, `preferred` a medium one. The orders app maps `intake=input`, `tracking=poll`, `handoff=final`; the inbox maps `fetch=input`, `archive=final`.

### Report JSON (design.md section 8, exact)
```
{run, mode, seed, app, generatedAt, grade, reliability, scalability?,
 matrix: [{stage, fault, point?, result: "pass"|"repeat"|"recovered_late"|"fail"|"halt"|"na",
           repeats: [{kind, extra}], recoverMs?, evidenceSeq: [int]}],
 recovery: {p50, p95, max},
 repeats: [{order, kind, extra, stage, fault}],
 lost: [{order, reason: "paid_not_fulfilled"|"abandoned"}],
 ramp?: [{concurrency, throughputPerMin, p50, p95, errorRate}], knee?, breakPoint?,
 depth?: [{stage, maxSurvivedDepth}],
 targets: [{name, value, target, pass}],
 findings: [{id, rule, severity: "high"|"medium"|"low", stage, fault, summary, evidenceSeq: [int], suggestedPart}],
 tiers?: [{tier, grade, score}]}
```
In a sweep each crash fault is split into one column per crash `point`.

### Reviewer thresholds (design.md section 11)
R1 any `repeat`. R2 `stage_fail{retryable:true}` followed by `order_failed`. R3 a stage with 3 or more `stage_fail` of 429, 5xx or drop. R4 `lane_halted`. R5 `order_failed` at the input stage with `ENOENT`. R6 recovery p95 above `targets.recoverMs`. R7 journal and ledger mismatch for an `(order, kind)`: a `result` with zero ledger rows, or more than one row. R8 a nested depth of 3 or more that ended in `fail` or `halt`.

## 10. Runs, storage, pacing, wave stop

- Run id: `run-<yyyymmdd-hhmmss>-<seed>`. Persisted under `./.haunt/runs/<run-id>/` (git-ignored): `events.jsonl`, `report.json`, `report.html`, `postmortem.md`, `hardening/`. Journals and lane scratch live in `os.tmpdir()/haunt/<run-id>/`. The `waves` API reads from the run folder. Proof artifacts are copied to `docs/proof/`.
- `pace`: `normal` (durations as in design.md) or `show` (durations x2, used by fixtures and the `hero`, `full`, `loop` demo scripts so beats are readable). `POST /api/wave/start` accepts `pace`.
- `POST /api/wave/stop` ends in-flight work, emits `wave_end{stopped:true}`.
- `GET /api/events?since=<seq>` is **exclusive** (events with `seq > since`).

## 11. Lane to tier mapping

With `tiers: "race"`: lane `n` runs tier `n` (1 Rookie ... 5 Phoenix). With `lanes < 5` in race mode, the runner uses these tier sets: 1 lane: Phoenix. 2 lanes: Rookie, Phoenix. 3 lanes: Rookie, Journaler, Phoenix. 4 lanes: Rookie, Retrier, Journaler, Phoenix. With `tiers: "allPhoenix"` every lane is Phoenix. Storyboards that mention lane 5 mean "the Phoenix lane" and lane 1 "the Rookie lane" when fewer lanes run.

## 12. Creature plugin format

`packages/haunt/src/creatures/<id>.ts` and, for an app, `<app>/haunt.creatures/*.ts`:
```ts
export default {
  id: 'zombie', label: 'Zombie', family: 'network',
  faults: ['timeout', 'comm_timeout', 'slow_link'],
  appliesTo: { roles: ['effect', 'poll'] },
  async inject(ctx, fault, params) {},   // ctx: provider admin, runner arm API, input folder helpers, rng
  async cleanup(ctx) {},
};
```
`family` values: `process`, `network`, `http`, `data`, `world`. Random mode weights by family equally.

## 13. CLI (flags)

```
haunt init [--pack id]                  scaffold a haunt.yaml (from a pack when given)
haunt validate [haunt.yaml]             exit 1 on errors
haunt sweep   [--config <yaml>] [--tier <t>] [--seed N] [--orders N] [--speed N] [--bot path] [--out dir]
haunt stack   [--config <yaml>] [--max-depth 5]
haunt ramp    [--config <yaml>] [--steps 1,2,4,8]
haunt soak    [--config <yaml>] [--minutes 5] [--frequency 0.3]
haunt boss    [--config <yaml>] [--boss lich|banshee_queen|horseman]
haunt compare <runA> <runB> [--out file]
haunt report  <run-id|report.json> [--format html|md|json] [--out file]
haunt serve   [--port 7070] [--mode live|mock]      127.0.0.1 only; starts `npm run live` or `npm run mock`
haunt badge | improve | spec-lint | pack | monkey | watch | stop      see `npm run haunt` for the flags
`--tier` takes one tier per run; run it once per tier. `--no-gate` turns the CI exit code off.
`--i-own-this` (haunt monkey and haunt watch): allow a non-local `--upstream`. Without it the run is refused with exit 2.
exit codes: 0 pass, 1 targets failed, 2 usage error (also a refused non-local target), 3 internal error
```

## 14. Testing modes

- **In-process mode** (`Process` implementation that runs a bot as an async task and "kills" it by throwing a `KillSignal` at a hook, with the fake `Clock`) is used by unit and property tests (fast, deterministic) and is the model for the browser target.
- **Integration mode** uses real child processes with `speed` 4 to 8, for acceptance table A and the hero.
- Both modes must pass the same acceptance table.

## 15. Mock simulator (H0.7 scope reduced)

The mock is **not an engine**. It is a table of **outcome templates** keyed by the outcome code of acceptance table A: `OK`, `REPEAT(kinds)`, `FAILED`, `HALT`, `PARKED_OK`, `QUAR`, `ABSORBED`. Given `(tier, fault, stage, point)` it looks up the outcome and emits the matching canned event sequence (valid per PROTOCOL rules) with plausible timing. The table lives in one data file shared with the acceptance tests. Inbox: two tiers (Rookie, Phoenix) and a handful of faults, same mechanism.

## 16. Demo scripts

`hero`, `full`, `loop` are data files under `packages/core/demo/` listing `{atMs, lane, fault, creature, point?}` presses plus optional boss, and use `pace: show`. Live runs them on the real engine with a fixed seed. Mock replays the fixture of the same name. Their storyboards are in `contract/STORYBOARDS.md`.

---

# Round 3 amendments (these win over any earlier text in this file and in design.md)

## 17. One time base: everything scales with `speed`

**Every millisecond constant in the engine docs is "at 1x" and is divided by `speed` at runtime**: stage work durations, client timeouts (1500 and 800), retry delay (500), backoff (500, 1000, 2000, 4000), breaker open time (5000), `Retry-After`, provider base latency, fault latencies (3000, 600), fault windows (`forMs`), restart delays, creature and boss timers, the offline-queue poll. Event `ms` fields are **real wall-clock ms** (already divided). **Reports normalize back to 1x**: `recoverMs` and other durations in reports are `realMs x speed`. Targets (`recoverMs` and so on) are in 1x ms. Therefore table A gives the same outcomes at any speed, and integration tests may run at speed 4 to 8.

**Default `targets.recoverMs` is 20000 ms (1x)**, not 5000, so a parked order that resumes after an outage (A13, A14) is not "late". A cell is `recovered_late` only above the target.

**Recovery time** runs from the **first failure event caused by the fault** (`stage_fail`, or `process_dead`) to the next `stage_done` of that stage (for parked orders, to the `stage_done` after `order_resumed`). It does not include the press time or leftover work sleep.

## 18. Fault windows and counts (provider)

- `count: N`: applies to the next N matching calls from the moment it is armed.
- `forMs: W`: **the window starts at the first matching call after arming** and lasts W.
- A latency fault **writes the ledger row on arrival**, then holds the response. So a retry with the same key during or after finds the row (A9 reconcile works) and `effect` is emitted at arrival (PROTOCOL rule 8).
- Tracking: the stage duration is the total stage time. Polls run **inside** it every 300 ms. Delivery happens on the **5th successful poll**; a stalled or failed poll does not count. The stage ends when both the duration has elapsed and delivery happened. For effect stages the work sleep comes **first**, then the provider call (sequential).
- **Speed bonus threshold:** `order ms <= 1.25 x (sum of attempt-1 durations) + 600 / speed`.
- **Ramp mode** sets `HAUNT_WORKSCALE=0.05` (work sleeps x0.05) so the provider is the bottleneck and the capacity model produces a knee.

## 19. Arming handshake and dead lanes

- After spawn the bot sends `hello`, then **waits for `{"k":"go","arms":[...]}`** from the runner (all arms queued so far), with a 2000 ms/speed timeout, before it runs the `startup` hook. So an arm can never lose a race with `startup`.
- Arming a lane whose process is `dead` (between `process_dead` and `process_up`) queues the arm. The `chaos` event is emitted at press with `scope:"inner"`, `injectedAt:"recovery"`, and the arm is delivered in the next `go`.
- **The `chaos` event is emitted at the press (when armed)**, never at the kill. `injectedAt` is the phase where it will fire: `before` (`before_effect`), `after_effect` (`after_effect_before_journal` or `after_journal`), `during` (`mid_stage`, provider faults, file faults), `recovery` (recovery hooks, `startup`, or `scope:"inner"`).
- "Blocks reading stdin" at `at_point` means: send the message, then `await new Promise(() => {})`. The runner kills the process. Do not busy-wait.
- **`attempt` is assigned by the runner**: `attempt = (number of earlier stage_start events for this lane, order and stage in this wave) + 1`. Any `attempt` a bot sends is ignored. The duration seed uses this value.

## 20. Input folder protocol (exact)

- **Listing:** files in `orders/` matching `^ord-\d{4}(\.dup)?\.json$`, sorted by order number, then original before `.dup`. Everything else (`.haunted`, other names) is ignored.
- **Who moves files:** the bot moves a file when its order leaves the queue: to `done/` (handoff), `failed/`, `parked/`, `quarantine/`. If the file does not exist under its name (renamed to `.haunted`), the bot just records the outcome.
- **`missing_file` restore:** after `forMs` (from the first read attempt) the runner renames `ord-k.json.haunted` back to: `parked/ord-k.json` if the order was parked, `failed/ord-k.json` if failed, `orders/ord-k.json` otherwise (including a halted lane). So a failed order is never re-queued.
- **Offline queue polling:** every `1000 / speed` ms a bot with `offline_queue` checks `parked/` for orders whose cause cleared: a file present in `parked/` (missing-file case), or a breaker probe success (outage case). It then emits `order_resumed` and moves the file back to `orders/` as the next order.
- **Quarantine:** `quarantine/ord-k.json` is the bad file; the saved original is in `orig/`. (design.md's `orders/.quarantine/` is wrong.)
- **`.dup.json` sorting** uses the explicit comparator above, not lexical order.

## 21. Multi-effect stages and the degraded path

- Each `s.effect()` call has the full hook sequence and its own `intent` and `result`, with its own key (`notify:1`, `notify:2`).
- A stage declares its effect list in the manifest (`effects`). Resume treats a stage as done **only if every declared effect has a `result`** (or `stage_done` exists). Otherwise it resumes at the first effect without a `result`. This fixes the `updates` double notify case (P1 stays 2 rows).
- **`updates` is non-critical:** a failure there (after retries) emits `stage_fail{degraded:true}` and the pipeline continues to the next stage. The order can still be `clean`. A bot with no `retry` also continues after a degraded failure.

## 22. Runner-owned events and enums

- The **runner** emits and fills: `order_done` (it computes `clean` and `repeats` from the ledger), `order_abandoned`, `effect`, `repeat`, `chaos`, `chaos_absorbed`, `process_dead`, `process_up`, `score`, `wave_*`, `lane_ready`, `boss_*`, `part_added`, `hardening_spec`, `fix_applied`. A bot sends `order_done` without `clean` or `repeats`.
- `recover_start.action`: `restart` (no memory, start over), `replay` (journal replay), `reconcile` (lookup by key), `retry` (fixed-delay retry), `backoff` (breaker backoff wait).
- `score.reason` strings: `order clean`, `order with repeats`, `duplicate <kind>`, `order failed`, `order quarantined`, `parked then resumed`, `lane halted`, `survived depth <d>`, `speed bonus`, `boss survived`.
- `wave_end.summary[lane]` = `{score, grade, completed, failed, parked, quarantined, repeats}`.
- `GET /api/health` returns `{ok:true, contractVersion:1, mode, app, version}`.

## 23. Wave-level grade (used by `/api/waves` and the `loop` proof)

Every wave gets a **wave grade per lane** with the same reliability formula and caps as design.md section 8, computed over that wave's orders (not the sweep matrix). `wave_end.summary[lane].grade` and `GET /api/waves` use it. The `loop` demo presses crash at Payment (`after_effect_before_journal`) on **every order** of both lanes: wave 1 Rookie gets F (every order has repeats), and after the recorded fix (retry, journal, idempotency) wave 2 gets A. Sweep grades (Reconciler B or C) are a separate, stricter measure.

## 24. Depth

Depth resets to 0 when the stack empties **or** the process comes back up (whichever first). Property P6 counts armed faults including ones wiped by a crash.

## 25. Inbox on the same provider

The inbox uses the **same provider server (7071)** for `POST /tickets` and `POST /replies` and the same `POST /_fault` (services `ticket` and `reply`). `/replies` ledger rows have `kind: "email"` with key `<id>:reply`. No separate helpdesk server and no proxy ports for the inbox. The **Proxy adapter** is exercised by the separate non-Node sample service (task H3.8) to prove reuse.

## 26. Generalization rules for faults outside table A (used by the mock templates and the live tests)

Outcome = function of (tier, fault class, stage role). "Earlier effects" are effects of stages already completed in that order.

| Fault class and place | Rookie | Retrier | Journaler | Reconciler | Phoenix |
|---|---|---|---|---|---|
| Crash at `before_effect` of effect stage S | REPEAT earlier effects | REPEAT earlier effects | OK | OK | OK |
| Crash at `after_effect_before_journal` of S | REPEAT earlier effects and S | same | REPEAT S | OK | OK |
| Crash at `after_journal` of S (all effects done) | REPEAT earlier effects and S | same | OK | OK | OK |
| Crash at `mid_stage` of a non-effect stage | REPEAT earlier effects | same | OK | OK | OK |
| `timeout` at effect stage S (processed) | FAILED | REPEAT S | REPEAT S | OK | OK |
| `http_404`, `http_500` at S | FAILED | OK | OK | OK | OK |
| `http_429` at S | FAILED | FAILED | FAILED | FAILED | OK |
| `internet_outage`, `endpoint_down` at S | FAILED | FAILED | FAILED | FAILED | PARKED then OK |
| Any provider fault at `updates` | degraded, order continues, OK | OK if retry recovers else degraded | same | same | OK |
| Poll stage faults (`hazard_event`, `driver_unreachable`) | FAILED | FAILED | FAILED | FAILED | OK |
| Input stage faults (`missing_file`, `malformed_payload`, `duplicate_request`) | A15, A16, A17 | | | | |
| `disk_full` | OK | OK | OK | OK | OK |

- A fault that needs a provider call but hits a stage with none (work or final stages) is **deferred** to the next stage that has one.
- **Bosses:** `boss_power_outage` = crash-family on every lane at the point `after_effect_before_journal` if the lane's current stage has an effect, else `mid_stage` (fixtures use this fixed choice). `boss_internet_outage` = `internet_outage` (12000 ms) on every lane, deferred to the next provider-call stage if needed. `boss_hazard_storm` = `hazard_event` at tracking and `http_429` at dispatch, deferred otherwise.
- **Inbox roles:** `fetch` input, `classify` work, `ticket` effect (`ticket`), `draft` work, `reply` effect (`email`), `archive` final. Same table by role. `hazard_event` and `driver_unreachable` do not apply to the inbox (no poll stage).
- Creatures' `apps` field: `werewolf` and `will_o_wisp` are `["orders"]`, all others `["orders","inbox"]`.

## 27. Demo scripts: triggers

A demo script entry is `{at: {ms: N} | {when: {lane, event, stage}}, lane, fault, creature?, point?, scope?}`. The `when` form fires on the first matching event after the previous entry, so beats such as "Ghost during recovery" always land correctly. Scripts and orders per script: `hero` 5 orders, `full` 11 orders, `loop` 4 orders per wave, all `pace: show`.

---

# Round 4 amendments (win over everything above)

## 28. Retry, sleep and probe model (settles timing)

- **Work sleep happens once per (order, stage) per process lifetime.** A stage that is retried or resumed in the **same process** skips the work sleep. After a **restart** the work sleep runs again.
- **In-stage retries do not emit `stage_start`.** A failed call emits `stage_fail{attempt}` (the call attempt number), then `recover_start{retry|backoff}`, then after the wait `recover_done`, and the **same stage continues** (progress keeps going, then `stage_done`). `stage_start` is emitted only when a stage (re)starts from the top: first run, after a restart, after `order_resumed`, or after an order restart. Its `attempt` is runner-assigned (runtime s19). The chip shows the retry through `recover_start`.
- **Breaker probe:** when a breaker is half-open the probe is the parked stage's own provider call. A failed probe **re-opens for another 5000 ms/speed**. A resumed parked order starts the stage with `stage_start` and **skips the work sleep** (it already ran).
- **Provider base latency** is `uniform(50, 70)` ms (seeded), not 20 to 100, to keep margins stable.
- **Timing-sensitive rows** A13, A14, A19, A20, A21 are tested at speed 1 or 2 only. Other rows run at any speed up to 8.
- **Duration seed** uses `HAUNT_ATTEMPT` (process start count) and a **bot-local stage-run counter** (1, 2, ... for this order and stage in this process), not the runner's `attempt`: `u = hash(seed|lane|order|stage|HAUNT_ATTEMPT|localRun)`. The runner's `attempt` is display only. (Replaces the seed in section 5.)
- With these rules A14 Phoenix: failures at about T+0, 0.56, 1.7, 3.8; the 4th opens the breaker; probe at about 8.8 fails (window ends T+10); re-open; probe at about 13.8 succeeds with no re-sleep; recovery about 13.8 s, under 20 s: `pass`.

## 29. Fault lifecycle

- A `count` fault that has not been fully consumed when the **order in flight at arming** leaves the queue (`order_done`, `order_failed`, `order_parked`, `order_quarantined`) is **disarmed**. If it never fired at all, the runner emits `chaos_absorbed{reason:"fault expired unused"}`.
- **Time-boxed window faults** (`internet_outage`, `endpoint_down`, `hazard_event`, `driver_unreachable`, `slow_link`, boss versions) run for their full `forMs` from the first matching call and affect every order of that lane during that time (a real outage hits everything). They are not disarmed at order end.
- At wave end any armed fault that never fired emits `chaos_absorbed{reason:"never fired"}`.
- **`input_read` hook:** a new hook between listing the head file and opening it. The bot sends `at_point{point:"input_read"}` and waits for `{k:"proceed"}`. `missing_file` and `malformed_payload` act here: the runner renames or truncates **the head file** (the one the bot is about to read) and then sends `proceed`. So the fault always hits the order about to be read, with no race. If the lane is between orders the next intake hits it. **Intake reads the file first, then does its work sleep.**
- A `missing_file` or `malformed_payload` press when a lane is mid-stage arms the hook for the **next** intake.

## 30. Runner and provider in one process

The runner hosts the provider server in the **same process**. Every ledger write calls a synchronous callback before the HTTP response is sent, so the runner emits `effect` at write time. This guarantees `effect` comes before `process_dead` and before `stage_done`.

## 31. Waves are isolated

Each wave has fresh journals, ledger, input folders and provider state: `<run>/wave-<n>/lane-<k>/...`, and `POST /_reset` at wave start. Order ids repeat across waves. Run-level state is only the events file and reports.

## 32. Live `loop` and `part_added`

- Bot bundles support `node dist/bots/<name>.js --parts`, which prints `{"parts":[...]}` and exits. The build generates these from the real bot code.
- Between waves the runner compares the next wave's bundle parts with the previous wave's and emits `part_added` for each new part (carrying the previous wave number, rule 26), **before** `wave_start`.
- The repo contains `apps/haunted-orders/src/bots/rookie.hardened.ts`, committed from the real fix that Kiro applies. The live `loop` swaps lane 1's bundle to it for wave 2 and emits `fix_applied{recorded:true}` (a real proof run in the video shows Kiro making the edit; automated runs use the recorded file).

## 33. Misc rules

- **Degraded beats park at `updates`:** `updates` never parks. If calls still fail after retries (or the breaker is open) the stage emits `stage_fail{degraded:true}` and the pipeline continues. The order can be `clean` with fewer notify rows.
- A bot never sends `{"k":"idle"}` while `parked/` is non-empty or a parked order is awaiting a probe.
- **Distinct order ids** are the denominator of reliability. A duplicated order counts its extra ledger rows against the original id.
- **Outcome-template file:** `packages/core/mock/outcomes.json`, an array of `{tier, fault, role, point?, outcome, extraRows: {kind: n}, template}` where `template` is one of `T_OK, T_REPEAT, T_FAILED, T_HALT, T_PARKED_OK, T_QUAR, T_ABSORBED, T_DEGRADED`. `T_PARKED_OK` sequence: `chaos`, `stage_fail` per attempt each with `recover_start{retry|backoff}` and `recover_done`, `breaker{open}`, `order_parked`, the lane starts the next order, `breaker{half_open}`, `order_resumed`, `order_start` (same order), `stage_start`, `breaker{closed}` (if the probe passes), `stage_done` and the rest, `order_done`. The same file feeds the acceptance tests.
- **Demo `when` triggers** (replaces section 27 wording): `{when: {lane, event, stage, order?, attempt?}, forEachOrder?: true, lane, fault, creature?, point?, scope?}`. Entries are tracked **per lane**, so lanes do not consume each other's triggers. `attempt: 1` filters out restart passes. `forEachOrder: true` fires once per order. The `loop` script uses `{when: {lane: L, event: "stage_start", stage: "payment", attempt: 1}, forEachOrder: true, fault: "crash", point: "after_effect_before_journal"}` for lanes 1 and 2.
- **Orders per script:** `hero` 5, `full` 9, `loop` 3 per wave.
- Speed 8 is **internal for tests only**; the public enum stays 0.5, 1, 2, 4.
