# Hardening requirements tmwxll5oj

Run tmwxll5oj. 9 patterns, sorted by downtime cost. Each requirement has evidence, a patch (design.md) and a regression test (tasks.md).

## R1. unknown + internet_outage + outage

WHEN the unknown endpoint is down for longer than the retry budget, THE bot SHALL park the order and resume it when the endpoint is back.

**Evidence:** run tmwxlggpg round 3; events seq 2867, 2870, 2938, 2941; report /api/waves/3/report.

**Impact:** downtime 12.2 s, 0 lost orders, 0 repeated effects, about 0 points; seen 4 times on lanes 4, 5 (Reconciler, Phoenix). Lost orders review as one star.

**Root-cause hypothesis:** The lane sits through every outage window at unknown in the foreground, so downtime equals the window.

**Covered by lessons:** lanes 5 can take `breaker_park` as a policy overlay.

## R2. pay + http_404 + duplicate_effect

WHEN http 404 hits the Take payment (`pay`) stage and the call is retried, THE bot SHALL send the order's idempotency key so the effect is created at most once.

**Evidence:** run tmwxlggpg round 2; events seq 1096, 1374, 1799, 1097, 1371, 1745; journal .haunt/wave-2/lane-3/journal.jsonl:81, .haunt/wave-2/lane-3/journal.jsonl:82, .haunt/wave-2/lane-3/journal.jsonl:83; report /api/waves/2/report.

**Impact:** downtime 0.0 s, 0 lost orders, 3 repeated effects, about 906 points; seen 3 times on lanes 2, 3 (Retrier, Journaler). Lost orders review as one star.

**Root-cause hypothesis:** Retrier, Journaler retries the Take payment (`pay`) call after http 404 without a key, so the provider cannot tell the retry from a new request and writes a second row.

**Covered by lessons:** no tier that met it can take this as a policy; it needs the code change.

## R3. pay + crash + duplicate_effect

WHEN crash hits the Take payment (`pay`) stage and the call is retried, THE bot SHALL send the order's idempotency key so the effect is created at most once.

**Evidence:** run tmwxlggpg round 1; events seq 68, 207, 234, 67, 198, 225; report /api/waves/1/report.

**Impact:** downtime 0.0 s, 0 lost orders, 8 repeated effects, about 2408 points; seen 4 times on lanes 1, 2 (Rookie, Retrier). Lost orders review as one star.

**Root-cause hypothesis:** Rookie, Retrier retries the Take payment (`pay`) call after crash without a key, so the provider cannot tell the retry from a new request and writes a second row.

**Covered by lessons:** no tier that met it can take this as a policy; it needs the code change.

## R4. ready + timeout + order_lost

WHEN timeout hits the Call the name (`ready`) stage, THE bot SHALL retry the call with exponential backoff (500 ms doubling, up to 5 attempts) before it fails the order.

**Evidence:** run tmwxll5oj round 2; events seq 1067, 1069, 1166, 1168, 1253, 1255; report /api/waves/2/report.

**Impact:** downtime 0.0 s, 6 lost orders, 0 repeated effects, about 1800 points; seen 6 times on lane 1 (Rookie). Lost orders review as one star.

**Root-cause hypothesis:** Rookie makes at most three plain retries 500 ms apart, which is shorter than a typical timeout window, so the order is cancelled while the endpoint is only briefly down.

**Covered by lessons:** no tier that met it can take this as a policy; it needs the code change.

## R5. ready + http_404 + order_lost

WHEN http 404 hits the Call the name (`ready`) stage, THE bot SHALL retry the call with exponential backoff (500 ms doubling, up to 5 attempts) before it fails the order.

**Evidence:** run tmwxll5oj round 2; events seq 1103, 1351, 1481, 1514, 1516, 1715; report /api/waves/2/report.

**Impact:** downtime 0.0 s, 2 lost orders, 2 repeated effects, about 1204 points; seen 2 times on lane 1 (Rookie). Lost orders review as one star.

**Root-cause hypothesis:** Rookie makes at most three plain retries 500 ms apart, which is shorter than a typical http 404 window, so the order is cancelled while the endpoint is only briefly down.

**Covered by lessons:** no tier that met it can take this as a policy; it needs the code change.

## R6. ready + curse_slow + crashed

WHEN an endpoint answers with curse slow at the Call the name (`ready`) stage, THE bot SHALL report the failure in the log and park the order instead of skipping the step.

**Evidence:** run tmwxll5oj round 2; events seq 1481, 1514, 1516, 1715, 1736, 1738; report /api/waves/2/report.

**Impact:** downtime 0.0 s, 2 lost orders, 0 repeated effects, about 1200 points; seen 2 times on lane 1 (Rookie). Lost orders review as one star.

**Root-cause hypothesis:** The bot treats the odd answer as success or ignores it, so the step is skipped silently.

**Covered by lessons:** no tier that met it can take this as a policy; it needs the code change.

## R7. pay + slow_link + retry_storm

WHEN calls at the Take payment (`pay`) stage fail repeatedly, THE bot SHALL open a circuit breaker and back off instead of retrying in a storm.

**Evidence:** run tmwxlggpg round 3; events seq 2350, 2359, 2370, 2388, 2396, 2404; journal .haunt/wave-3/lane-3/journal.jsonl:15, .haunt/wave-3/lane-3/journal.jsonl:16, .haunt/wave-3/lane-3/journal.jsonl:17; report /api/waves/3/report.

**Impact:** downtime 0.0 s, 0 lost orders, 0 repeated effects, about 0 points; seen 4 times on lane 3 (Journaler). Lost orders review as one star.

**Root-cause hypothesis:** Journaler keeps calling a failing Take payment (`pay`) endpoint at a fixed pace, so every order pays the full retry cost.

**Covered by lessons:** no tier that met it can take this as a policy; it needs the code change.

## R8. pay + timeout + retry_storm

WHEN calls at the Take payment (`pay`) stage fail repeatedly, THE bot SHALL open a circuit breaker and back off instead of retrying in a storm.

**Evidence:** run tmwxlggpg round 3; events seq 2607, 2618, 2629, 2645, 2657, 2668; journal .haunt/wave-3/lane-3/journal.jsonl:27, .haunt/wave-3/lane-3/journal.jsonl:28, .haunt/wave-3/lane-3/journal.jsonl:29; report /api/waves/3/report.

**Impact:** downtime 0.0 s, 0 lost orders, 0 repeated effects, about 0 points; seen 4 times on lane 3 (Journaler). Lost orders review as one star.

**Root-cause hypothesis:** Journaler keeps calling a failing Take payment (`pay`) endpoint at a fixed pace, so every order pays the full retry cost.

**Covered by lessons:** no tier that met it can take this as a policy; it needs the code change.

## R9. ready + curse_slow + reported

WHEN an endpoint answers with curse slow at the Call the name (`ready`) stage, THE bot SHALL report the failure in the log and park the order instead of skipping the step.

**Evidence:** run tmwxll5oj round 2; events seq 1067, 1069, 1166, 1168, 1253, 1255; report /api/waves/2/report.

**Impact:** downtime 0.0 s, 0 lost orders, 0 repeated effects, about 0 points; seen 6 times on lane 1 (Rookie). Lost orders review as one star.

**Root-cause hypothesis:** The bot treats the odd answer as success or ignores it, so the step is skipped silently.

**Covered by lessons:** no tier that met it can take this as a policy; it needs the code change.

