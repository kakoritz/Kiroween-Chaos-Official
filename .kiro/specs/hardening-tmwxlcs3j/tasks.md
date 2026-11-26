# Hardening tasks tmwxlcs3j

Ordered by downtime cost. Each task adds a regression test and has an acceptance line. Apply with the review step; nothing here is applied automatically.

- [ ] T1 (R1) Add one `haunt.policy` rule `{stage: "Take payment (`pay`)", fault: "timeout", action: "retry_backoff", backoff: "exp", maxAttempts: 5}` (a lesson); `Sdk.call` already honours it.
  - **Regression test:** fixture replay `order survives timeout at Take payment (`pay`)` in `tests/hardening-p-20b78d95.test.ts`. fixture replay: arm timeout at Take payment (`pay`) for 3 s on a lane with the change; expect order_done and one row per effect.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `pay + timeout + order_lost` and downtime under 5 s for it.

- [ ] T2 (R2) In `Sdk.call` treat an unexpected curse slow answer as a failure to report (log it, park the order) instead of skipping the step.
  - **Regression test:** fixture replay `curse_slow is reported, not swallowed` in `tests/hardening-p-a779df56.test.ts`. fixture replay: a cursed Take payment (`pay`) endpoint; expect curse_response class reported or handled, never swallowed.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `pay + curse_slow + reported` and downtime under 5 s for it.

- [ ] T3 (R3) Add the `breaker` part to the `use` list of Retrier so repeated failures at assign open the circuit and back off (`Sdk.noteFailure` counts them).
  - **Regression test:** fast-check property `no retry storm at assign` in `tests/hardening-p-3862659d.test.ts`. fast-check: under wrong_queue at assign, calls per order stay under 6.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `assign + wrong_queue + retry_storm` and downtime under 5 s for it.

- [ ] T4 (R4) Add the `breaker` part to the `use` list of Journaler so repeated failures at Take payment (`pay`) open the circuit and back off (`Sdk.noteFailure` counts them).
  - **Regression test:** fast-check property `no retry storm at Take payment (`pay`)` in `tests/hardening-p-7ae2c48c.test.ts`. fast-check: under endpoint_failure_rate at Take payment (`pay`), calls per order stay under 6.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `pay + endpoint_failure_rate + degraded` and downtime under 5 s for it.

- [ ] T5 (R5) Add the `breaker` part to the `use` list of Journaler so repeated failures at Take payment (`pay`) open the circuit and back off (`Sdk.noteFailure` counts them).
  - **Regression test:** fast-check property `no retry storm at Take payment (`pay`)` in `tests/hardening-p-277eff3a.test.ts`. fast-check: under a failing endpoint at Take payment (`pay`), calls per order stay under 6.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `pay + errors + retry_storm` and downtime under 5 s for it.

