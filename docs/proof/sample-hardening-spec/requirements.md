# Hardening requirements imp-mwrw6vu6

Run imp-mwrw6vu6. 5 patterns, sorted by downtime cost. Each requirement has evidence, a patch (design.md) and a regression test (tasks.md).

## R1. account + slow_link + outage

WHEN the account endpoint is down for longer than the retry budget, THE bot SHALL park the order and resume it when the endpoint is back.

**Evidence:** run tmwrw6vu7 round 2; events seq 2284, 2286, 2288, 2317; report /api/waves/2/report.

**Impact:** downtime 10.3 s, 0 lost orders, 0 repeated effects, about 0 points; seen 4 times on lanes 2, 3, 4, 5 (Retrier, Journaler, Reconciler, Phoenix). Lost orders review as one star.

**Root-cause hypothesis:** The lane sits through every outage window at account in the foreground, so downtime equals the window.

**Covered by lessons:** no tier that met it can take this as a policy; it needs the code change.

## R2. payment + crash + order_lost

WHEN crash hits the payment stage and the process dies, THE bot SHALL resume the order from its journal after the restart instead of cancelling it.

**Evidence:** run tmwrw6vu7 round 2; events seq 3088, 3305, 3464, 3469, 3111, 3426; journal .haunt/wave-2/lane-3/journal.jsonl:135, .haunt/wave-2/lane-3/journal.jsonl:136, .haunt/wave-2/lane-4/journal.jsonl:135; report /api/waves/2/report.

**Impact:** downtime 0.1 s, 3 lost orders, 0 repeated effects, about 900 points; seen 3 times on lanes 2, 3, 4 (Retrier, Journaler, Reconciler). Lost orders review as one star.

**Root-cause hypothesis:** Retrier keeps no journal, so a crash at payment forgets what the order already did and the restart cannot finish it.

**Covered by lessons:** no tier that met it can take this as a policy; it needs the code change.

## R3. payment + http_404 + order_lost

WHEN http 404 hits the payment stage, THE bot SHALL retry the call with exponential backoff (500 ms doubling, up to 5 attempts) before it fails the order.

**Evidence:** run tmwrw6vu7 round 1; events seq 1114, 1634, 1635, 1807, 1808, 1125; journal .haunt/wave-1/lane-3/journal.jsonl:135, .haunt/wave-1/lane-3/journal.jsonl:136, .haunt/wave-1/lane-4/journal.jsonl:135; report /api/waves/1/report.

**Impact:** downtime 0.0 s, 5 lost orders, 0 repeated effects, about 1500 points; seen 5 times on lanes 1, 2, 3, 4 (Rookie, Retrier, Journaler, Reconciler). Lost orders review as one star.

**Root-cause hypothesis:** Rookie makes at most three plain retries 500 ms apart, which is shorter than a typical http 404 window, so the order is cancelled while the endpoint is only briefly down.

**Covered by lessons:** lanes 2, 3, 4 can take `retry_backoff` as a policy overlay.

## R4. payment + endpoint_failure_rate + degraded

WHEN calls at the payment stage fail repeatedly, THE bot SHALL open a circuit breaker and back off instead of retrying in a storm.

**Evidence:** run tmwrw6vu7 round 2; events seq 1533, 1538, 1544, 1554, 1560, 1566; report /api/waves/1/report, /api/waves/2/report.

**Impact:** downtime 0.0 s, 0 lost orders, 0 repeated effects, about 0 points; seen 30 times on lanes 1, 2, 3, 4, 5 (Rookie, Retrier, Journaler, Reconciler, Phoenix). Lost orders review as one star.

**Root-cause hypothesis:** Rookie, Retrier, Journaler, Reconciler keeps calling a failing payment endpoint at a fixed pace, so every order pays the full retry cost.

**Covered by lessons:** no tier that met it can take this as a policy; it needs the code change.

## R5. payment + http_404 + retry_storm

WHEN calls at the payment stage fail repeatedly, THE bot SHALL open a circuit breaker and back off instead of retrying in a storm.

**Evidence:** run tmwrw6vu7 round 1; events seq 1533, 1538, 1544, 1554, 1560, 1566; journal .haunt/wave-1/lane-3/journal.jsonl:135, .haunt/wave-1/lane-3/journal.jsonl:136, .haunt/wave-1/lane-4/journal.jsonl:135; report /api/waves/1/report.

**Impact:** downtime 0.0 s, 0 lost orders, 0 repeated effects, about 0 points; seen 4 times on lanes 2, 3, 4, 5 (Retrier, Journaler, Reconciler, Phoenix). Lost orders review as one star.

**Root-cause hypothesis:** Retrier, Journaler, Reconciler keeps calling a failing payment endpoint at a fixed pace, so every order pays the full retry cost.

**Covered by lessons:** no tier that met it can take this as a policy; it needs the code change.

