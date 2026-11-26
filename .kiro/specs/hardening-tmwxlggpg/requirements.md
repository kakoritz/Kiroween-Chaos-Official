# Hardening requirements tmwxlggpg

Run tmwxlggpg. 7 patterns, sorted by downtime cost. Each requirement has evidence, a patch (design.md) and a regression test (tasks.md).

## R1. unknown + endpoint_down + outage

WHEN the unknown endpoint is down for longer than the retry budget, THE bot SHALL park the order and resume it when the endpoint is back.

**Evidence:** run tmwxlggpg round 4; events seq 1596, 1605, 1607, 1609, 2698, 2700; report /api/waves/2/report, /api/waves/3/report.

**Impact:** downtime 140.6 s, 0 lost orders, 0 repeated effects, about 0 points; seen 14 times on lanes 2, 3, 4, 5 (Retrier, Journaler, Reconciler, Phoenix). Lost orders review as one star.

**Root-cause hypothesis:** The lane sits through every outage window at unknown in the foreground, so downtime equals the window.

**Covered by lessons:** lanes 5 can take `breaker_park` as a policy overlay.

## R2. unknown + slow_link + outage

WHEN the unknown endpoint is down for longer than the retry budget, THE bot SHALL park the order and resume it when the endpoint is back.

**Evidence:** run tmwxlggpg round 4; events seq 2165, 2168, 3836, 3841, 3901, 3903; report /api/waves/3/report, /api/waves/4/report.

**Impact:** downtime 18.6 s, 0 lost orders, 0 repeated effects, about 0 points; seen 6 times on lanes 4, 5 (Reconciler, Phoenix). Lost orders review as one star.

**Root-cause hypothesis:** The lane sits through every outage window at unknown in the foreground, so downtime equals the window.

**Covered by lessons:** lanes 5 can take `breaker_park` as a policy overlay.

## R3. pay + endpoint_down + order_lost

WHEN endpoint down hits the Take payment (`pay`) stage, THE bot SHALL retry the call with exponential backoff (500 ms doubling, up to 5 attempts) before it fails the order.

**Evidence:** run tmwxlggpg round 3; events seq 2788, 2754, 2765, 2750, 2761, 2910; journal .haunt/wave-3/lane-3/journal.jsonl:33, .haunt/wave-3/lane-3/journal.jsonl:34, .haunt/wave-3/lane-3/journal.jsonl:35; report /api/waves/3/report.

**Impact:** downtime 0.7 s, 3 lost orders, 3 repeated effects, about 3000 points; seen 3 times on lane 3 (Journaler). Lost orders review as one star.

**Root-cause hypothesis:** Journaler makes at most three plain retries 500 ms apart, which is shorter than a typical endpoint down window, so the order is cancelled while the endpoint is only briefly down.

**Covered by lessons:** lanes 3 can take `retry_backoff` as a policy overlay.

## R4. pay + http_429 + order_lost

WHEN http 429 hits the Take payment (`pay`) stage, THE bot SHALL retry the call with exponential backoff (500 ms doubling, up to 5 attempts) before it fails the order.

**Evidence:** run tmwxlggpg round 3; events seq 2252, 2385, 2219, 2230, 2215, 2226; journal .haunt/wave-3/lane-3/journal.jsonl:9, .haunt/wave-3/lane-3/journal.jsonl:10, .haunt/wave-3/lane-3/journal.jsonl:11; report /api/waves/3/report.

**Impact:** downtime 0.7 s, 3 lost orders, 3 repeated effects, about 2850 points; seen 3 times on lane 3 (Journaler). Lost orders review as one star.

**Root-cause hypothesis:** Journaler makes at most three plain retries 500 ms apart, which is shorter than a typical http 429 window, so the order is cancelled while the endpoint is only briefly down.

**Covered by lessons:** lanes 3 can take `retry_backoff` as a policy overlay.

## R5. pay + slow_link + order_lost

WHEN slow link hits the Take payment (`pay`) stage, THE bot SHALL retry the call with exponential backoff (500 ms doubling, up to 5 attempts) before it fails the order.

**Evidence:** run tmwxlggpg round 3; events seq 2253, 3189, 2219, 2230, 2215, 2226; journal .haunt/wave-3/lane-3/journal.jsonl:9, .haunt/wave-3/lane-3/journal.jsonl:10, .haunt/wave-3/lane-3/journal.jsonl:11; report /api/waves/3/report.

**Impact:** downtime 0.5 s, 2 lost orders, 2 repeated effects, about 2100 points; seen 2 times on lane 3 (Journaler). Lost orders review as one star.

**Root-cause hypothesis:** Journaler makes at most three plain retries 500 ms apart, which is shorter than a typical slow link window, so the order is cancelled while the endpoint is only briefly down.

**Covered by lessons:** lanes 3 can take `retry_backoff` as a policy overlay.

## R6. pay + http_500 + order_lost

WHEN http 500 hits the Take payment (`pay`) stage, THE bot SHALL retry the call with exponential backoff (500 ms doubling, up to 5 attempts) before it fails the order.

**Evidence:** run tmwxlggpg round 3; events seq 2384, 2363, 2379, 2350, 2359; journal .haunt/wave-3/lane-3/journal.jsonl:15, .haunt/wave-3/lane-3/journal.jsonl:16, .haunt/wave-3/lane-3/journal.jsonl:17; report /api/waves/3/report.

**Impact:** downtime 0.3 s, 1 lost order, 1 repeated effect, about 750 points; seen 1 times on lane 3 (Journaler). Lost orders review as one star.

**Root-cause hypothesis:** Journaler makes at most three plain retries 500 ms apart, which is shorter than a typical http 500 window, so the order is cancelled while the endpoint is only briefly down.

**Covered by lessons:** lanes 3 can take `retry_backoff` as a policy overlay.

## R7. pay + endpoint_down + retry_storm

WHEN calls at the Take payment (`pay`) stage fail repeatedly, THE bot SHALL open a circuit breaker and back off instead of retrying in a storm.

**Evidence:** run tmwxlggpg round 3; events seq 2884, 2892, 2901, 2917, 2928, 2939; journal .haunt/wave-3/lane-3/journal.jsonl:39, .haunt/wave-3/lane-3/journal.jsonl:40, .haunt/wave-3/lane-3/journal.jsonl:41; report /api/waves/3/report.

**Impact:** downtime 0.0 s, 0 lost orders, 0 repeated effects, about 0 points; seen 3 times on lane 3 (Journaler). Lost orders review as one star.

**Root-cause hypothesis:** Journaler keeps calling a failing Take payment (`pay`) endpoint at a fixed pace, so every order pays the full retry cost.

**Covered by lessons:** no tier that met it can take this as a policy; it needs the code change.

