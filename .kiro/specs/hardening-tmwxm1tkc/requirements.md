# Hardening requirements tmwxm1tkc

Run tmwxm1tkc. 5 patterns, sorted by downtime cost. Each requirement has evidence, a patch (design.md) and a regression test (tasks.md).

## R1. login + internet_outage + outage

WHEN the Account or login (`login`) endpoint is down for longer than the retry budget, THE bot SHALL park the order and resume it when the endpoint is back.

**Evidence:** run tmwxlulnc round 3; events seq 5815, 6292, 5834, 6310; report /api/waves/3/report.

**Impact:** downtime 12.2 s, 0 lost orders, 0 repeated effects, about 0 points; seen 4 times on lanes 4, 5 (Reconciler, Phoenix). Lost orders review as one star.

**Root-cause hypothesis:** The lane sits through every outage window at Account or login (`login`) in the foreground, so downtime equals the window.

**Covered by lessons:** lanes 5 can take `breaker_park` as a policy overlay.

## R2. finish + endpoint_down + order_lost

WHEN endpoint down hits the Finish and history (`finish`) stage, THE bot SHALL retry the call with exponential backoff (500 ms doubling, up to 5 attempts) before it fails the order.

**Evidence:** run tmwxm1tkc round 4; events seq 6700, 7470, 7877, 7881; journal .haunt/wave-4/lane-4/journal.jsonl:220, .haunt/wave-4/lane-4/journal.jsonl:221; report /api/waves/4/report.

**Impact:** downtime 0.0 s, 1 lost order, 0 repeated effects, about 300 points; seen 1 times on lane 4 (Reconciler). Lost orders review as one star.

**Root-cause hypothesis:** Reconciler makes at most three plain retries 500 ms apart, which is shorter than a typical endpoint down window, so the order is cancelled while the endpoint is only briefly down.

**Covered by lessons:** lanes 4 can take `retry_backoff` as a policy overlay.

## R3. login + crash + duplicate_effect

WHEN crash hits the Account or login (`login`) stage and the call is retried, THE bot SHALL send the order's idempotency key so the effect is created at most once.

**Evidence:** run tmwxlulnc round 1; events seq 41, 163, 316, 42, 175, 325; report /api/waves/1/report.

**Impact:** downtime 0.0 s, 0 lost orders, 8 repeated effects, about 2408 points; seen 4 times on lanes 1, 2 (Rookie, Retrier). Lost orders review as one star.

**Root-cause hypothesis:** Rookie, Retrier retries the Account or login (`login`) call after crash without a key, so the provider cannot tell the retry from a new request and writes a second row.

**Covered by lessons:** no tier that met it can take this as a policy; it needs the code change.

## R4. entitlement + timeout + retry_storm

WHEN calls at the Entitlement check (`entitlement`) stage fail repeatedly, THE bot SHALL open a circuit breaker and back off instead of retrying in a storm.

**Evidence:** run tmwxlulnc round 3; events seq 5088, 5099, 5110, 5224, 5235, 5246; journal .haunt/wave-3/lane-3/journal.jsonl:63, .haunt/wave-3/lane-3/journal.jsonl:64, .haunt/wave-3/lane-3/journal.jsonl:76; report /api/waves/3/report.

**Impact:** downtime 0.0 s, 0 lost orders, 0 repeated effects, about 0 points; seen 4 times on lane 3 (Journaler). Lost orders review as one star.

**Root-cause hypothesis:** Journaler keeps calling a failing Entitlement check (`entitlement`) endpoint at a fixed pace, so every order pays the full retry cost.

**Covered by lessons:** no tier that met it can take this as a policy; it needs the code change.

## R5. login + timeout + retry_storm

WHEN calls at the Account or login (`login`) stage fail repeatedly, THE bot SHALL open a circuit breaker and back off instead of retrying in a storm.

**Evidence:** run tmwxlulnc round 4; events seq 1551, 1554, 1558, 6817, 8287, 8305; journal .haunt/wave-4/lane-5/journal.jsonl:45, .haunt/wave-4/lane-5/journal.jsonl:46, .haunt/wave-4/lane-5/journal.jsonl:223; report /api/waves/1/report, /api/waves/4/report.

**Impact:** downtime 0.0 s, 0 lost orders, 0 repeated effects, about 0 points; seen 4 times on lanes 2, 5 (Retrier, Phoenix). Lost orders review as one star.

**Root-cause hypothesis:** Retrier keeps calling a failing Account or login (`login`) endpoint at a fixed pace, so every order pays the full retry cost.

**Covered by lessons:** lanes 5 can take `breaker_park` as a policy overlay.

