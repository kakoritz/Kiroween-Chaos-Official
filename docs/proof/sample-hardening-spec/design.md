# Hardening design imp-mwrx7spi

The smallest patch for each requirement. Every patch has a diff budget; a change that does not fit its budget is not proposed here.

### D1 (R1) account + slow_link + outage

**Patch:** Add `breaker` and `offline_queue` to the `use` list of Retrier, Journaler, Reconciler so orders wait out a account outage parked.

**Files:** `apps/haunted-orders/src/bots/retrier.ts`, `apps/haunted-orders/src/bots/journaler.ts`, `apps/haunted-orders/src/bots/reconciler.ts`

**Why:** The lane sits through every outage window at account in the foreground, so downtime equals the window.

**Risk:** Medium: parked orders must be resumed.

**Rollback:** Remove the two parts from the `use` list.

**Diff budget:** under 8 lines.

### D2 (R2) payment + http_404 + order_lost

**Patch:** Add the `retry` part to the `use` list of Rookie, then the policy rule `{stage: "payment", fault: "http_404", action: "retry_backoff"}` so `Sdk.call` backs off instead of failing the order.

**Files:** `apps/haunted-orders/src/bots/rookie.ts`, `packages/haunt/src/sdk/sdk.ts`

**Why:** Rookie makes at most three plain retries 500 ms apart, which is shorter than a typical http 404 window, so the order is cancelled while the endpoint is only briefly down.

**Risk:** Low: longer recovery for orders that would have failed anyway; a permanently dead endpoint now takes about 7.5 s longer to give up.

**Rollback:** Delete the policy rule (and the part from the `use` list).

**Diff budget:** under 5 lines.

### D3 (R3) account + http_404 + order_lost

**Patch:** Add the `retry` part to the `use` list of Rookie, then the policy rule `{stage: "account", fault: "http_404", action: "retry_backoff"}` so `Sdk.call` backs off instead of failing the order.

**Files:** `apps/haunted-orders/src/bots/rookie.ts`, `packages/haunt/src/sdk/sdk.ts`

**Why:** Rookie makes at most three plain retries 500 ms apart, which is shorter than a typical http 404 window, so the order is cancelled while the endpoint is only briefly down.

**Risk:** Low: longer recovery for orders that would have failed anyway; a permanently dead endpoint now takes about 7.5 s longer to give up.

**Rollback:** Delete the policy rule (and the part from the `use` list).

**Diff budget:** under 5 lines.

### D4 (R4) payment + crash + order_lost

**Patch:** Add the `journal` part to the `use` list of Rookie so a restarted process replays the payment stage from the journal (`Sdk.stage` already skips journaled stages) instead of losing the order.

**Files:** `apps/haunted-orders/src/bots/rookie.ts`, `packages/haunt/src/sdk/sdk.ts`

**Why:** Rookie keeps no journal, so a crash at payment forgets what the order already did and the restart cannot finish it.

**Risk:** Low: the journal is an append-only file per lane; a disk-full fault is already absorbed.

**Rollback:** Remove `journal` from the `use` list.

**Diff budget:** under 5 lines.

### D5 (R5) payment + endpoint_failure_rate + degraded

**Patch:** Add the `breaker` part to the `use` list of Rookie, Retrier, Journaler, Reconciler so repeated failures at payment open the circuit and back off (`Sdk.noteFailure` counts them).

**Files:** `apps/haunted-orders/src/bots/rookie.ts`, `apps/haunted-orders/src/bots/retrier.ts`, `apps/haunted-orders/src/bots/journaler.ts`, `apps/haunted-orders/src/bots/reconciler.ts`, `packages/haunt/src/sdk/sdk.ts`

**Why:** Rookie, Retrier, Journaler, Reconciler keeps calling a failing payment endpoint at a fixed pace, so every order pays the full retry cost.

**Risk:** Low: an open breaker pauses calls for 5 s.

**Rollback:** Remove `breaker` from the `use` list.

**Diff budget:** under 6 lines.

### D6 (R6) payment + http_404 + retry_storm

**Patch:** Add the `breaker` part to the `use` list of Retrier, Journaler, Reconciler so repeated failures at payment open the circuit and back off (`Sdk.noteFailure` counts them).

**Files:** `apps/haunted-orders/src/bots/retrier.ts`, `apps/haunted-orders/src/bots/journaler.ts`, `apps/haunted-orders/src/bots/reconciler.ts`, `packages/haunt/src/sdk/sdk.ts`

**Why:** Retrier, Journaler, Reconciler keeps calling a failing payment endpoint at a fixed pace, so every order pays the full retry cost.

**Risk:** Low: an open breaker pauses calls for 5 s.

**Rollback:** Remove `breaker` from the `use` list.

**Diff budget:** under 6 lines.

