# Acceptance: the oracle

This file is the answer key. Core tests assert it. The mock fixtures follow it. The UI can rely on it when it draws results.

Outcome codes: **OK** completed clean. **REPEAT** completed, at least one repeated side effect. **FAILED** order failed, lane continues. **HALT** lane halts. **PARKED>OK** parked, then completed clean after the condition clears. **QUAR** quarantined.

Counts shown are the ledger rows for the faulted order, in the format `kind x count` for the kinds that differ from 1.

## A. Outcome matrix (one order, one fault, ledger is truth)

| ID | Fault at stage (point) | Rookie | Retrier | Journaler | Reconciler | Phoenix |
|---|---|---|---|---|---|---|
| A1 | crash at payment (`before_effect`) | REPEAT account x2 | REPEAT account x2 | OK | OK | OK |
| A2 | crash at payment (`after_effect_before_journal`) | REPEAT account x2, charge x2 | REPEAT account x2, charge x2 | REPEAT charge x2 | OK | OK |
| A3 | crash at payment (`after_journal`) | REPEAT account x2, charge x2 | REPEAT account x2, charge x2 | OK | OK | OK |
| A4 | crash at account (`after_effect_before_journal`) | REPEAT account x2 | REPEAT account x2 | REPEAT account x2 | OK | OK |
| A5 | crash at intake (`mid_stage`) | OK | OK | OK | OK | OK |
| A6 | crash at tracking (`mid_stage`) | REPEAT all 5 effect kinds x2 | REPEAT all x2 | OK | OK | OK |
| A7 | power_outage during payment (`after_effect_before_journal`) | as A2 | as A2 | as A2 | as A2 | as A2 |
| A8 | nested crash: A2, then a crash during recovery (inner crash fires at the recovery hook; for bots with no recovery code that is `startup`) | REPEAT account x2, charge x2 | REPEAT account x2, charge x2 | REPEAT charge x2 | OK | OK |
| A9 | timeout at payment (latency 3000, processed) | FAILED charge x1 | REPEAT charge x2 | REPEAT charge x2 | OK | OK |
| A10 | http_404 at payment (2 calls) | FAILED | OK | OK | OK | OK |
| A11 | http_500 at payment (2 calls) | FAILED | OK | OK | OK | OK |
| A12 | http_429 at payment (3 calls, Retry-After 2) | FAILED | FAILED | FAILED | FAILED | OK |
| A13 | internet_outage during payment (8000 ms) | FAILED | FAILED | FAILED | FAILED | PARKED>OK |
| A14 | endpoint_down at payment (10000 ms) | FAILED | FAILED | FAILED | FAILED | PARKED>OK |
| A15 | missing_file at intake (6000 ms; the restored file goes to `failed/`, `parked/` or `orders/` per runtime.md section 20) | HALT | FAILED | FAILED | FAILED | PARKED>OK |
| A16 | malformed_payload at intake | HALT | FAILED | FAILED | FAILED | QUAR |
| A17 | duplicate_request at intake | REPEAT all x2 | REPEAT all x2 | OK | OK | OK |
| A18 | disk_full (one journal write) | OK | OK | OK | OK | OK |
| A19 | hazard_event at tracking (5000 ms stall) | FAILED | FAILED | FAILED | FAILED | OK |
| A20 | driver_unreachable at tracking (3000 ms) | FAILED | FAILED | FAILED | FAILED | OK |
| A21 | slow_link (+600 ms, 6000 ms) | OK | OK | OK | OK | OK |

Notes:
- A6 and A17: "all 5 effect kinds x2" means account_create, charge, email, dispatch, and notify (both notifications) are each duplicated: 6 extra ledger rows.
- A12 Phoenix: 3 failures then success on attempt 4 (waits of 2 s each from Retry-After, about 6 s). The breaker needs 4 failures, so it stays closed. Within the 15 s target, so the cell is `pass`.
- A13 and A14 Phoenix: the breaker opens after 4 failures, the order is parked, and a probe after the open time resumes it. A14 may need a second probe (the fault window starts at the first matching call, runtime.md section 18). No probe count is asserted.
- A19 Phoenix: 3 poll failures, success on attempt 4. A20 Phoenix: the same with no_driver.
- All timings here assume the exact rules in `runtime.md` sections 4 and 7.
- FAILED orders keep their effects done so far (for example A13 Rookie: account x1, charge x0). The score engine charges -50 for the failure.
- A9 Rookie: the charge happened and no dispatch did, so the order is **paid, not fulfilled**. That is a lost order (grade cap D). A plain FAILED order with no such state is not lost.
- Tracking faults (A19, A20) leave dispatch done and the order FAILED at stage 7.

## B. Property tests (fast-check)

| ID | Property |
|---|---|
| P1 | For every stage that has an effect and every crash point, for Reconciler and Phoenix, ledger rows per `(kind, order)` equal exactly the expected count (1, or 2 for notify). |
| P2 | For Journaler, crash at `after_journal` never produces a repeat at any stage. |
| P3 | Journal replay is idempotent: replaying the same journal twice yields the same state. |
| P4 | A torn (partial) last journal line is ignored and never throws. |
| P5 | Provider key semantics: N calls with the same key give 1 ledger row and N identical responses. |
| P6 | Stack of depth d from 1 to 5 on Phoenix at any stage: order completes or is parked, never a repeat. |
| P7 | Scoring is a pure function of the event stream: replaying events gives the same totals. |
| P8 | `sweep` with a fixed seed twice gives byte-identical report JSON (timestamps excluded). |

Run with at least 200 cases per property in CI and 1000 in a nightly run. A shrunk counterexample that finds a real bug is recorded in `docs/KIRO-LOG.md`.

## C. Wave and sweep targets (tuning allowed by one grade notch, record any change)

| Tier | Expected grade on a full sweep |
|---|---|
| Rookie | F |
| Retrier | F or D |
| Journaler | D (repeat charge caps at C; many FAILED) |
| Reconciler | B or C (zero repeats, FAILED on A12-A15, A19, A20) |
| Phoenix | A (zero repeats, zero FAILED, zero HALT) |

## D. Scoring examples (unit tests)

| Case | Expected score for the order |
|---|---|
| Clean order, 1.0x time | +100 +20 (speed) = 120 |
| Clean order after 1 attack at depth 1 | 120 + 25 = 145 |
| Clean after three stacked attacks (depths 1, 2, 3) | 120 + 25 + 50 + 75 = 270 |
| Completed with 2 extra ledger rows | 40 - 300 = -260 |
| Failed | -50 |
| Parked then resumed clean | 100 + 40 = 140 |
| Quarantined | +30 |
| Lane halted | -200 once |

## E. Contract and fixtures

| ID | Check |
|---|---|
| C1 | Every fixture validates against `contract/events.schema.json`. |
| C2 | Every fixture satisfies the event ordering rules in `contract/CONTRACT.md` (a validator script checks them). |
| C3 | `hero-crash.jsonl` matches the storyboard in `contract/STORYBOARDS.md` beat for beat (event types and order, not timestamps). |
| C4 | The mock server and the live server pass the same API contract test suite (`npm run test:contract`). |
| C5 | Unknown fields in events are ignored by the UI test harness. |

## F. Definition of done for any task

1. Tests for it pass locally and in CI (`npm test`).
2. `npm run demo` still works (mock mode counts until live lands).
3. Contract and fixtures still validate.
4. `docs/KIRO-LOG.md` has a dated line if Kiro did something notable.
5. One PR, task id in the title, checkbox ticked in the tasks file.

## G. Non-functional budgets

| Item | Budget |
|---|---|
| Arena frame rate with 5 lanes | 60 fps on a mid laptop, never below 30 |
| Event rate | up to 200 events per second sustained without UI stutter |
| Fresh clone to `npm run demo` | under 3 minutes, one command after `npm install` |
| Hosted demo first paint | under 5 seconds |
| Report generation | under 10 seconds for a sweep |
| Browser support | latest Chrome and Edge (video captured in Chrome); Firefox and Safari best effort |
| Security | all servers bind to 127.0.0.1, no outbound network, no secrets in repo |

## H. Added checks

| ID | Check |
|---|---|
| H1 | A3 (crash `after_journal`): Journaler treats a stage with `result` and no `stage_done` as done and does not repeat the charge. |
| H2 | The kill rendezvous kills the real pid and leaves the journal readable (torn last line ignored). |
| H3 | Every table A row is also run in in-process mode with the fake Clock and gives the same outcome. |
| H4 | Provider: 404, 429, 500, 503 and drops write no ledger row. A latency fault over the client timeout writes a row. |
| H5 | Hardening loop proof: after the recorded fix to `bots/rookie.ts`, the Rookie sweep grade improves and the SDK reports the new parts. |

## I. Generalization

Outcomes for faults at other stages follow runtime.md section 26. The mock outcome templates and the live tests both use that table. Add a test per row of that table (at least one stage per row).

## J. Speed independence

Table A and table I produce the same outcome codes at speed 1, 4 and 8 (runtime.md section 17).
