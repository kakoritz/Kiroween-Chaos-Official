# Hardening tasks tmwxm1tkc

Ordered by downtime cost. Each task adds a regression test and has an acceptance line. Apply with the review step; nothing here is applied automatically.

- [ ] T1 (R1) Add `breaker` and `offline_queue` to the `use` list of Reconciler so orders wait out a Account or login (`login`) outage parked.
  - **Regression test:** fixture replay `outage at Account or login (`login`) parks and resumes` in `tests/hardening-p-0630f406.test.ts`. fixture replay: a 20 s outage at Account or login (`login`); expect order_parked then order_resumed then order_done.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `login + internet_outage + outage` and downtime under 5 s for it.

- [ ] T2 (R2) Add one `haunt.policy` rule `{stage: "Finish and history (`finish`)", fault: "endpoint_down", action: "retry_backoff", backoff: "exp", maxAttempts: 5}` (a lesson); `Sdk.call` already honours it.
  - **Regression test:** fixture replay `order survives endpoint_down at Finish and history (`finish`)` in `tests/hardening-p-1c8b063b.test.ts`. fixture replay: arm endpoint_down at Finish and history (`finish`) for 3 s on a lane with the change; expect order_done and one row per effect.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `finish + endpoint_down + order_lost` and downtime under 5 s for it.

- [ ] T3 (R3) Add `idempotency` to the `use` list of Rookie, Retrier so the Account or login (`login`) effect is sent with its order key (`this.key(s, ...)` in `Pipeline.stages` already forwards it).
  - **Regression test:** fast-check property `no repeated effect at Account or login (`login`) under crash` in `tests/hardening-p-06b3f020.test.ts`. fast-check: for any seed and a crash armed at Account or login (`login`), the provider ledger has one row per (order, kind).
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `login + crash + duplicate_effect` and no repeated effect and downtime under 5 s for it.

- [ ] T4 (R4) Add the `breaker` part to the `use` list of Journaler so repeated failures at Entitlement check (`entitlement`) open the circuit and back off (`Sdk.noteFailure` counts them).
  - **Regression test:** fast-check property `no retry storm at Entitlement check (`entitlement`)` in `tests/hardening-p-8b24cf87.test.ts`. fast-check: under timeout at Entitlement check (`entitlement`), calls per order stay under 6.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `entitlement + timeout + retry_storm` and downtime under 5 s for it.

- [ ] T5 (R5) Add the `breaker` part to the `use` list of Retrier so repeated failures at Account or login (`login`) open the circuit and back off (`Sdk.noteFailure` counts them).
  - **Regression test:** fast-check property `no retry storm at Account or login (`login`)` in `tests/hardening-p-92c567bd.test.ts`. fast-check: under timeout at Account or login (`login`), calls per order stay under 6.
  - **Acceptance:** rerun the tournament with seed 7 and the same rounds, expect no `login + timeout + retry_storm` and downtime under 5 s for it.

