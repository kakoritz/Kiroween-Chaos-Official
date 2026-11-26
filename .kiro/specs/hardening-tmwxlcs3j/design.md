# Hardening design tmwxlcs3j

The smallest patch for each requirement. Every patch has a diff budget; a change that does not fit its budget is not proposed here.

### D1 (R1) pay + timeout + order_lost

**Patch:** Add one `haunt.policy` rule `{stage: "Take payment (`pay`)", fault: "timeout", action: "retry_backoff", backoff: "exp", maxAttempts: 5}` (a lesson); `Sdk.call` already honours it.

**Files:** `.haunt/lessons/<lane>.json (haunt.policy overlay)`

**Why:** Journaler makes at most three plain retries 500 ms apart, which is shorter than a typical timeout window, so the order is cancelled while the endpoint is only briefly down.

**Risk:** Low: longer recovery for orders that would have failed anyway; a permanently dead endpoint now takes about 7.5 s longer to give up.

**Rollback:** Delete the policy rule (and the part from the `use` list).

**Diff budget:** under 8 lines.

### D2 (R2) pay + curse_slow + reported

**Patch:** In `Sdk.call` treat an unexpected curse slow answer as a failure to report (log it, park the order) instead of skipping the step.

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** The bot treats the odd answer as success or ignores it, so the step is skipped silently.

**Risk:** Medium: stricter handling may park orders that used to pass.

**Rollback:** Revert the `Sdk.call` change.

**Diff budget:** under 20 lines.

### D3 (R3) assign + wrong_queue + retry_storm

**Patch:** Add the `breaker` part to the `use` list of Retrier so repeated failures at assign open the circuit and back off (`Sdk.noteFailure` counts them).

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** Retrier keeps calling a failing assign endpoint at a fixed pace, so every order pays the full retry cost.

**Risk:** Low: an open breaker pauses calls for 5 s.

**Rollback:** Remove `breaker` from the `use` list.

**Diff budget:** under 6 lines.

### D4 (R4) pay + endpoint_failure_rate + degraded

**Patch:** Add the `breaker` part to the `use` list of Journaler so repeated failures at Take payment (`pay`) open the circuit and back off (`Sdk.noteFailure` counts them).

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** Journaler keeps calling a failing Take payment (`pay`) endpoint at a fixed pace, so every order pays the full retry cost.

**Risk:** Low: an open breaker pauses calls for 5 s.

**Rollback:** Remove `breaker` from the `use` list.

**Diff budget:** under 6 lines.

### D5 (R5) pay + errors + retry_storm

**Patch:** Add the `breaker` part to the `use` list of Journaler so repeated failures at Take payment (`pay`) open the circuit and back off (`Sdk.noteFailure` counts them).

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** Journaler keeps calling a failing Take payment (`pay`) endpoint at a fixed pace, so every order pays the full retry cost.

**Risk:** Low: an open breaker pauses calls for 5 s.

**Rollback:** Remove `breaker` from the `use` list.

**Diff budget:** under 6 lines.

