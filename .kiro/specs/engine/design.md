> **Scoring v2 replaces section 7**, and stage 8 `handoff` becomes a provider call: see `.kiro/specs/playtest-v2/design.md` (sections 1 to 8) and `contract/V1_1.md`.

> **See `runtime.md` in this folder.** It closes the gaps in this file (bot runtime, chaos arming, provider API, journal and input rules, schemas, CLI). Where they differ, `runtime.md` wins.

# Engine design (Lane A): the exact rules

This is the **authoritative** definition of how the pipeline, provider, journal, tiers, faults, scoring and grading behave. Where it disagrees with `haunted-house/` it wins. The UI lane does not implement any of this, but the numbers here appear in events.

Vocabulary: **creature** = how a fault is shown. **fault** = the technical failure (`crash`, `http_404`, ...). **tier** = one of five bot implementations. **part** = a resilience capability. **lane** = one tier's track in the arena.

## 1. Order pipeline (8 stages)

All times are at speed 1x. Each stage duration is `uniform(min, max)` from the seeded RNG. `speed` divides them.

| # | id | label | min-max ms | input | output | side effect (kind, key) | notes |
|---|---|---|---|---|---|---|---|
| 1 | `intake` | Order intake | 400-900 | `orders/<order>.json` file | validated order | none | Reads the file. Fails on missing file or bad JSON. Emits progress. |
| 2 | `account` | Account creation | 500-1000 | order.email | account id | `account_create`, key `<order>:account` | Creates a customer account. Duplicate account is a repeat. |
| 3 | `payment` | Payment processing | 800-1500 | account id, total | charge id | `charge`, key `<order>:charge` | The hero stage. Client timeout 1500 ms. |
| 4 | `confirmation` | Confirmation | 400-800 | order, charge id | email id | `email`, key `<order>:email` | Duplicate email is a repeat. |
| 5 | `dispatch` | Dispatch to delivery | 600-1200 | order | shipment id | `dispatch`, key `<order>:dispatch` | Duplicate shipment is a repeat. |
| 6 | `updates` | Order updates | 400-800 | shipment id | 2 notifications | `notify`, keys `<order>:notify:1`, `:2` | Non-critical: a failure here never fails the order (logged as degraded). |
| 7 | `tracking` | Delivery tracking | 1500-3000 | shipment id | delivered | none | Polls the tracking feed every 300 ms. Per-poll timeout 800 ms. Emits progress per poll. |
| 8 | `handoff` | Handoff | 300-600 | order | done | none | Marks the order complete in the journal and emits `order_done`. |

Effect kinds: `account_create`, `charge`, `email`, `dispatch`, `notify`. The contract's `effect.kind` uses these.

Order model: `{id: "ord-0001", email, items:[{sku, qty, price}], total}`. The generator makes `N` orders from the seed. Emails are unique. Default `N = 12` per lane. Every lane gets the **same orders** (same seed) but its **own provider namespace** and ledger.

Concurrency: one order at a time per lane (sequential). Ramp mode raises it (see 9).

## 2. Provider (the source of truth)

Fake external services in one HTTP server, `127.0.0.1:7071`. Not part of the UI contract. State is in memory and appended to `ledger.jsonl` (fsync) so it survives bot kills (the provider never dies).

| Call | Behavior |
|---|---|
| `POST /accounts`, `/charges`, `/emails`, `/shipments`, `/notifications` | Body `{lane, order, ...}`. Optional header `Idempotency-Key`. |
| With a known key (same lane) | Returns the **original** response, header `Idempotent-Replayed: true`, **no new ledger row**. |
| Without a key, or a new key | Creates a new row. Always. |
| `GET /charges?lane=&order=&key=` (same for other kinds) | Lookup used by reconcile. Returns rows or empty. |
| `GET /tracking/:shipment?lane=` | Returns `{status: "in_transit"|"delivered", pct}`. Delivered after ~N polls. |
| `GET /ledger?lane=` | All rows. |
| `POST /_fault` `{lane, kind: "latency"|"status"|"drop", value, forMs}` | Admin: used by creatures. Applies to calls from that lane. |
| `POST /_reset` | New run. |

Ledger row: `{id, lane, kind, order, key|null, amount|null, ts}`.

**Repeat** = more than one row for the same `(lane, kind, order, discriminator)`. Discriminator is the notify index for `notify`. The runner computes repeats from the ledger after each effect and emits `repeat`. This is the truth for scoring and reports.

**Processed-but-timed-out:** if the latency fault exceeds the client timeout, the provider still processes the request and writes the row. The client sees a timeout. This is how real double charges happen.

## 3. Journal

Bot-owned, append-only JSONL at `<tmp>/haunt/<run>/lane-<n>.journal.jsonl`. One JSON object per line, `fs.writeSync` then `fs.fsyncSync` per record. It must survive SIGKILL. (Browser target: an in-page store owned by the main thread, which a worker kill cannot touch.)

Record types:
```
{t:"stage_start", order, stage, attempt, ts}
{t:"intent",      order, stage, kind, key, ts}      // written BEFORE the external call
{t:"result",      order, stage, kind, key, payload, ts} // written AFTER the call returns
{t:"stage_done",  order, stage, ts}
{t:"order_done",  order, ts}
```
A torn last line (kill mid-write) is ignored on replay.

### Resume algorithm (`journal` part), superseded by `runtime.md` section 6

On bot start, replay the journal into `state[order][stage] = {done, intent?, result?}`.
```
for each order in input, in order:
  if order_done: skip order
  for each stage in pipeline order:
    if stage_done: emit stage_done{skipped:true}; reuse stored result; continue
    if intent exists without result:
        if part idempotency:  reconcile(stage)       // see below
        else:                 re-execute the effect   // may duplicate
    run stage normally
```

### Reconcile (`idempotency` part)

Every effect call carries `Idempotency-Key = <order>:<stage-key>`. After a restart with an open intent, the bot calls `GET .../?key=`. If a row exists it records the result without calling again. If not, it executes with the same key. Because the provider dedups by key, even a blind re-execute is safe. Reconcile just avoids the extra call and logs `recover_done{action:"reconciled"}`.

## 4. Parts and tiers

Parts: `retry`, `journal`, `idempotency`, `breaker`, `offline_queue`.

| Part | Behavior |
|---|---|
| `retry` | On a retryable error, retry up to **3 attempts**, fixed **500 ms** delay. Retryable and not retryable errors, attempt counts and the breaker are defined exactly in `runtime.md` section 7. |
| `journal` | As section 3. Also retries a failed journal write once (covers `disk_full`). |
| `idempotency` | Keys on every effect, and reconcile as in section 3. |
| `breaker` | Up to **5 attempts** with exponential backoff (500, 1000, 2000, 4000 ms) that honors `Retry-After`, plus a circuit breaker: after 4 consecutive failures to a service, open for 5 s, half-open probe, close on success. While open, do not call. |
| `offline_queue` | An order that cannot proceed (breaker open, input file missing, poison input) is **parked** with the reason, the lane moves on to the next order, and parked orders are retried when the cause clears (breaker closed, file present). Poison input (malformed payload) is **quarantined**, never retried, and reported. |

| Tier id | Lane | Label | Parts |
|---|---|---|---|
| `rookie` | 1 | Rookie | none |
| `retrier` | 2 | Retrier | retry |
| `journaler` | 3 | Journaler | retry, journal |
| `reconciler` | 4 | Reconciler | retry, journal, idempotency |
| `phoenix` | 5 | Phoenix | all five |

**What "no part" means (so the weak tiers fail honestly):**
- No `journal`: after a restart the bot has no memory. It restarts at the **first unfinished order from the beginning** (stage 1), where "unfinished" is decided by reading the input folder (it deletes the input file only at handoff).
- No `retry`: any error fails the order immediately. If the error is a missing file or malformed payload it **halts the lane** (unhandled exception ends the worker; the runner will restart the process for a crash but this is not a crash). Define: an unhandled input error = `lane_halted`; remaining orders unprocessed.
- No `idempotency`: no keys sent. Retries and restarts create new rows.

**Bot files are real code.** Each tier is a separate implementation in `apps/haunted-orders/src/bots/<tier>.ts`, using more of the SDK as the tier rises. The SDK instruments which parts the bot actually used and reports them. The UI gear comes from that report, not from a label. This is what makes the hardening loop honest (section 10).

## 5. Fault catalog and exact behavior

`scope` is where it lands. `forMs` is how long a condition lasts. All values at speed 1x.

| Fault | Creature | Injection | Applies to stages | Default duration/count |
|---|---|---|---|---|
| `crash` | reaper | SIGKILL the lane's bot process at a crash point (below). Runner restarts it after 1000 ms. | all | once |
| `out_of_memory` | reaper | Same as crash, restart after 2500 ms | all | once |
| `power_outage` | wraith | SIGKILL, restart after **5000 ms**, provider calls from that lane are not affected | all | once |
| `internet_outage` | banshee | Provider returns `drop` (connection closed) for the lane | account, payment, confirmation, dispatch, updates, tracking | 8000 ms |
| `endpoint_down` | gargoyle | Provider returns 503 for one service | effect stages | 10000 ms |
| `timeout` / `comm_timeout` | zombie | Latency of 3000 ms (over the 1500 ms client timeout); request is still processed | payment, confirmation, dispatch, account | next 1 call |
| `slow_link` | zombie | Latency of +600 ms (under every client timeout), progress bar slows | all external | 6000 ms |
| `http_404` | ghost | Provider returns 404 for the next call | account, payment, confirmation, dispatch | next 2 calls |
| `http_429` | goblin | Returns 429 with `Retry-After: 2` | payment, confirmation, dispatch | next 3 calls |
| `http_500` | imp | Returns 500 | effect stages | next 2 calls |
| `missing_file` | poltergeist | Rename `orders/<order>.json` to `.haunted`; restore after `forMs` | intake | 6000 ms |
| `duplicate_request` | doppelganger | Copy the current order into the lane queue again (same id) | intake | once |
| `malformed_payload` | witch | Truncate the next input file to invalid JSON (saves the original in `orig/` (see runtime.md section 20)) | intake | once |
| `disk_full` | mummy | Next journal write throws `ENOSPC` | any | once |
| `hazard_event` | werewolf | Tracking feed stalls (no response) | tracking | 5000 ms, then returns a reroute |
| `driver_unreachable` | will_o_wisp | Tracking feed returns `{status:"no_driver"}` | tracking | 3000 ms |
| `boss_power_outage` | lich | `power_outage` on **all lanes at once** | all | once |
| `boss_internet_outage` | banshee_queen | `internet_outage` on all lanes, 12000 ms | all | once |
| `boss_hazard_storm` | headless_horseman | `hazard_event` + `http_429` on all lanes | tracking, dispatch | 6000 ms |

If a fault does not apply to the current stage (for example `http_404` during `tracking`), the director **defers it to the next stage where it applies** and logs `chaos.detail.deferred = true`. A fault is never silently dropped.

### Crash points (for `crash`, `power_outage`, `out_of_memory`)

Named hooks inside every stage in the SDK:

| id | When |
|---|---|
| `before_effect` | After `stage_start` journal write, before the external call |
| `after_effect_before_journal` | External call returned, `result` not yet written. **The hero point.** |
| `after_journal` | `result` written, `stage_done` not yet |
| `mid_stage` | For stages with no effect: halfway through the stage duration |

Default for a user-triggered crash: the **next crash point reached** in the current stage. For the hero demo and the sweep: choose the point explicitly.

### Nesting (stack)

The director keeps a stack per lane. Each user press while the lane has an active fault condition or is recovering pushes a new fault.
- `scope: "inner"` (default when the lane is in `recovering`): the fault is armed on the **recovery path** (the replay, reconcile, retry or restart code) and fires at its next hook.
- `scope: "outer"`: armed on the next stage hook as normal.
- `depth` = stack length at the time. It resets to 0 when the stack empties (the stage completes, or the order is parked/failed) **or** when the process comes back up.
- Max depth **5**. Further presses are rejected with `409 depth_limit`.
- A fault armed in recovery that is a crash kills the process during replay. The runner restarts again (restart delay doubles each nested crash, cap 8 s).

### Random chaos mode

Every `tick = 1000 ms / speed`, per lane, with probability `p = frequency * 0.08` (frequency 0..1), arm one random applicable fault from the catalog weighted equally across families (not equally across faults), excluding bosses. Cooldown: no new random fault on a lane for 2500 ms after the last one. Seeded RNG: the same seed gives the same fault plan **given the same timing**. Runs on the real clock, so full byte determinism is only promised for `sweep` mode (section 9), which is stage-driven, not clock-driven.

### Boss schedule

In `random` mode and in demo mode: boss warning at 40% of the wave's expected duration, boss start 8000 ms later. One boss per wave, rotating Lich, Banshee Queen, Horseman. `boss_warning.startsInMs = 8000`. Not cancelable.

## 6. Lane outcomes and events

Order outcomes: `completed` (clean or with repeats), `failed`, `parked` (later `resumed` then completed), `quarantined`, `abandoned` (lane halted before it started).
Lane states: `idle`, `working`, `recovering`, `dead` (process down, restart pending), `halted` (stopped, will not continue), `done`.
Events are listed with ordering rules in `contract/CONTRACT.md` (Protocol section).

## 7. Scoring

All points are computed by the **server** and sent in `score` events. The UI only displays.

| Rule | Points |
|---|---|
| Order `completed` with no repeats | +100 |
| Order `completed` with a repeat | +40, then -150 per repeat side effect |
| Order `failed` | -50 |
| Order `quarantined` (handled poison input) | +30 |
| Order `parked` then `resumed` and completed clean | +100 and +40 resilience bonus |
| Lane `halted` | -200 (once) |
| Survived attack: order completes clean after chaos | +25 x the depth of **each** attack (depths 1, 2, 3 add 25, 50, 75), paid when the order completes |
| Speed bonus: order done within 1.25x of its baseline stage time sum | +20 |
| Boss survived (lane's current order completes clean) | +100 |

A repeat deducts immediately, at the moment the `repeat` event fires (reason `"duplicate charge"` and so on). Totals can go negative.

## 8. Grading and the report

Computed by `haunt` for a run (sweep, stack, ramp, soak, boss, compare). The wave score is the arena's number. The **grade** is the report's number. They are different on purpose.

**Reliability score (0-100):**
`100 x (clean completions + 0.5 x parked-then-completed + 0.5 x quarantined) / orders`, then `-15` per extra ledger row, floor 0.

**Grade:** A >= 90, B >= 80, C >= 65, D >= 50, F < 50.
**Caps:** any repeated `charge` caps at **C**. Any halted lane or **lost order** (paid but not fulfilled, or abandoned; see `runtime.md` section 8) caps at **D**.

**Coverage matrix:** for each (stage, fault) pair that applies, one cell: `pass` (completed clean), `repeat` (completed, repeated side effect), `recovered_late` (completed clean but recovery over target), `fail`, `halt`, `n/a`.

**Recovery time:** from `chaos` (or `process_dead`) to the next `stage_done` for that order. Report p50, p95, max. Target default 20000 ms (1x, see runtime.md section 17).

**Scalability (ramp):** concurrency steps 1, 2, 4, 8, 16, 32 orders in flight on one lane, 30 orders per step, no chaos. Per step: throughput (orders/min), p50 and p95 order latency, error rate.
- **Knee:** first step where p95 > 2 x the step-1 p95, or error rate > 2%.
- **Break point:** first step where error rate > 20% or throughput < 50% of the best step.
- **Scalability grade:** from knee concurrency vs the target in `haunt.yaml` (`targets.concurrency`, default 8): knee >= target A; >= target/2 B; >= target/4 C; else D; no break found up to 32 adds nothing (still A).

**Soak:** duration D (default 5 min), random chaos at frequency f. Pass if reliability >= 90 and the last-minute throughput >= 80% of the first-minute throughput (no drift) and the journal and ledger agree.

**Depth curve (stack):** for each stage, apply nested faults depth 1..5. Report the max survived depth per stage.

**Report fields (JSON):** `{run, mode, seed, app, grade, reliability, scalability?, matrix, recovery:{p50,p95,max}, repeats:[...], lost:[...], targets:[{name,value,target,pass}], findings:[...], tiers?, generatedAt}`. Timestamps excluded from the determinism comparison.

## 9. Modes (how `haunt` drives them)

- **sweep:** for each (stage, applicable fault), one order, fixed seed. Crash-family faults get **one cell per crash point** (4 for effect stages, 1 for others). Sequential and clock-independent (the harness waits for the order outcome). Deterministic.
- **stack:** like sweep but nested depth 1..5.
- **ramp:** as in section 8. No chaos.
- **soak:** as in section 8, real clock.
- **boss:** each boss once.
- **compare A B:** run the same sweep on two targets (two bot files, two commits, or two tiers) and diff: per cell and per score.

## 10. The hardening loop (the proof for judges)

1. Run a sweep on `bots/rookie.ts`. Grade F. Findings include `repeat charge at payment/crash@after_effect_before_journal`, `halt at intake/missing_file`, and so on.
2. The **reviewer** (rules in section 11) writes `.kiro/specs/hardening-<run>/` with requirements, design and tasks, each citing the evidence lines.
3. **Kiro applies the spec** by editing `bots/rookie.ts` to use the SDK parts (for example wrap stages in `step()`, pass `key` to `effect('charge', ...)`, add retry).
4. Run the sweep again. The SDK now reports new parts used. The server emits `part_added` for each one that appears between runs. Grade improves.
5. `docs/proof/` stores both reports, the spec and the diff.

Browser target: both `bots/rookie.ts` and `bots/rookie.hardened.ts` (the exact result of step 3, committed from the real run) are bundled. A button "Apply Kiro's fix" swaps the lane's bot and plays the stitch-free gear equip. Say so on screen ("recorded fix") so it is honest.

## 11. Reviewer rules (rule-based, offline)

| Rule | Trigger | Finding | Suggested part |
|---|---|---|---|
| R1 | any `repeat` event | Side effect repeated at stage S after fault F at point P | `idempotency` (and `journal`) |
| R2 | `stage_fail` with no recover, retryable error | Transient error killed the order | `retry` |
| R3 | `stage_fail` on 429 or after 3 retries on 5xx or drop | Retry storm or too few attempts | `breaker` (backoff) |
| R4 | `lane_halted` | Unhandled input error stopped the lane | `offline_queue` (quarantine) |
| R5 | order failed on a missing file | File dependency not handled | `offline_queue` (park and resume) |
| R6 | `recover_done.ms` p95 > target | Slow recovery | `journal` (skip done work) |
| R7 | journal and ledger mismatch | Journal says done, ledger has none, or the reverse | `idempotency` (reconcile) |
| R8 | deep nest (depth >= 3) died | Recovery path not hardened | review recovery code |

Output: `postmortem.md` (counts per rule, worst five findings, evidence as `seq` numbers) and `.kiro/specs/hardening-<run>/{requirements,design,tasks}.md`. Each task names the file, the part, and the check that should pass after (a sweep cell). Optional LLM pass (only if an API key env var is set) drafts the suggested diff inside the spec. No code is ever changed by the reviewer.

## 12. Runtime facts

- Node 20 LTS, TypeScript strict. No native dependencies (journal and ledger are JSONL).
- Real kill: `child.kill('SIGKILL')`. On Windows this is an immediate TerminateProcess. Tested on Windows and Linux.
- All sockets bind to `127.0.0.1`.
- Scratch and journals in `os.tmpdir()/haunt/<run>`. Never on a network share.
- The runner is the only thing that starts and restarts bots.
- Speed: global multiplier `speed` in `{0.5, 1, 2, 4}`, set at wave start and changeable by `POST /api/speed`. Applies to stage durations, restart delays, creature durations and boss timers.

## 13. Browser target

- Engine core is pure TypeScript with these interfaces: `Journal`, `Provider`, `Clock`, `Process`. Live uses JSONL, HTTP and child processes. Browser uses in-memory stores in the main thread, an in-process provider object and Web Workers.
- A bot is a Worker. "Kill" is `worker.terminate()`. The journal lives on the main thread, so it survives.
- Limits: no `ramp` above concurrency 8, no real files (the file stages use virtual files), no Python app. Banner shows "Browser mode".
- Contract is identical. `GET /api/health` is answered by a service layer in the page, not HTTP. The UI's API client has one `transport` switch: `http` or `inpage`. **Lane A ships the in-page transport as `window.__haunt` with the same functions and an `EventSource`-like subscribe.** Lane B wires the switch.

## Wave grade

Waves are graded per lane with the same formula and caps as section 8 over the wave's orders. See runtime.md section 23.
