# Hardening tasks tmwxlggpg

Ordered by downtime cost. Each task adds a regression test and has an acceptance line. Apply with the review step; nothing here is applied automatically.

- [ ] T1 (R1) Add `breaker` and `offline_queue` to the `use` list of Retrier, Journaler, Reconciler so orders wait out a unknown outage parked.
  - **Regression test:** fixture replay `outage at unknown parks and resumes` in `tests/hardening-p-48854466.test.ts`. fixture replay: a 20 s outage at unknown; expect order_parked then order_resumed then order_done.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `unknown + endpoint_down + outage` and downtime under 5 s for it.

- [ ] T2 (R2) Add `breaker` and `offline_queue` to the `use` list of Reconciler so orders wait out a unknown outage parked.
  - **Regression test:** fixture replay `outage at unknown parks and resumes` in `tests/hardening-p-b1dbd67a.test.ts`. fixture replay: a 20 s outage at unknown; expect order_parked then order_resumed then order_done.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `unknown + slow_link + outage` and downtime under 5 s for it.

- [ ] T3 (R3) Add one `haunt.policy` rule `{stage: "Take payment (`pay`)", fault: "endpoint_down", action: "retry_backoff", backoff: "exp", maxAttempts: 5}` (a lesson); `Sdk.call` already honours it.
  - **Regression test:** fixture replay `order survives endpoint_down at Take payment (`pay`)` in `tests/hardening-p-17ade77e.test.ts`. fixture replay: arm endpoint_down at Take payment (`pay`) for 3 s on a lane with the change; expect order_done and one row per effect.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `pay + endpoint_down + order_lost` and downtime under 5 s for it.

- [ ] T4 (R4) Add one `haunt.policy` rule `{stage: "Take payment (`pay`)", fault: "http_429", action: "retry_backoff", backoff: "exp", maxAttempts: 5}` (a lesson); `Sdk.call` already honours it.
  - **Regression test:** fixture replay `order survives http_429 at Take payment (`pay`)` in `tests/hardening-p-52a91062.test.ts`. fixture replay: arm http_429 at Take payment (`pay`) for 3 s on a lane with the change; expect order_done and one row per effect.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `pay + http_429 + order_lost` and downtime under 5 s for it.

- [ ] T5 (R5) Add one `haunt.policy` rule `{stage: "Take payment (`pay`)", fault: "slow_link", action: "retry_backoff", backoff: "exp", maxAttempts: 5}` (a lesson); `Sdk.call` already honours it.
  - **Regression test:** fixture replay `order survives slow_link at Take payment (`pay`)` in `tests/hardening-p-034d9452.test.ts`. fixture replay: arm slow_link at Take payment (`pay`) for 3 s on a lane with the change; expect order_done and one row per effect.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `pay + slow_link + order_lost` and downtime under 5 s for it.

- [ ] T6 (R6) Add one `haunt.policy` rule `{stage: "Take payment (`pay`)", fault: "http_500", action: "retry_backoff", backoff: "exp", maxAttempts: 5}` (a lesson); `Sdk.call` already honours it.
  - **Regression test:** fixture replay `order survives http_500 at Take payment (`pay`)` in `tests/hardening-p-7990be7c.test.ts`. fixture replay: arm http_500 at Take payment (`pay`) for 3 s on a lane with the change; expect order_done and one row per effect.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `pay + http_500 + order_lost` and downtime under 5 s for it.

- [ ] T7 (R7) Add the `breaker` part to the `use` list of Journaler so repeated failures at Take payment (`pay`) open the circuit and back off (`Sdk.noteFailure` counts them).
  - **Regression test:** fast-check property `no retry storm at Take payment (`pay`)` in `tests/hardening-p-d0fb6b3b.test.ts`. fast-check: under endpoint_down at Take payment (`pay`), calls per order stay under 6.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `pay + endpoint_down + retry_storm` and downtime under 5 s for it.

