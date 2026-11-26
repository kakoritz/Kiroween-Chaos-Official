# Hardening tasks tmwxlowoz

Ordered by downtime cost. Each task adds a regression test and has an acceptance line. Apply with the review step; nothing here is applied automatically.

- [ ] T1 (R1) Add `breaker` and `offline_queue` to the `use` list of Rookie, Retrier, Journaler so orders wait out a Take payment (`pay`) outage parked.
  - **Regression test:** fixture replay `outage at Take payment (`pay`) parks and resumes` in `tests/hardening-p-5276e8d6.test.ts`. fixture replay: a 20 s outage at Take payment (`pay`); expect order_parked then order_resumed then order_done.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `pay + endpoint_down + outage` and downtime under 5 s for it.

- [ ] T2 (R2) Add `breaker` and `offline_queue` to the `use` list of Retrier, Journaler so orders wait out a Take payment (`pay`) outage parked.
  - **Regression test:** fixture replay `outage at Take payment (`pay`) parks and resumes` in `tests/hardening-p-f9a140ca.test.ts`. fixture replay: a 20 s outage at Take payment (`pay`); expect order_parked then order_resumed then order_done.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `pay + slow_link + outage` and downtime under 5 s for it.

- [ ] T3 (R3) Add the `retry` part to the `use` list of Retrier, Phoenix, then the policy rule `{stage: "Take payment (`pay`)", fault: "internet_outage", action: "retry_backoff"}` so `Sdk.call` backs off instead of failing the order.
  - **Regression test:** fixture replay `order survives internet_outage at Take payment (`pay`)` in `tests/hardening-p-af446ec7.test.ts`. fixture replay: arm internet_outage at Take payment (`pay`) for 3 s on a lane with the change; expect order_done and one row per effect.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `pay + internet_outage + order_lost` and downtime under 5 s for it.

- [ ] T4 (R4) Add the `journal` part to the `use` list of Phoenix so a restarted process replays the Take payment (`pay`) stage from the journal (`Sdk.stage` already skips journaled stages) instead of losing the order.
  - **Regression test:** fast-check property `order survives a crash at Take payment (`pay`)` in `tests/hardening-p-2c59226b.test.ts`. fast-check: for any seed and a power_outage at Take payment (`pay`) (any crash point), the order ends done with one row per effect.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `pay + power_outage + order_lost` and downtime under 5 s for it.

- [ ] T5 (R5) Add the `breaker` part to the `use` list of Retrier, Journaler so repeated failures at Take payment (`pay`) open the circuit and back off (`Sdk.noteFailure` counts them).
  - **Regression test:** fast-check property `no retry storm at Take payment (`pay`)` in `tests/hardening-p-fddc777f.test.ts`. fast-check: under http_429 at Take payment (`pay`), calls per order stay under 6.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `pay + http_429 + retry_storm` and downtime under 5 s for it.

- [ ] T6 (R6) Add the `breaker` part to the `use` list of Retrier so repeated failures at Take payment (`pay`) open the circuit and back off (`Sdk.noteFailure` counts them).
  - **Regression test:** fast-check property `no retry storm at Take payment (`pay`)` in `tests/hardening-p-07c948fd.test.ts`. fast-check: under http_500 at Take payment (`pay`), calls per order stay under 6.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `pay + http_500 + retry_storm` and downtime under 5 s for it.

- [ ] T7 (R7) Add the `breaker` part to the `use` list of Phoenix so repeated failures at Call the name (`ready`) open the circuit and back off (`Sdk.noteFailure` counts them).
  - **Regression test:** fast-check property `no retry storm at Call the name (`ready`)` in `tests/hardening-p-03e71c23.test.ts`. fast-check: under endpoint_failure_rate at Call the name (`ready`), calls per order stay under 6.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `ready + endpoint_failure_rate + degraded` and downtime under 5 s for it.

