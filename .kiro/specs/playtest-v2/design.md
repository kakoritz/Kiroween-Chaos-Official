# Play-test v2: engine and scoring design (Lane A)

Source: owner play-test notes (issues #124 to #128). Protocol is in `contract/V1_1.md` (it wins on shapes). This file is the engine rules. It **replaces** the parts of `engine/design.md` section 7 (scoring), `engine/runtime.md` sections 8 and 33 where they conflict, and adds new faults. UI rules are in `ui.md`.

## 1. Pace and travel

| pace | factor |
|---|---|
| normal | 1 |
| show | 2 |
| slow | 3 |

- Every time constant (stage durations, timeouts, delays, windows, travel) = base x pace factor / speed. `slow` is the default for interactive play and the demo scripts.
- **Travel constants** (base at 1x): `walkMs` 400, `grabMs` 500, `ceremonyMs` 1600, `returnMs` 1800, `cancelMs` 900.
- **Scheduler:** the runner owns a per-lane clock. After `stage_done` of a non-final stage (not a skipped replay pair) it sleeps `walkMs` before letting the bot's next `stage_start` through. After `order_start` it sleeps `grabMs`. After `order_done` it sleeps `ceremonyMs + returnMs`; after `order_failed` `cancelMs + returnMs`, before the next `order_start`. Bots send their events as before; the **runner holds the next bot event** (it never reorders). Because a bot cannot run ahead, the bot is simply paused through a `{"k":"hold","ms":N}` message from the runner, and the SDK awaits it before the next stage (the SDK also sleeps this in the in-process mode used by tests).
- **Baseline for timeliness and the speed bonus:** `baselineMs = sum(attempt-1 stage durations) + 7 x walkMs + grabMs` (all at the same pace and speed). Speed bonus threshold: `lap.ms <= 1.25 x baselineMs + 600 / speed`.
- **Boss warning time** uses `expectedMs = orders x 14050 x pace / speed`, where 14050 = 7350 (stage work) + 7 x 400 (walks) + 500 (grab) + 1600 (ceremony) + 1800 (return). Warning at 0.4 x `expectedMs` unless a demo script places it.
- Demo scripts: `hero` 3 orders, `full` 6 orders, `loop` 2 orders per wave, all `pace: slow`. Their video segments are edited clips. Storyboard beats are unchanged; times in fixtures are regenerated.

## 2. Handoff as a provider call

- Stage 8 `handoff` (role `poll`, `final: true`): work sleep 300 to 600 ms (at 1x), then `GET /handoff/:shipment?lane=` returning `{status:"delivered"}` normally.
- Provider fault mode `handoff_block` with `value` in `no_answer`, `gated`, `accident`, `wrong_order`, `forMs` or `count`. While active the call returns `200 {status: value}` (not processed as delivered). The SDK treats any non-`delivered` status as a **transient provider error** (retryable) except `wrong_order`, which raises the wrong-order flow (section 8).
- Retry, breaker and park rules are those of `tracking` (`runtime.md` sections 7 and 28): `retry` 3 attempts at 500 ms; `breaker` 5 attempts, opens after 4 failures, probes every 5000 ms/speed; Phoenix parks and resumes.
- A parked handoff resumes with `stage_start` at stage 8 and skips the work sleep.

## 3. Downtime

**Downtime interval** (per lane, per order): starts at the **first failure** of an open stage (`stage_fail`, or `process_dead`, or `order_parked`) and ends when that stage next completes (`stage_done`). Parked orders count the whole wait until the stage after `order_resumed` completes. Overlapping intervals (nested faults, retries inside a recovery) are **merged** (union), never double counted. A cancelled or abandoned order's open interval ends at its terminal event. Halt time does not count (the halt penalty covers it).
`downtimeMs` in events is real ms. **Normalised** `downtime1xMs = downtimeMs x speed / paceFactor`, used for scoring and reviews so pace and speed do not change scores.

## 4. Lap statistics

Computed by a `LapTracker` in the runner from the lane's events (a pure function of the event stream, so tests replay it): `lap.ms`, `workMs`, `attempts`, `retries`, `downtimeMs`, `issues`, `recoveries` exactly as `contract/V1_1.md` section 3. Per-wave aggregates (`bestMs`, `slowestMs`, `avgMs`, `totalMs`, `retries`, `downtimeMs`, `issuesByStage`, `orders` counts, `stars`, `rating`) go into `wave_end.summary` and the wave report JSON (`report.laps`, `report.stars`).

## 5. Scoring v2 (replaces engine/design.md section 7)

All points are computed by the server and sent as `score` events. Amounts below are integers; round half away from zero.

| Rule | Points | reason |
|---|---|---|
| Order `completed` with zero extra ledger rows | +100 | `order clean` |
| Order `completed` with extra rows | +40, and -150 per extra row | `order with repeats`, `duplicate <kind>` |
| Order **cancelled** (failed) | **-300** | `order cancelled` |
| Order quarantined | +30 | `order quarantined` |
| Order parked then resumed and completed clean | +100 and +40 | `parked then resumed` |
| Lane halted | **-400** once | `lane halted` |
| Each abandoned order (never started because of a halt) | **-150** | `order abandoned` |
| Survival: each attack the order completed through | +25 x the attack's depth, paid at clean completion | `survived depth <d>` |
| Speed bonus | +20 if `lap.ms <= 1.25 x baselineMs + 600/speed` and clean | `speed bonus` |
| **Downtime** | **-2 per second of `downtime1x`**, emitted at the end of each recovery interval, capped at **-300 per order** | `downtime` |
| **Review** | `(stars - 3) x 40` (from -80 to +80), emitted with the `review` | `review` |
| **Boss recovered** | **+150** when the order in flight at `boss_start` completes (not cancelled), plus a **refund of every downtime penalty that lane received between `boss_start` and that completion** | `boss recovered`, `boss downtime refund` |
| Decision `refund` | -150 and the order is cancelled **without** the -300 | `refund` |
| Decision `discount` | -60 | `discount` |
| Decision `redo` | 0 (the cost is time: downtime and a longer lap) | |

The earlier `Boss survived +100` is replaced by `boss recovered`. A lane that lost the in-flight order at a boss gets no boss bonus.

**Worked examples** (speed 1, pace normal, baseline 10 650 ms):

| Case | Order points |
|---|---|
| Perfect order, lap 11 s, 5 stars | +100 clean, +20 speed, +80 review = **+200** |
| Clean order after a depth-1 attack, 4 s downtime, lap 16 s (ratio 1.5, 4 stars) | +100, +25 survival, -8 downtime, +40 review = **+157** (no speed bonus) |
| Completed with 2 extra rows (charge and account), 2 stars | +40, -300, -40 (review) = **-300** |
| Cancelled order (1 star) | -300, -80 = **-380** |
| Boss hit, 10 s downtime (-20), order completes, 4 stars | +100, -20, +150, +20 (refund of the -20), +40 = **+290** |
| Refund decision (cancelled, 2 stars) | -150, -40 = **-190** |

## 6. Reviews and stars

A pure function `review(lap, ledgerExtra, context) -> {sub, stars, reasons, text}`. Inputs: `lap`, the order's ledger extra rows (by kind), `baselineMs`, and `context` flags (`degraded`, `decision`, `typoDetectedAt`).

**Sub-scores** (integers 1 to 5):

| Sub | 5 | 4 | 3 | 2 | 1 |
|---|---|---|---|---|---|
| `timeliness` (r = lap.ms / baselineMs) | r <= 1.25 | <= 1.6 | <= 2.2 | <= 3.0 | above |
| `delays` (d = downtime1x seconds) | 0 | <= 2 | <= 5 | <= 10 | above |
| `issues` (n = issue count) | 0 | 1 | 2 | 3 to 4 | 5 or more |
| `delivery` | no extra rows, no degraded stage | redo path | 1 extra row, or a degraded stage | discount path (wrong order delivered) | 2 or more extra rows |
| `ease` (i = issues at `intake` and `confirmation`) | 0 | 1 | 2 or more | typo found after redo | typo, refund |

If two conditions apply to one sub take the lower score.

**Stars** = `round(mean(sub) x 2) / 2`, then **caps**: any extra `charge` row: at most 2. `refund`: at most 2. `discount`: at most 3. `redo`: at most 4. A **cancelled** order is exactly **1** star ("Never arrived", all subs shown as 1).

**Reasons.** For each sub of 3 or less, in the order timeliness, delays, issues, delivery, ease, add its low phrase; keep the first two. If none, use the high phrases of the two highest subs.

| Sub | Low phrase | High phrase |
|---|---|---|
| timeliness | Took forever to arrive | Lightning fast |
| delays | Kept me waiting | No waiting around |
| issues | So many hiccups | Smooth as a ghost |
| delivery | Charged twice! (extra charge), Wrong order (discount path), Missing updates (degraded) | Everything arrived right |
| ease | Hard to order | Easy to order |

`text` = reasons joined with ` · `. `cum` as in the contract. **Per-lane rating** at wave end from the average of stars (contract section 6).

## 7. New world events: engine mechanics and outcomes

Mechanisms use existing provider fault modes (`runtime.md` section 4), plus `handoff_block` (section 2). The new fault ids and creatures are in `contract/V1_1.md` section 8. **Time-boxed window faults start at the first matching call** (`runtime.md` section 18).

| Fault | Provider fault | Stage role it applies to | Deferral |
|---|---|---|---|
| `sms_down` | `mode:status 503, service:email, forMs 8000` | `confirmation` | defer to confirmation |
| `app_down` | `mode:status 503, service:dispatch, forMs 8000` | `dispatch` | defer to dispatch |
| `updates_down` | `mode:status 503, service:notify, forMs 8000` | `updates` | defer to updates |
| `wrong_address` | `mode:stall, service:tracking, value 5000, forMs 5000` with `reroute` | `tracking` | defer to tracking |
| `no_answer` | `mode:handoff_block, value:no_answer, forMs 3000` | `handoff` | defer to handoff |
| `gated_house` | `mode:handoff_block, value:gated, forMs 3000` | `handoff` | defer to handoff |
| `car_accident` | `mode:handoff_block, value:accident, forMs 7000` | `handoff` | defer to handoff |
| `order_typo` | file mutation at `input_read` (section 8) | `intake`, detected at `confirmation` or `handoff` | next intake |

The creature in play-test v2 table is for display only. Faults not at their stage are **deferred** to it (same rule as before). In random mode these join family `world`.

### Acceptance table L (expected outcomes, one order)

Outcome codes as in `engine/acceptance.md`; **FAILED is shown as CANCELLED**. Ledger counts are for the faulted order. Timing assumptions: `runtime.md` sections 17, 18, 28.

| ID | Fault at stage | Rookie | Retrier | Journaler | Reconciler | Phoenix |
|---|---|---|---|---|---|---|
| L1 | `sms_down` at confirmation | CANCELLED (account 1, charge 1: paid not fulfilled, lost) | same | same | same | PARKED>OK |
| L2 | `app_down` at dispatch | CANCELLED (lost) | same | same | same | PARKED>OK |
| L3 | `updates_down` at updates | OK degraded (no notices), stars at most 3.5 | same | same | same | same (updates never parks) |
| L4 | `wrong_address` at tracking | CANCELLED (dispatch exists, not lost) | same | same | same | OK |
| L5 | `no_answer` at handoff (3 s) | CANCELLED | CANCELLED (3 attempts in about 1 s) | same | same | OK (attempt 4 at about 3.8 s) |
| L6 | `gated_house` at handoff (3 s) | as L5 | as L5 | as L5 | as L5 | as L5 |
| L7 | `car_accident` at handoff (7 s) | CANCELLED | CANCELLED | CANCELLED | CANCELLED | PARKED>OK |
| L8 | `order_typo`, default policy | refund: CANCELLED (charge 1, refund 1) | refund: CANCELLED | discount: OK (discount 1) | discount: OK | redo: OK (refund 1, charge 2 legit) |

Notes: L1, L2, L7 Phoenix recover through the breaker (4 failures at about 3.8 s open it, probes every 5 s). L5 and L6 timing is tight (about 0.8 s margin): run them at speed 1 or 2 only (timing-sensitive rows, `runtime.md` section 28). Reviews for these rows follow section 6 (for example L3 Phoenix: delivery 3, issues 4, stars at most 3.5).

## 8. Wrong order (order_typo) and decisions

1. **Arming:** `POST /api/chaos {fault:"order_typo", lane, detect?}`. At the next `input_read` hook the runner rewrites the head order file: **valid JSON, but the items are swapped for different SKUs** (a deterministic swap from the seed), keeping a copy in `orig/`. It also tells the provider `POST /_fault {mode:"typo", order, detect}` (`detect` is `confirmation` by default).
2. **Intake passes** for every tier (the JSON is valid), then account and payment run on the wrong cart (the charge is for the wrong total).
3. **Detection:** at `confirmation` the provider's `POST /emails` answers `201 {id, complaint:"wrong_order"}` (customer complaint). With `detect:"handoff"` the `GET /handoff` call answers `{status:"wrong_order"}` instead. The SDK raises `WrongOrder`.
4. **Decision:** the bot sends `{"k":"decision_needed","order","kind":"wrong_order","detectedAt"}` and **waits** for `{"k":"decision","choice"}`. The runner emits `stage_fail{error:"wrong_order", retryable:false}` then `decision_needed` (with `timeoutMs` 6000 base) and waits for `POST /api/decision`, otherwise the **tier default** after `timeoutMs`. Defaults: Rookie `refund`, Retrier `refund`, Journaler `discount`, Reconciler `discount`, Phoenix `redo`. `decision_made.source` is `user`, `timeout` (tier default after waiting) or `default` (no UI connected: headless runs and sweeps decide at once).
5. **Resolutions:**
   - `refund`: `POST /refunds` (key `<order>:refund`), emits `effect{kind:refund}`, then the order is cancelled (reason `refunded`). Score `refund` -150 (no -300).
   - `discount`: `POST /discounts` (key `<order>:discount`), emits `effect{kind:discount}`, the order continues from the stage where it was and completes. Stars cap 3, delivery sub 2.
   - `redo`: refund of the wrong charge (`refund` effect), then the order restarts from intake with the original file from `orig/`, **`order_start{redo:true}`**, new keys with suffix `:r1`, `:r2`. Stars cap 4. Time cost shows as downtime (from the complaint until the corrected order's stage completes) and a longer lap.
6. **Ledger:** `refund` and `discount` rows are legitimate. A `charge` row with a `:rN` key after a `refund` row is **not** a repeat. The runner's repeat detection treats `(kind, order, discriminator)` with different keys by this rule.
7. **Journal:** records `{t:"order_redo", order, n}` and `{t:"decision", order, choice}` so a restart mid-decision resumes correctly (an unanswered decision is re-asked; a made one is applied).
8. The bot-side default policy is a `defineBot` option `onWrongOrder: 'refund'|'discount'|'redo'`; the five bot files set it as listed.

## 9. Mock and fixtures

- The mock's outcome-template table gains rows for table L and the decision flow (templates `T_CANCELLED` (= `T_FAILED` with the new score and review), `T_DECISION_REFUND`, `T_DECISION_DISCOUNT`, `T_DECISION_REDO`). It generates travel gaps, `lap`, `review`, downtime and boss-recovery scores for every lane so the UI sees complete data.
- Fixtures are listed in `contract/V1_1.md` section 11. All fixture timing comes from the generator, which applies pace, walk, grab, ceremony and return.
- The mock accepts `POST /api/decision`; in replay mode it returns `409 bad_request`.

## 10. Report and CLI

- Wave report JSON gains `laps: [{lane, tier, laps:[{order, outcome, lap, review}]}]`, `stars: [{lane, series}]`, `ratings: [{lane, rating, avg}]`. The report viewer shows them (`ui.md`).
- `haunt sweep` matrix result `fail` is labelled `cancelled` in the HTML and Markdown output. JSON keeps `fail` (additive naming only).
- New world faults are part of the sweep: the stage-by-fault matrix adds columns `sms_down`, `app_down`, `updates_down`, `wrong_address`, `no_answer`, `gated_house`, `car_accident`, and `order_typo` with each decision choice as a sub-column (`order_typo:refund`, `:discount`, `:redo`).

## 11. Property and unit tests (extends `acceptance.md`)

| ID | Property |
|---|---|
| P9 | Downtime is the union of intervals: nested and overlapping recoveries never double count. `sum(recoveries.ms)` is at least `downtimeMs`. |
| P10 | `lap.ms` equals the timestamp difference of the lane's events (order_start to order_done or order_failed). |
| P11 | `review` is pure and deterministic; stars always in 0.5 steps from 1 to 5; caps hold. |
| P12 | `cum.stars` equals the sum of `review.stars` so far; `cum.max` equals 5 x count. |
| P13 | Travel guarantees (contract rule 40): for every lane, the gap between the two events is at least the stated constant (within 5 ms), at pace slow and speed 1 and 4. |
| P14 | Scoring replay: the sum of all `score.delta` for a lane equals the last `score.total`. |
| P15 | A `charge` row with suffix `:rN` after a `refund` row is not reported as a repeat; a plain second charge still is. |
| P16 | `boss downtime refund` equals the sum of downtime penalties received between `boss_start` and the order completion. |
| P17 | Table L outcomes hold in in-process mode and integration mode (timing-sensitive rows at speed 1 or 2). |
| P18 | A decision is made exactly once per `decision_needed`; a restart during a pending decision does not create a second one. |

Scoring examples of section 5 are unit tests. **Existing tests to update:** `acceptance.md` table D (scores: failed -50 becomes cancelled -300, halted -200 becomes -400, boss survived +100 becomes boss recovered), the `runtime.md` section 23 loop numbers (wave grades are unaffected, scores change), and `STORYBOARDS.md` (add travel gaps, laps, reviews, door ceremony).

## 12. Changes to existing rules (for the spec owners)

- `engine/design.md` section 7: replaced by section 5 here.
- `engine/runtime.md` section 8 (Boss survived), section 33 (stars none), section 23 (wave grade unchanged): note the pointer.
- `engine/design.md` section 1: stage 8 role is `poll` with a provider call; `runtime.md` section 9 (haunt.yaml roles).
- `contract/PROTOCOL.md`: pointer line to `V1_1.md`.
