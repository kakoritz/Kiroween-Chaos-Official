# Hardening design tmwxll5oj

The smallest patch for each requirement. Every patch has a diff budget; a change that does not fit its budget is not proposed here.

### D1 (R1) unknown + internet_outage + outage

**Patch:** Add `breaker` and `offline_queue` to the `use` list of Reconciler so orders wait out a unknown outage parked.

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** The lane sits through every outage window at unknown in the foreground, so downtime equals the window.

**Risk:** Medium: parked orders must be resumed.

**Rollback:** Remove the two parts from the `use` list.

**Diff budget:** under 8 lines.

### D2 (R2) pay + http_404 + duplicate_effect

**Patch:** Add `idempotency` to the `use` list of Retrier, Journaler so the Take payment (`pay`) effect is sent with its order key (`this.key(s, ...)` in `Pipeline.stages` already forwards it).

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** Retrier, Journaler retries the Take payment (`pay`) call after http 404 without a key, so the provider cannot tell the retry from a new request and writes a second row.

**Risk:** Low: keys only add a header. A provider that ignores keys behaves as before.

**Rollback:** Remove `idempotency` from the `use` list.

**Diff budget:** under 6 lines.

### D3 (R3) pay + crash + duplicate_effect

**Patch:** Add `idempotency` to the `use` list of Rookie, Retrier so the Take payment (`pay`) effect is sent with its order key (`this.key(s, ...)` in `Pipeline.stages` already forwards it).

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** Rookie, Retrier retries the Take payment (`pay`) call after crash without a key, so the provider cannot tell the retry from a new request and writes a second row.

**Risk:** Low: keys only add a header. A provider that ignores keys behaves as before.

**Rollback:** Remove `idempotency` from the `use` list.

**Diff budget:** under 6 lines.

### D4 (R4) ready + timeout + order_lost

**Patch:** Add the `retry` part to the `use` list of Rookie, then the policy rule `{stage: "Call the name (`ready`)", fault: "timeout", action: "retry_backoff"}` so `Sdk.call` backs off instead of failing the order.

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** Rookie makes at most three plain retries 500 ms apart, which is shorter than a typical timeout window, so the order is cancelled while the endpoint is only briefly down.

**Risk:** Low: longer recovery for orders that would have failed anyway; a permanently dead endpoint now takes about 7.5 s longer to give up.

**Rollback:** Delete the policy rule (and the part from the `use` list).

**Diff budget:** under 5 lines.

### D5 (R5) ready + http_404 + order_lost

**Patch:** Add the `retry` part to the `use` list of Rookie, then the policy rule `{stage: "Call the name (`ready`)", fault: "http_404", action: "retry_backoff"}` so `Sdk.call` backs off instead of failing the order.

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** Rookie makes at most three plain retries 500 ms apart, which is shorter than a typical http 404 window, so the order is cancelled while the endpoint is only briefly down.

**Risk:** Low: longer recovery for orders that would have failed anyway; a permanently dead endpoint now takes about 7.5 s longer to give up.

**Rollback:** Delete the policy rule (and the part from the `use` list).

**Diff budget:** under 5 lines.

### D6 (R6) ready + curse_slow + crashed

**Patch:** In `Sdk.call` treat an unexpected curse slow answer as a failure to report (log it, park the order) instead of skipping the step.

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** The bot treats the odd answer as success or ignores it, so the step is skipped silently.

**Risk:** Medium: stricter handling may park orders that used to pass.

**Rollback:** Revert the `Sdk.call` change.

**Diff budget:** under 20 lines.

### D7 (R7) pay + slow_link + retry_storm

**Patch:** Add the `breaker` part to the `use` list of Journaler so repeated failures at Take payment (`pay`) open the circuit and back off (`Sdk.noteFailure` counts them).

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** Journaler keeps calling a failing Take payment (`pay`) endpoint at a fixed pace, so every order pays the full retry cost.

**Risk:** Low: an open breaker pauses calls for 5 s.

**Rollback:** Remove `breaker` from the `use` list.

**Diff budget:** under 6 lines.

### D8 (R8) pay + timeout + retry_storm

**Patch:** Add the `breaker` part to the `use` list of Journaler so repeated failures at Take payment (`pay`) open the circuit and back off (`Sdk.noteFailure` counts them).

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** Journaler keeps calling a failing Take payment (`pay`) endpoint at a fixed pace, so every order pays the full retry cost.

**Risk:** Low: an open breaker pauses calls for 5 s.

**Rollback:** Remove `breaker` from the `use` list.

**Diff budget:** under 6 lines.

### D9 (R9) ready + curse_slow + reported

**Patch:** In `Sdk.call` treat an unexpected curse slow answer as a failure to report (log it, park the order) instead of skipping the step.

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** The bot treats the odd answer as success or ignores it, so the step is skipped silently.

**Risk:** Medium: stricter handling may park orders that used to pass.

**Rollback:** Revert the `Sdk.call` change.

**Diff budget:** under 20 lines.

