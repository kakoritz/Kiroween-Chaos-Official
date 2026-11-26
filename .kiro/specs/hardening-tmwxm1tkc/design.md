# Hardening design tmwxm1tkc

The smallest patch for each requirement. Every patch has a diff budget; a change that does not fit its budget is not proposed here.

### D1 (R1) login + internet_outage + outage

**Patch:** Add `breaker` and `offline_queue` to the `use` list of Reconciler so orders wait out a Account or login (`login`) outage parked.

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** The lane sits through every outage window at Account or login (`login`) in the foreground, so downtime equals the window.

**Risk:** Medium: parked orders must be resumed.

**Rollback:** Remove the two parts from the `use` list.

**Diff budget:** under 8 lines.

### D2 (R2) finish + endpoint_down + order_lost

**Patch:** Add one `haunt.policy` rule `{stage: "Finish and history (`finish`)", fault: "endpoint_down", action: "retry_backoff", backoff: "exp", maxAttempts: 5}` (a lesson); `Sdk.call` already honours it.

**Files:** `.haunt/lessons/<lane>.json (haunt.policy overlay)`

**Why:** Reconciler makes at most three plain retries 500 ms apart, which is shorter than a typical endpoint down window, so the order is cancelled while the endpoint is only briefly down.

**Risk:** Low: longer recovery for orders that would have failed anyway; a permanently dead endpoint now takes about 7.5 s longer to give up.

**Rollback:** Delete the policy rule (and the part from the `use` list).

**Diff budget:** under 8 lines.

### D3 (R3) login + crash + duplicate_effect

**Patch:** Add `idempotency` to the `use` list of Rookie, Retrier so the Account or login (`login`) effect is sent with its order key (`this.key(s, ...)` in `Pipeline.stages` already forwards it).

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** Rookie, Retrier retries the Account or login (`login`) call after crash without a key, so the provider cannot tell the retry from a new request and writes a second row.

**Risk:** Low: keys only add a header. A provider that ignores keys behaves as before.

**Rollback:** Remove `idempotency` from the `use` list.

**Diff budget:** under 6 lines.

### D4 (R4) entitlement + timeout + retry_storm

**Patch:** Add the `breaker` part to the `use` list of Journaler so repeated failures at Entitlement check (`entitlement`) open the circuit and back off (`Sdk.noteFailure` counts them).

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** Journaler keeps calling a failing Entitlement check (`entitlement`) endpoint at a fixed pace, so every order pays the full retry cost.

**Risk:** Low: an open breaker pauses calls for 5 s.

**Rollback:** Remove `breaker` from the `use` list.

**Diff budget:** under 6 lines.

### D5 (R5) login + timeout + retry_storm

**Patch:** Add the `breaker` part to the `use` list of Retrier so repeated failures at Account or login (`login`) open the circuit and back off (`Sdk.noteFailure` counts them).

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** Retrier keeps calling a failing Account or login (`login`) endpoint at a fixed pace, so every order pays the full retry cost.

**Risk:** Low: an open breaker pauses calls for 5 s.

**Rollback:** Remove `breaker` from the `use` list.

**Diff budget:** under 6 lines.

