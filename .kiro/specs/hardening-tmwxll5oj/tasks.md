# Hardening tasks tmwxll5oj

Ordered by downtime cost. Each task adds a regression test and has an acceptance line. Apply with the review step; nothing here is applied automatically.

- [ ] T1 (R1) Add `breaker` and `offline_queue` to the `use` list of Reconciler so orders wait out a unknown outage parked.
  - **Regression test:** fixture replay `outage at unknown parks and resumes` in `tests/hardening-p-3a318fa3.test.ts`. fixture replay: a 20 s outage at unknown; expect order_parked then order_resumed then order_done.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `unknown + internet_outage + outage` and downtime under 5 s for it.

- [ ] T2 (R2) Add `idempotency` to the `use` list of Retrier, Journaler so the Take payment (`pay`) effect is sent with its order key (`this.key(s, ...)` in `Pipeline.stages` already forwards it).
  - **Regression test:** fast-check property `no repeated effect at Take payment (`pay`) under http_404` in `tests/hardening-p-ccb23f49.test.ts`. fast-check: for any seed and a http_404 armed at Take payment (`pay`), the provider ledger has one row per (order, kind).
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `pay + http_404 + duplicate_effect` and no repeated effect and downtime under 5 s for it.

- [ ] T3 (R3) Add `idempotency` to the `use` list of Rookie, Retrier so the Take payment (`pay`) effect is sent with its order key (`this.key(s, ...)` in `Pipeline.stages` already forwards it).
  - **Regression test:** fast-check property `no repeated effect at Take payment (`pay`) under crash` in `tests/hardening-p-ac50d88d.test.ts`. fast-check: for any seed and a crash armed at Take payment (`pay`), the provider ledger has one row per (order, kind).
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `pay + crash + duplicate_effect` and no repeated effect and downtime under 5 s for it.

- [ ] T4 (R4) Add the `retry` part to the `use` list of Rookie, then the policy rule `{stage: "Call the name (`ready`)", fault: "timeout", action: "retry_backoff"}` so `Sdk.call` backs off instead of failing the order.
  - **Regression test:** fixture replay `order survives timeout at Call the name (`ready`)` in `tests/hardening-p-6df548be.test.ts`. fixture replay: arm timeout at Call the name (`ready`) for 3 s on a lane with the change; expect order_done and one row per effect.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `ready + timeout + order_lost` and downtime under 5 s for it.

- [ ] T5 (R5) Add the `retry` part to the `use` list of Rookie, then the policy rule `{stage: "Call the name (`ready`)", fault: "http_404", action: "retry_backoff"}` so `Sdk.call` backs off instead of failing the order.
  - **Regression test:** fixture replay `order survives http_404 at Call the name (`ready`)` in `tests/hardening-p-e29d59a4.test.ts`. fixture replay: arm http_404 at Call the name (`ready`) for 3 s on a lane with the change; expect order_done and one row per effect.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `ready + http_404 + order_lost` and downtime under 5 s for it.

- [ ] T6 (R6) In `Sdk.call` treat an unexpected curse slow answer as a failure to report (log it, park the order) instead of skipping the step.
  - **Regression test:** fixture replay `curse_slow is reported, not swallowed` in `tests/hardening-p-43eaf12e.test.ts`. fixture replay: a cursed Call the name (`ready`) endpoint; expect curse_response class reported or handled, never swallowed.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `ready + curse_slow + crashed` and downtime under 5 s for it.

- [ ] T7 (R7) Add the `breaker` part to the `use` list of Journaler so repeated failures at Take payment (`pay`) open the circuit and back off (`Sdk.noteFailure` counts them).
  - **Regression test:** fast-check property `no retry storm at Take payment (`pay`)` in `tests/hardening-p-9a8d236f.test.ts`. fast-check: under slow_link at Take payment (`pay`), calls per order stay under 6.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `pay + slow_link + retry_storm` and downtime under 5 s for it.

- [ ] T8 (R8) Add the `breaker` part to the `use` list of Journaler so repeated failures at Take payment (`pay`) open the circuit and back off (`Sdk.noteFailure` counts them).
  - **Regression test:** fast-check property `no retry storm at Take payment (`pay`)` in `tests/hardening-p-0925848e.test.ts`. fast-check: under timeout at Take payment (`pay`), calls per order stay under 6.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `pay + timeout + retry_storm` and downtime under 5 s for it.

- [ ] T9 (R9) In `Sdk.call` treat an unexpected curse slow answer as a failure to report (log it, park the order) instead of skipping the step.
  - **Regression test:** fixture replay `curse_slow is reported, not swallowed` in `tests/hardening-p-620b1687.test.ts`. fixture replay: a cursed Call the name (`ready`) endpoint; expect curse_response class reported or handled, never swallowed.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `ready + curse_slow + reported` and downtime under 5 s for it.

