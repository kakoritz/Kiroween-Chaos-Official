# Hardening design tmwxlulnc

The smallest patch for each requirement. Every patch has a diff budget; a change that does not fit its budget is not proposed here.

### D1 (R1) login + endpoint_down + outage

**Patch:** Add `breaker` and `offline_queue` to the `use` list of Retrier, Journaler, Reconciler so orders wait out a Account or login (`login`) outage parked.

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** The lane sits through every outage window at Account or login (`login`) in the foreground, so downtime equals the window.

**Risk:** Medium: parked orders must be resumed.

**Rollback:** Remove the two parts from the `use` list.

**Diff budget:** under 8 lines.

### D2 (R2) login + slow_link + outage

**Patch:** Add `breaker` and `offline_queue` to the `use` list of Phoenix so orders wait out a Account or login (`login`) outage parked.

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** The lane sits through every outage window at Account or login (`login`) in the foreground, so downtime equals the window.

**Risk:** Medium: parked orders must be resumed.

**Rollback:** Remove the two parts from the `use` list.

**Diff budget:** under 8 lines.

### D3 (R3) login + power_outage + order_lost

**Patch:** Add the `journal` part to the `use` list of Reconciler, Phoenix so a restarted process replays the Account or login (`login`) stage from the journal (`Sdk.stage` already skips journaled stages) instead of losing the order.

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** Reconciler, Phoenix keeps no journal, so a crash at Account or login (`login`) forgets what the order already did and the restart cannot finish it.

**Risk:** Low: the journal is an append-only file per lane; a disk-full fault is already absorbed.

**Rollback:** Remove `journal` from the `use` list.

**Diff budget:** under 5 lines.

### D4 (R4) entitlement + timeout + order_lost

**Patch:** Add one `haunt.policy` rule `{stage: "Entitlement check (`entitlement`)", fault: "timeout", action: "retry_backoff", backoff: "exp", maxAttempts: 5}` (a lesson); `Sdk.call` already honours it.

**Files:** `.haunt/lessons/<lane>.json (haunt.policy overlay)`

**Why:** Journaler, Reconciler makes at most three plain retries 500 ms apart, which is shorter than a typical timeout window, so the order is cancelled while the endpoint is only briefly down.

**Risk:** Low: longer recovery for orders that would have failed anyway; a permanently dead endpoint now takes about 7.5 s longer to give up.

**Rollback:** Delete the policy rule (and the part from the `use` list).

**Diff budget:** under 8 lines.

### D5 (R5) entitlement + curse_slow + reported

**Patch:** In `Sdk.call` treat an unexpected curse slow answer as a failure to report (log it, park the order) instead of skipping the step.

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** The bot treats the odd answer as success or ignores it, so the step is skipped silently.

**Risk:** Medium: stricter handling may park orders that used to pass.

**Rollback:** Revert the `Sdk.call` change.

**Diff budget:** under 20 lines.

### D6 (R6) login + http_404 + duplicate_effect

**Patch:** Add `idempotency` to the `use` list of Retrier so the Account or login (`login`) effect is sent with its order key (`this.key(s, ...)` in `Pipeline.stages` already forwards it).

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** Retrier retries the Account or login (`login`) call after http 404 without a key, so the provider cannot tell the retry from a new request and writes a second row.

**Risk:** Low: keys only add a header. A provider that ignores keys behaves as before.

**Rollback:** Remove `idempotency` from the `use` list.

**Diff budget:** under 6 lines.

### D7 (R7) login + http_429 + order_lost

**Patch:** Add the `retry` part to the `use` list of Reconciler, Phoenix, then the policy rule `{stage: "Account or login (`login`)", fault: "http_429", action: "retry_backoff"}` so `Sdk.call` backs off instead of failing the order.

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** Reconciler, Phoenix makes at most three plain retries 500 ms apart, which is shorter than a typical http 429 window, so the order is cancelled while the endpoint is only briefly down.

**Risk:** Low: longer recovery for orders that would have failed anyway; a permanently dead endpoint now takes about 7.5 s longer to give up.

**Rollback:** Delete the policy rule (and the part from the `use` list).

**Diff budget:** under 5 lines.

### D8 (R8) ads + endpoint_down + order_lost

**Patch:** Add one `haunt.policy` rule `{stage: "Ads and pause or resume (`ads`)", fault: "endpoint_down", action: "retry_backoff", backoff: "exp", maxAttempts: 5}` (a lesson); `Sdk.call` already honours it.

**Files:** `.haunt/lessons/<lane>.json (haunt.policy overlay)`

**Why:** Reconciler makes at most three plain retries 500 ms apart, which is shorter than a typical endpoint down window, so the order is cancelled while the endpoint is only briefly down.

**Risk:** Low: longer recovery for orders that would have failed anyway; a permanently dead endpoint now takes about 7.5 s longer to give up.

**Rollback:** Delete the policy rule (and the part from the `use` list).

**Diff budget:** under 8 lines.

### D9 (R9) entitlement + http_429 + order_lost

**Patch:** Add one `haunt.policy` rule `{stage: "Entitlement check (`entitlement`)", fault: "http_429", action: "retry_backoff", backoff: "exp", maxAttempts: 5}` (a lesson); `Sdk.call` already honours it.

**Files:** `.haunt/lessons/<lane>.json (haunt.policy overlay)`

**Why:** Journaler makes at most three plain retries 500 ms apart, which is shorter than a typical http 429 window, so the order is cancelled while the endpoint is only briefly down.

**Risk:** Low: longer recovery for orders that would have failed anyway; a permanently dead endpoint now takes about 7.5 s longer to give up.

**Rollback:** Delete the policy rule (and the part from the `use` list).

**Diff budget:** under 8 lines.

### D10 (R10) login + timeout + order_lost

**Patch:** Add the `retry` part to the `use` list of Rookie, then the policy rule `{stage: "Account or login (`login`)", fault: "timeout", action: "retry_backoff"}` so `Sdk.call` backs off instead of failing the order.

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** Rookie makes at most three plain retries 500 ms apart, which is shorter than a typical timeout window, so the order is cancelled while the endpoint is only briefly down.

**Risk:** Low: longer recovery for orders that would have failed anyway; a permanently dead endpoint now takes about 7.5 s longer to give up.

**Rollback:** Delete the policy rule (and the part from the `use` list).

**Diff budget:** under 5 lines.

### D11 (R11) login + crash + order_lost

**Patch:** Add the `journal` part to the `use` list of Reconciler so a restarted process replays the Account or login (`login`) stage from the journal (`Sdk.stage` already skips journaled stages) instead of losing the order.

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** Reconciler keeps no journal, so a crash at Account or login (`login`) forgets what the order already did and the restart cannot finish it.

**Risk:** Low: the journal is an append-only file per lane; a disk-full fault is already absorbed.

**Rollback:** Remove `journal` from the `use` list.

**Diff budget:** under 5 lines.

### D12 (R12) entitlement + endpoint_down + retry_storm

**Patch:** Add the `breaker` part to the `use` list of Journaler so repeated failures at Entitlement check (`entitlement`) open the circuit and back off (`Sdk.noteFailure` counts them).

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** Journaler keeps calling a failing Entitlement check (`entitlement`) endpoint at a fixed pace, so every order pays the full retry cost.

**Risk:** Low: an open breaker pauses calls for 5 s.

**Rollback:** Remove `breaker` from the `use` list.

**Diff budget:** under 6 lines.

### D13 (R13) entitlement + endpoint_failure_rate + degraded

**Patch:** Add the `breaker` part to the `use` list of Journaler, Reconciler so repeated failures at Entitlement check (`entitlement`) open the circuit and back off (`Sdk.noteFailure` counts them).

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** Journaler, Reconciler keeps calling a failing Entitlement check (`entitlement`) endpoint at a fixed pace, so every order pays the full retry cost.

**Risk:** Low: an open breaker pauses calls for 5 s.

**Rollback:** Remove `breaker` from the `use` list.

**Diff budget:** under 6 lines.

### D14 (R14) entitlement + http_429 + retry_storm

**Patch:** Add the `breaker` part to the `use` list of Journaler so repeated failures at Entitlement check (`entitlement`) open the circuit and back off (`Sdk.noteFailure` counts them).

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** Journaler keeps calling a failing Entitlement check (`entitlement`) endpoint at a fixed pace, so every order pays the full retry cost.

**Risk:** Low: an open breaker pauses calls for 5 s.

**Rollback:** Remove `breaker` from the `use` list.

**Diff budget:** under 6 lines.

### D15 (R15) entitlement + internet_outage + retry_storm

**Patch:** Add the `breaker` part to the `use` list of Reconciler so repeated failures at Entitlement check (`entitlement`) open the circuit and back off (`Sdk.noteFailure` counts them).

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** Reconciler keeps calling a failing Entitlement check (`entitlement`) endpoint at a fixed pace, so every order pays the full retry cost.

**Risk:** Low: an open breaker pauses calls for 5 s.

**Rollback:** Remove `breaker` from the `use` list.

**Diff budget:** under 6 lines.

### D16 (R16) login + endpoint_down + retry_storm

**Patch:** Add the `breaker` part to the `use` list of Journaler, Reconciler so repeated failures at Account or login (`login`) open the circuit and back off (`Sdk.noteFailure` counts them).

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** Journaler, Reconciler keeps calling a failing Account or login (`login`) endpoint at a fixed pace, so every order pays the full retry cost.

**Risk:** Low: an open breaker pauses calls for 5 s.

**Rollback:** Remove `breaker` from the `use` list.

**Diff budget:** under 6 lines.

### D17 (R17) login + endpoint_failure_rate + degraded

**Patch:** Add the `breaker` part to the `use` list of Journaler, Reconciler so repeated failures at Account or login (`login`) open the circuit and back off (`Sdk.noteFailure` counts them).

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** Journaler, Reconciler keeps calling a failing Account or login (`login`) endpoint at a fixed pace, so every order pays the full retry cost.

**Risk:** Low: an open breaker pauses calls for 5 s.

**Rollback:** Remove `breaker` from the `use` list.

**Diff budget:** under 6 lines.

### D18 (R18) login + http_429 + retry_storm

**Patch:** Add the `breaker` part to the `use` list of Reconciler so repeated failures at Account or login (`login`) open the circuit and back off (`Sdk.noteFailure` counts them).

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** Reconciler keeps calling a failing Account or login (`login`) endpoint at a fixed pace, so every order pays the full retry cost.

**Risk:** Low: an open breaker pauses calls for 5 s.

**Rollback:** Remove `breaker` from the `use` list.

**Diff budget:** under 6 lines.

### D19 (R19) login + power_outage + retry_storm

**Patch:** Add the `breaker` part to the `use` list of Reconciler so repeated failures at Account or login (`login`) open the circuit and back off (`Sdk.noteFailure` counts them).

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** Reconciler keeps calling a failing Account or login (`login`) endpoint at a fixed pace, so every order pays the full retry cost.

**Risk:** Low: an open breaker pauses calls for 5 s.

**Rollback:** Remove `breaker` from the `use` list.

**Diff budget:** under 6 lines.

