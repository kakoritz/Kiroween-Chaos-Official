# Hardening requirements tmwxlcs3j

Run tmwxlcs3j. 5 patterns, sorted by downtime cost. Each requirement has evidence, a patch (design.md) and a regression test (tasks.md).

## R1. pay + timeout + order_lost

WHEN timeout hits the Take payment (`pay`) stage, THE bot SHALL retry the call with exponential backoff (500 ms doubling, up to 5 attempts) before it fails the order.

**Evidence:** run tmwxlcs3j round 3; events seq 1807, 1852, 1803, 1826, 1891, 1902; journal .haunt/wave-3/lane-3/journal.jsonl:3, .haunt/wave-3/lane-3/journal.jsonl:4, .haunt/wave-3/lane-3/journal.jsonl:8; report /api/waves/3/report.

**Impact:** downtime 0.3 s, 10 lost orders, 10 repeated effects, about 7500 points; seen 10 times on lane 3 (Journaler). Lost orders review as one star.

**Root-cause hypothesis:** Journaler makes at most three plain retries 500 ms apart, which is shorter than a typical timeout window, so the order is cancelled while the endpoint is only briefly down.

**Covered by lessons:** lanes 3 can take `retry_backoff` as a policy overlay.

## R2. pay + curse_slow + reported

WHEN an endpoint answers with curse slow at the Take payment (`pay`) stage, THE bot SHALL report the failure in the log and park the order instead of skipping the step.

**Evidence:** run tmwxlcs3j round 3; events seq 1807, 1852, 1803, 1826, 1891, 1902; journal .haunt/wave-3/lane-3/journal.jsonl:3, .haunt/wave-3/lane-3/journal.jsonl:4, .haunt/wave-3/lane-3/journal.jsonl:8; report /api/waves/3/report.

**Impact:** downtime 0.3 s, 0 lost orders, 0 repeated effects, about 0 points; seen 10 times on lane 3 (Journaler). Lost orders review as one star.

**Root-cause hypothesis:** The bot treats the odd answer as success or ignores it, so the step is skipped silently.

**Covered by lessons:** no tier that met it can take this as a policy; it needs the code change.

## R3. assign + wrong_queue + retry_storm

WHEN calls at the assign stage fail repeatedly, THE bot SHALL open a circuit breaker and back off instead of retrying in a storm.

**Evidence:** run tmwwx3dse round 2; events seq 1693, 1724, 1741, 1697, 1718, 1745; report /api/waves/2/report.

**Impact:** downtime 0.0 s, 0 lost orders, 0 repeated effects, about 0 points; seen 13 times on lane 2 (Retrier). Lost orders review as one star.

**Root-cause hypothesis:** Retrier keeps calling a failing assign endpoint at a fixed pace, so every order pays the full retry cost.

**Covered by lessons:** no tier that met it can take this as a policy; it needs the code change.

## R4. pay + endpoint_failure_rate + degraded

WHEN calls at the Take payment (`pay`) stage fail repeatedly, THE bot SHALL open a circuit breaker and back off instead of retrying in a storm.

**Evidence:** run tmwxlcs3j round 3; events seq 1803, 1826, 1859, 1887, 1898, 1909; report /api/waves/3/report.

**Impact:** downtime 0.0 s, 0 lost orders, 0 repeated effects, about 0 points; seen 30 times on lane 3 (Journaler). Lost orders review as one star.

**Root-cause hypothesis:** Journaler keeps calling a failing Take payment (`pay`) endpoint at a fixed pace, so every order pays the full retry cost.

**Covered by lessons:** no tier that met it can take this as a policy; it needs the code change.

## R5. pay + errors + retry_storm

WHEN calls at the Take payment (`pay`) stage fail repeatedly, THE bot SHALL open a circuit breaker and back off instead of retrying in a storm.

**Evidence:** run tmwxlcs3j round 3; events seq 1803, 1826, 1859, 1887, 1898, 1909; journal .haunt/wave-3/lane-3/journal.jsonl:3, .haunt/wave-3/lane-3/journal.jsonl:4, .haunt/wave-3/lane-3/journal.jsonl:8; report /api/waves/3/report.

**Impact:** downtime 0.0 s, 0 lost orders, 0 repeated effects, about 0 points; seen 10 times on lane 3 (Journaler). Lost orders review as one star.

**Root-cause hypothesis:** Journaler keeps calling a failing Take payment (`pay`) endpoint at a fixed pace, so every order pays the full retry cost.

**Covered by lessons:** no tier that met it can take this as a policy; it needs the code change.

