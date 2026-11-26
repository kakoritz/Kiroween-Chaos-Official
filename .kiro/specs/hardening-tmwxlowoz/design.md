# Hardening design tmwxlowoz

The smallest patch for each requirement. Every patch has a diff budget; a change that does not fit its budget is not proposed here.

### D1 (R1) pay + endpoint_down + outage

**Patch:** Add `breaker` and `offline_queue` to the `use` list of Rookie, Retrier, Journaler so orders wait out a Take payment (`pay`) outage parked.

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** The lane sits through every outage window at Take payment (`pay`) in the foreground, so downtime equals the window.

**Risk:** Medium: parked orders must be resumed.

**Rollback:** Remove the two parts from the `use` list.

**Diff budget:** under 8 lines.

### D2 (R2) pay + slow_link + outage

**Patch:** Add `breaker` and `offline_queue` to the `use` list of Retrier, Journaler so orders wait out a Take payment (`pay`) outage parked.

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** The lane sits through every outage window at Take payment (`pay`) in the foreground, so downtime equals the window.

**Risk:** Medium: parked orders must be resumed.

**Rollback:** Remove the two parts from the `use` list.

**Diff budget:** under 8 lines.

### D3 (R3) pay + internet_outage + order_lost

**Patch:** Add the `retry` part to the `use` list of Retrier, Phoenix, then the policy rule `{stage: "Take payment (`pay`)", fault: "internet_outage", action: "retry_backoff"}` so `Sdk.call` backs off instead of failing the order.

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** Retrier, Phoenix makes at most three plain retries 500 ms apart, which is shorter than a typical internet outage window, so the order is cancelled while the endpoint is only briefly down.

**Risk:** Low: longer recovery for orders that would have failed anyway; a permanently dead endpoint now takes about 7.5 s longer to give up.

**Rollback:** Delete the policy rule (and the part from the `use` list).

**Diff budget:** under 5 lines.

### D4 (R4) pay + power_outage + order_lost

**Patch:** Add the `journal` part to the `use` list of Phoenix so a restarted process replays the Take payment (`pay`) stage from the journal (`Sdk.stage` already skips journaled stages) instead of losing the order.

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** Phoenix keeps no journal, so a crash at Take payment (`pay`) forgets what the order already did and the restart cannot finish it.

**Risk:** Low: the journal is an append-only file per lane; a disk-full fault is already absorbed.

**Rollback:** Remove `journal` from the `use` list.

**Diff budget:** under 5 lines.

### D5 (R5) pay + http_429 + retry_storm

**Patch:** Add the `breaker` part to the `use` list of Retrier, Journaler so repeated failures at Take payment (`pay`) open the circuit and back off (`Sdk.noteFailure` counts them).

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** Retrier, Journaler keeps calling a failing Take payment (`pay`) endpoint at a fixed pace, so every order pays the full retry cost.

**Risk:** Low: an open breaker pauses calls for 5 s.

**Rollback:** Remove `breaker` from the `use` list.

**Diff budget:** under 6 lines.

### D6 (R6) pay + http_500 + retry_storm

**Patch:** Add the `breaker` part to the `use` list of Retrier so repeated failures at Take payment (`pay`) open the circuit and back off (`Sdk.noteFailure` counts them).

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** Retrier keeps calling a failing Take payment (`pay`) endpoint at a fixed pace, so every order pays the full retry cost.

**Risk:** Low: an open breaker pauses calls for 5 s.

**Rollback:** Remove `breaker` from the `use` list.

**Diff budget:** under 6 lines.

### D7 (R7) ready + endpoint_failure_rate + degraded

**Patch:** Add the `breaker` part to the `use` list of Phoenix so repeated failures at Call the name (`ready`) open the circuit and back off (`Sdk.noteFailure` counts them).

**Files:** `your bot (the `start` file in haunt.yaml)`

**Why:** Phoenix keeps calling a failing Call the name (`ready`) endpoint at a fixed pace, so every order pays the full retry cost.

**Risk:** Low: an open breaker pauses calls for 5 s.

**Rollback:** Remove `breaker` from the `use` list.

**Diff budget:** under 6 lines.

