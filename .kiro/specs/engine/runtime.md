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
- **`recovered_late`:** a cell that passed but whose recovery exceeded `targets.recoverMs` (default 5000).
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
  recoverMs: 5000                 # default
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
haunt init [dir]                        scaffold a haunt.yaml
haunt validate <haunt.yaml>             exit 1 on errors
haunt sweep   --config <yaml> [--tiers all|<t,t>] [--seed N] [--out dir]
haunt stack   --config <yaml> [--max-depth 5]
haunt ramp    --config <yaml> [--steps 1,2,4,8,16,32]
haunt soak    --config <yaml> [--minutes 5] [--frequency 0.3]
haunt boss    --config <yaml> [--boss lich|banshee_queen|horseman]
haunt compare <runA> <runB>
haunt report  <run-id> [--format html|md|json]
haunt serve   [--port 7070] [--mode live|mock]
global: --i-own-this (allow non-local targets) --quiet --json
exit codes: 0 pass, 1 targets failed, 2 usage error, 3 internal error
```

## 14. Testing modes

- **In-process mode** (`Process` implementation that runs a bot as an async task and "kills" it by throwing a `KillSignal` at a hook, with the fake `Clock`) is used by unit and property tests (fast, deterministic) and is the model for the browser target.
- **Integration mode** uses real child processes with `speed` 4 to 8, for acceptance table A and the hero.
- Both modes must pass the same acceptance table.

## 15. Mock simulator (H0.7 scope reduced)

The mock is **not an engine**. It is a table of **outcome templates** keyed by the outcome code of acceptance table A: `OK`, `REPEAT(kinds)`, `FAILED`, `HALT`, `PARKED_OK`, `QUAR`, `ABSORBED`. Given `(tier, fault, stage, point)` it looks up the outcome and emits the matching canned event sequence (valid per PROTOCOL rules) with plausible timing. The table lives in one data file shared with the acceptance tests. Inbox: two tiers (Rookie, Phoenix) and a handful of faults, same mechanism.

## 16. Demo scripts

`hero`, `full`, `loop` are data files under `packages/core/demo/` listing `{atMs, lane, fault, creature, point?}` presses plus optional boss, and use `pace: show`. Live runs them on the real engine with a fixed seed. Mock replays the fixture of the same name. Their storyboards are in `contract/STORYBOARDS.md`.
