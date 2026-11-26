# Hardening tasks tmwxlulnc

Ordered by downtime cost. Each task adds a regression test and has an acceptance line. Apply with the review step; nothing here is applied automatically.

- [ ] T1 (R1) Add `breaker` and `offline_queue` to the `use` list of Retrier, Journaler, Reconciler so orders wait out a Account or login (`login`) outage parked.
  - **Regression test:** fixture replay `outage at Account or login (`login`) parks and resumes` in `tests/hardening-p-6c8a3bf7.test.ts`. fixture replay: a 20 s outage at Account or login (`login`); expect order_parked then order_resumed then order_done.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `login + endpoint_down + outage` and downtime under 5 s for it.

- [ ] T2 (R2) Add `breaker` and `offline_queue` to the `use` list of Phoenix so orders wait out a Account or login (`login`) outage parked.
  - **Regression test:** fixture replay `outage at Account or login (`login`) parks and resumes` in `tests/hardening-p-f91ee537.test.ts`. fixture replay: a 20 s outage at Account or login (`login`); expect order_parked then order_resumed then order_done.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `login + slow_link + outage` and downtime under 5 s for it.

- [ ] T3 (R3) Add the `journal` part to the `use` list of Reconciler, Phoenix so a restarted process replays the Account or login (`login`) stage from the journal (`Sdk.stage` already skips journaled stages) instead of losing the order.
  - **Regression test:** fast-check property `order survives a crash at Account or login (`login`)` in `tests/hardening-p-186a9b68.test.ts`. fast-check: for any seed and a power_outage at Account or login (`login`) (any crash point), the order ends done with one row per effect.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `login + power_outage + order_lost` and downtime under 5 s for it.

- [ ] T4 (R4) Add one `haunt.policy` rule `{stage: "Entitlement check (`entitlement`)", fault: "timeout", action: "retry_backoff", backoff: "exp", maxAttempts: 5}` (a lesson); `Sdk.call` already honours it.
  - **Regression test:** fixture replay `order survives timeout at Entitlement check (`entitlement`)` in `tests/hardening-p-3c9f29da.test.ts`. fixture replay: arm timeout at Entitlement check (`entitlement`) for 3 s on a lane with the change; expect order_done and one row per effect.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `entitlement + timeout + order_lost` and downtime under 5 s for it.

- [ ] T5 (R5) In `Sdk.call` treat an unexpected curse slow answer as a failure to report (log it, park the order) instead of skipping the step.
  - **Regression test:** fixture replay `curse_slow is reported, not swallowed` in `tests/hardening-p-f617261b.test.ts`. fixture replay: a cursed Entitlement check (`entitlement`) endpoint; expect curse_response class reported or handled, never swallowed.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `entitlement + curse_slow + reported` and downtime under 5 s for it.

- [ ] T6 (R6) Add `idempotency` to the `use` list of Retrier so the Account or login (`login`) effect is sent with its order key (`this.key(s, ...)` in `Pipeline.stages` already forwards it).
  - **Regression test:** fast-check property `no repeated effect at Account or login (`login`) under http_404` in `tests/hardening-p-c2527456.test.ts`. fast-check: for any seed and a http_404 armed at Account or login (`login`), the provider ledger has one row per (order, kind).
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `login + http_404 + duplicate_effect` and no repeated effect and downtime under 5 s for it.

- [ ] T7 (R7) Add the `retry` part to the `use` list of Reconciler, Phoenix, then the policy rule `{stage: "Account or login (`login`)", fault: "http_429", action: "retry_backoff"}` so `Sdk.call` backs off instead of failing the order.
  - **Regression test:** fixture replay `order survives http_429 at Account or login (`login`)` in `tests/hardening-p-134a3d49.test.ts`. fixture replay: arm http_429 at Account or login (`login`) for 3 s on a lane with the change; expect order_done and one row per effect.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `login + http_429 + order_lost` and downtime under 5 s for it.

- [ ] T8 (R8) Add one `haunt.policy` rule `{stage: "Ads and pause or resume (`ads`)", fault: "endpoint_down", action: "retry_backoff", backoff: "exp", maxAttempts: 5}` (a lesson); `Sdk.call` already honours it.
  - **Regression test:** fixture replay `order survives endpoint_down at Ads and pause or resume (`ads`)` in `tests/hardening-p-586f7fa6.test.ts`. fixture replay: arm endpoint_down at Ads and pause or resume (`ads`) for 3 s on a lane with the change; expect order_done and one row per effect.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `ads + endpoint_down + order_lost` and downtime under 5 s for it.

- [ ] T9 (R9) Add one `haunt.policy` rule `{stage: "Entitlement check (`entitlement`)", fault: "http_429", action: "retry_backoff", backoff: "exp", maxAttempts: 5}` (a lesson); `Sdk.call` already honours it.
  - **Regression test:** fixture replay `order survives http_429 at Entitlement check (`entitlement`)` in `tests/hardening-p-d245545f.test.ts`. fixture replay: arm http_429 at Entitlement check (`entitlement`) for 3 s on a lane with the change; expect order_done and one row per effect.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `entitlement + http_429 + order_lost` and downtime under 5 s for it.

- [ ] T10 (R10) Add the `retry` part to the `use` list of Rookie, then the policy rule `{stage: "Account or login (`login`)", fault: "timeout", action: "retry_backoff"}` so `Sdk.call` backs off instead of failing the order.
  - **Regression test:** fixture replay `order survives timeout at Account or login (`login`)` in `tests/hardening-p-c1e65f3c.test.ts`. fixture replay: arm timeout at Account or login (`login`) for 3 s on a lane with the change; expect order_done and one row per effect.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `login + timeout + order_lost` and downtime under 5 s for it.

- [ ] T11 (R11) Add the `journal` part to the `use` list of Reconciler so a restarted process replays the Account or login (`login`) stage from the journal (`Sdk.stage` already skips journaled stages) instead of losing the order.
  - **Regression test:** fast-check property `order survives a crash at Account or login (`login`)` in `tests/hardening-p-c365d94c.test.ts`. fast-check: for any seed and a crash at Account or login (`login`) (any crash point), the order ends done with one row per effect.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `login + crash + order_lost` and downtime under 5 s for it.

- [ ] T12 (R12) Add the `breaker` part to the `use` list of Journaler so repeated failures at Entitlement check (`entitlement`) open the circuit and back off (`Sdk.noteFailure` counts them).
  - **Regression test:** fast-check property `no retry storm at Entitlement check (`entitlement`)` in `tests/hardening-p-251cb4f2.test.ts`. fast-check: under endpoint_down at Entitlement check (`entitlement`), calls per order stay under 6.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `entitlement + endpoint_down + retry_storm` and downtime under 5 s for it.

- [ ] T13 (R13) Add the `breaker` part to the `use` list of Journaler, Reconciler so repeated failures at Entitlement check (`entitlement`) open the circuit and back off (`Sdk.noteFailure` counts them).
  - **Regression test:** fast-check property `no retry storm at Entitlement check (`entitlement`)` in `tests/hardening-p-5015bbd7.test.ts`. fast-check: under endpoint_failure_rate at Entitlement check (`entitlement`), calls per order stay under 6.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `entitlement + endpoint_failure_rate + degraded` and downtime under 5 s for it.

- [ ] T14 (R14) Add the `breaker` part to the `use` list of Journaler so repeated failures at Entitlement check (`entitlement`) open the circuit and back off (`Sdk.noteFailure` counts them).
  - **Regression test:** fast-check property `no retry storm at Entitlement check (`entitlement`)` in `tests/hardening-p-ed03897c.test.ts`. fast-check: under http_429 at Entitlement check (`entitlement`), calls per order stay under 6.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `entitlement + http_429 + retry_storm` and downtime under 5 s for it.

- [ ] T15 (R15) Add the `breaker` part to the `use` list of Reconciler so repeated failures at Entitlement check (`entitlement`) open the circuit and back off (`Sdk.noteFailure` counts them).
  - **Regression test:** fast-check property `no retry storm at Entitlement check (`entitlement`)` in `tests/hardening-p-90dcdd91.test.ts`. fast-check: under internet_outage at Entitlement check (`entitlement`), calls per order stay under 6.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `entitlement + internet_outage + retry_storm` and downtime under 5 s for it.

- [ ] T16 (R16) Add the `breaker` part to the `use` list of Journaler, Reconciler so repeated failures at Account or login (`login`) open the circuit and back off (`Sdk.noteFailure` counts them).
  - **Regression test:** fast-check property `no retry storm at Account or login (`login`)` in `tests/hardening-p-d2b0c838.test.ts`. fast-check: under endpoint_down at Account or login (`login`), calls per order stay under 6.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `login + endpoint_down + retry_storm` and downtime under 5 s for it.

- [ ] T17 (R17) Add the `breaker` part to the `use` list of Journaler, Reconciler so repeated failures at Account or login (`login`) open the circuit and back off (`Sdk.noteFailure` counts them).
  - **Regression test:** fast-check property `no retry storm at Account or login (`login`)` in `tests/hardening-p-f11f4bd5.test.ts`. fast-check: under endpoint_failure_rate at Account or login (`login`), calls per order stay under 6.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `login + endpoint_failure_rate + degraded` and downtime under 5 s for it.

- [ ] T18 (R18) Add the `breaker` part to the `use` list of Reconciler so repeated failures at Account or login (`login`) open the circuit and back off (`Sdk.noteFailure` counts them).
  - **Regression test:** fast-check property `no retry storm at Account or login (`login`)` in `tests/hardening-p-d467fc92.test.ts`. fast-check: under http_429 at Account or login (`login`), calls per order stay under 6.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `login + http_429 + retry_storm` and downtime under 5 s for it.

- [ ] T19 (R19) Add the `breaker` part to the `use` list of Reconciler so repeated failures at Account or login (`login`) open the circuit and back off (`Sdk.noteFailure` counts them).
  - **Regression test:** fast-check property `no retry storm at Account or login (`login`)` in `tests/hardening-p-e4dc10f9.test.ts`. fast-check: under power_outage at Account or login (`login`), calls per order stay under 6.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `login + power_outage + retry_storm` and downtime under 5 s for it.

