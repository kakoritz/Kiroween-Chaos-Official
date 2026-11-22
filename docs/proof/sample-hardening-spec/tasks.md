# Hardening tasks imp-mwrw6vu6

Ordered by downtime cost. Each task adds a regression test and has an acceptance line. Apply with the review step; nothing here is applied automatically.

- [ ] T1 (R1) Add `breaker` and `offline_queue` to the `use` list of Retrier, Journaler, Reconciler so orders wait out a account outage parked.
  - **Regression test:** fixture replay `outage at account parks and resumes` in `packages/haunt/test/hardening-p-7f80339d.test.ts`. fixture replay: a 20 s outage at account; expect order_parked then order_resumed then order_done.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `account + slow_link + outage` and downtime under 5 s for it.

- [ ] T2 (R2) Add the `journal` part to the `use` list of Retrier so a restarted process replays the payment stage from the journal (`Sdk.stage` already skips journaled stages) instead of losing the order.
  - **Regression test:** fast-check property `order survives a crash at payment` in `packages/haunt/test/hardening-p-0b7b06ed.test.ts`. fast-check: for any seed and a crash at payment (any crash point), the order ends done with one row per effect.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `payment + crash + order_lost` and downtime under 5 s for it.

- [ ] T3 (R3) Add the `retry` part to the `use` list of Rookie, then the policy rule `{stage: "payment", fault: "http_404", action: "retry_backoff"}` so `Sdk.call` backs off instead of failing the order.
  - **Regression test:** fixture replay `order survives http_404 at payment` in `packages/haunt/test/hardening-p-85d0a239.test.ts`. fixture replay: arm http_404 at payment for 3 s on a lane with the change; expect order_done and one row per effect.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `payment + http_404 + order_lost` and downtime under 5 s for it.

- [ ] T4 (R4) Add the `breaker` part to the `use` list of Rookie, Retrier, Journaler, Reconciler so repeated failures at payment open the circuit and back off (`Sdk.noteFailure` counts them).
  - **Regression test:** fast-check property `no retry storm at payment` in `packages/haunt/test/hardening-p-e98c1c44.test.ts`. fast-check: under endpoint_failure_rate at payment, calls per order stay under 6.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `payment + endpoint_failure_rate + degraded` and downtime under 5 s for it.

- [ ] T5 (R5) Add the `breaker` part to the `use` list of Retrier, Journaler, Reconciler so repeated failures at payment open the circuit and back off (`Sdk.noteFailure` counts them).
  - **Regression test:** fast-check property `no retry storm at payment` in `packages/haunt/test/hardening-p-f5ee5642.test.ts`. fast-check: under http_404 at payment, calls per order stay under 6.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `payment + http_404 + retry_storm` and downtime under 5 s for it.

