# Hardening requirements tmwxlowoz

Run tmwxlowoz. 7 patterns, sorted by downtime cost. Each requirement has evidence, a patch (design.md) and a regression test (tasks.md).

## R1. pay + endpoint_down + outage

WHEN the Take payment (`pay`) endpoint is down for longer than the retry budget, THE bot SHALL park the order and resume it when the endpoint is back.

**Evidence:** run tmwxlggpg round 4; events seq 2789, 2862, 1524, 1650, 1667, 1669; report /api/waves/3/report, /api/waves/2/report.

**Impact:** downtime 161.2 s, 0 lost orders, 0 repeated effects, about 0 points; seen 17 times on lanes 1, 2, 3, 5 (Rookie, Retrier, Journaler, Phoenix). Lost orders review as one star.

**Root-cause hypothesis:** The lane sits through every outage window at Take payment (`pay`) in the foreground, so downtime equals the window.

**Covered by lessons:** lanes 5 can take `breaker_park` as a policy overlay.

## R2. pay + slow_link + outage

WHEN the Take payment (`pay`) endpoint is down for longer than the retry budget, THE bot SHALL park the order and resume it when the endpoint is back.

**Evidence:** run tmwxlggpg round 4; events seq 2254, 2327, 2166, 2169, 2434, 4713; report /api/waves/3/report, /api/waves/4/report.

**Impact:** downtime 29.8 s, 0 lost orders, 0 repeated effects, about 0 points; seen 9 times on lanes 2, 3, 5 (Retrier, Journaler, Phoenix). Lost orders review as one star.

**Root-cause hypothesis:** The lane sits through every outage window at Take payment (`pay`) in the foreground, so downtime equals the window.

**Covered by lessons:** lanes 5 can take `breaker_park` as a policy overlay.

## R3. pay + internet_outage + order_lost

WHEN internet outage hits the Take payment (`pay`) stage, THE bot SHALL retry the call with exponential backoff (500 ms doubling, up to 5 attempts) before it fails the order.

**Evidence:** run tmwxlowoz round 4; events seq 4528, 4897, 4503, 4507, 4529, 4654; journal .haunt/wave-4/lane-5/journal.jsonl:16, .haunt/wave-4/lane-5/journal.jsonl:17, .haunt/wave-4/lane-5/journal.jsonl:18; report /api/waves/4/report.

**Impact:** downtime 0.4 s, 5 lost orders, 0 repeated effects, about 1535 points; seen 5 times on lanes 2, 5 (Retrier, Phoenix). Lost orders review as one star.

**Root-cause hypothesis:** Retrier, Phoenix makes at most three plain retries 500 ms apart, which is shorter than a typical internet outage window, so the order is cancelled while the endpoint is only briefly down.

**Covered by lessons:** lanes 2 can take `retry_backoff` as a policy overlay.

## R4. pay + power_outage + order_lost

WHEN power outage hits the Take payment (`pay`) stage and the process dies, THE bot SHALL resume the order from its journal after the restart instead of cancelling it.

**Evidence:** run tmwxlowoz round 4; events seq 4487, 4796, 4805; journal .haunt/wave-4/lane-5/journal.jsonl:73, .haunt/wave-4/lane-5/journal.jsonl:74, .haunt/wave-4/lane-5/journal.jsonl:297; report /api/waves/4/report.

**Impact:** downtime 0.0 s, 1 lost order, 0 repeated effects, about 300 points; seen 1 times on lane 5 (Phoenix). Lost orders review as one star.

**Root-cause hypothesis:** Phoenix keeps no journal, so a crash at Take payment (`pay`) forgets what the order already did and the restart cannot finish it.

**Covered by lessons:** lanes 5 can take `journal_replay` as a policy overlay.

## R5. pay + http_429 + retry_storm

WHEN calls at the Take payment (`pay`) stage fail repeatedly, THE bot SHALL open a circuit breaker and back off instead of retrying in a storm.

**Evidence:** run tmwxlggpg round 4; events seq 2481, 2489, 2497, 2511, 2520, 2531; journal .haunt/wave-3/lane-3/journal.jsonl:21, .haunt/wave-3/lane-3/journal.jsonl:22, .haunt/wave-3/lane-3/journal.jsonl:23; report /api/waves/3/report, /api/waves/4/report.

**Impact:** downtime 0.0 s, 0 lost orders, 0 repeated effects, about 0 points; seen 7 times on lanes 2, 3, 5 (Retrier, Journaler, Phoenix). Lost orders review as one star.

**Root-cause hypothesis:** Retrier, Journaler keeps calling a failing Take payment (`pay`) endpoint at a fixed pace, so every order pays the full retry cost.

**Covered by lessons:** lanes 5 can take `breaker_park` as a policy overlay.

## R6. pay + http_500 + retry_storm

WHEN calls at the Take payment (`pay`) stage fail repeatedly, THE bot SHALL open a circuit breaker and back off instead of retrying in a storm.

**Evidence:** run tmwxlowoz round 4; events seq 4618, 4621, 4624, 4628, 5184, 5188; journal .haunt/wave-4/lane-5/journal.jsonl:28, .haunt/wave-4/lane-5/journal.jsonl:29, .haunt/wave-4/lane-5/journal.jsonl:95; report /api/waves/4/report.

**Impact:** downtime 0.0 s, 0 lost orders, 0 repeated effects, about 0 points; seen 4 times on lanes 2, 5 (Retrier, Phoenix). Lost orders review as one star.

**Root-cause hypothesis:** Retrier keeps calling a failing Take payment (`pay`) endpoint at a fixed pace, so every order pays the full retry cost.

**Covered by lessons:** lanes 5 can take `breaker_park` as a policy overlay.

## R7. ready + endpoint_failure_rate + degraded

WHEN calls at the Call the name (`ready`) stage fail repeatedly, THE bot SHALL open a circuit breaker and back off instead of retrying in a storm.

**Evidence:** run tmwxlowoz round 4; events seq 2675, 2679, 2683, 2688, 2735, 2770; report /api/waves/3/report, /api/waves/4/report.

**Impact:** downtime 0.0 s, 0 lost orders, 0 repeated effects, about 0 points; seen 48 times on lane 5 (Phoenix). Lost orders review as one star.

**Root-cause hypothesis:** Phoenix keeps calling a failing Call the name (`ready`) endpoint at a fixed pace, so every order pays the full retry cost.

**Covered by lessons:** lanes 5 can take `breaker_park` as a policy overlay.

