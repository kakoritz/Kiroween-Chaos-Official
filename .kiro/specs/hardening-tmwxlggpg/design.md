# Hardening design tmwxlggpg

The smallest patch for each requirement. Every patch has a diff budget; a change that does not fit its budget is not proposed here.

### D1 (R1) unknown + endpoint_down + outage

**Patch:** Add `breaker` and `offline_queue` to the `use` list of Retrier, Journaler, Reconciler so orders wait out a unknown outage parked.

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** The lane sits through every outage window at unknown in the foreground, so downtime equals the window.

**Risk:** Medium: parked orders must be resumed.

**Rollback:** Remove the two parts from the `use` list.

**Diff budget:** under 8 lines.

### D2 (R2) unknown + slow_link + outage

**Patch:** Add `breaker` and `offline_queue` to the `use` list of Reconciler so orders wait out a unknown outage parked.

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** The lane sits through every outage window at unknown in the foreground, so downtime equals the window.

**Risk:** Medium: parked orders must be resumed.

**Rollback:** Remove the two parts from the `use` list.

**Diff budget:** under 8 lines.

### D3 (R3) pay + endpoint_down + order_lost

**Patch:** Add one `haunt.policy` rule `{stage: "Take payment (`pay`)", fault: "endpoint_down", action: "retry_backoff", backoff: "exp", maxAttempts: 5}` (a lesson); `Sdk.call` already honours it.

**Files:** `.haunt/lessons/<lane>.json (haunt.policy overlay)`

**Why:** Journaler makes at most three plain retries 500 ms apart, which is shorter than a typical endpoint down window, so the order is cancelled while the endpoint is only briefly down.

**Risk:** Low: longer recovery for orders that would have failed anyway; a permanently dead endpoint now takes about 7.5 s longer to give up.

**Rollback:** Delete the policy rule (and the part from the `use` list).

**Diff budget:** under 8 lines.

### D4 (R4) pay + http_429 + order_lost

**Patch:** Add one `haunt.policy` rule `{stage: "Take payment (`pay`)", fault: "http_429", action: "retry_backoff", backoff: "exp", maxAttempts: 5}` (a lesson); `Sdk.call` already honours it.

**Files:** `.haunt/lessons/<lane>.json (haunt.policy overlay)`

**Why:** Journaler makes at most three plain retries 500 ms apart, which is shorter than a typical http 429 window, so the order is cancelled while the endpoint is only briefly down.

**Risk:** Low: longer recovery for orders that would have failed anyway; a permanently dead endpoint now takes about 7.5 s longer to give up.

**Rollback:** Delete the policy rule (and the part from the `use` list).

**Diff budget:** under 8 lines.

### D5 (R5) pay + slow_link + order_lost

**Patch:** Add one `haunt.policy` rule `{stage: "Take payment (`pay`)", fault: "slow_link", action: "retry_backoff", backoff: "exp", maxAttempts: 5}` (a lesson); `Sdk.call` already honours it.

**Files:** `.haunt/lessons/<lane>.json (haunt.policy overlay)`

**Why:** Journaler makes at most three plain retries 500 ms apart, which is shorter than a typical slow link window, so the order is cancelled while the endpoint is only briefly down.

**Risk:** Low: longer recovery for orders that would have failed anyway; a permanently dead endpoint now takes about 7.5 s longer to give up.

**Rollback:** Delete the policy rule (and the part from the `use` list).

**Diff budget:** under 8 lines.

### D6 (R6) pay + http_500 + order_lost

**Patch:** Add one `haunt.policy` rule `{stage: "Take payment (`pay`)", fault: "http_500", action: "retry_backoff", backoff: "exp", maxAttempts: 5}` (a lesson); `Sdk.call` already honours it.

**Files:** `.haunt/lessons/<lane>.json (haunt.policy overlay)`

**Why:** Journaler makes at most three plain retries 500 ms apart, which is shorter than a typical http 500 window, so the order is cancelled while the endpoint is only briefly down.

**Risk:** Low: longer recovery for orders that would have failed anyway; a permanently dead endpoint now takes about 7.5 s longer to give up.

**Rollback:** Delete the policy rule (and the part from the `use` list).

**Diff budget:** under 8 lines.

### D7 (R7) pay + endpoint_down + retry_storm

**Patch:** Add the `breaker` part to the `use` list of Journaler so repeated failures at Take payment (`pay`) open the circuit and back off (`Sdk.noteFailure` counts them).

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** Journaler keeps calling a failing Take payment (`pay`) endpoint at a fixed pace, so every order pays the full retry cost.

**Risk:** Low: an open breaker pauses calls for 5 s.

**Rollback:** Remove `breaker` from the `use` list.

**Diff budget:** under 6 lines.

