# Hardening requirements tmwxlulnc

Run tmwxlulnc. 19 patterns, sorted by downtime cost. Each requirement has evidence, a patch (design.md) and a regression test (tasks.md).

## R1. login + endpoint_down + outage

WHEN the Account or login (`login`) endpoint is down for longer than the retry budget, THE bot SHALL park the order and resume it when the endpoint is back.

**Evidence:** run tmwxlulnc round 4; events seq 3395, 3403, 3405, 3453, 5253, 5488; report /api/waves/2/report, /api/waves/3/report.

**Impact:** downtime 141.9 s, 0 lost orders, 0 repeated effects, about 0 points; seen 14 times on lanes 2, 3, 4, 5 (Retrier, Journaler, Reconciler, Phoenix). Lost orders review as one star.

**Root-cause hypothesis:** The lane sits through every outage window at Account or login (`login`) in the foreground, so downtime equals the window.

**Covered by lessons:** lanes 5 can take `breaker_park` as a policy overlay.

## R2. login + slow_link + outage

WHEN the Account or login (`login`) endpoint is down for longer than the retry budget, THE bot SHALL park the order and resume it when the endpoint is back.

**Evidence:** run tmwxlulnc round 4; events seq 5128, 8754, 8836, 9340; report /api/waves/3/report, /api/waves/4/report.

**Impact:** downtime 11.9 s, 0 lost orders, 0 repeated effects, about 0 points; seen 4 times on lane 5 (Phoenix). Lost orders review as one star.

**Root-cause hypothesis:** The lane sits through every outage window at Account or login (`login`) in the foreground, so downtime equals the window.

**Covered by lessons:** lanes 5 can take `breaker_park` as a policy overlay.

## R3. login + power_outage + order_lost

WHEN power outage hits the Account or login (`login`) stage and the process dies, THE bot SHALL resume the order from its journal after the restart instead of cancelling it.

**Evidence:** run tmwxlulnc round 4; events seq 6718, 7126, 6746, 6749, 8227, 8231; journal .haunt/wave-4/lane-4/journal.jsonl:36, .haunt/wave-4/lane-4/journal.jsonl:37, .haunt/wave-4/lane-4/journal.jsonl:38; report /api/waves/4/report.

**Impact:** downtime 2.2 s, 3 lost orders, 0 repeated effects, about 900 points; seen 3 times on lanes 4, 5 (Reconciler, Phoenix). Lost orders review as one star.

**Root-cause hypothesis:** Reconciler, Phoenix keeps no journal, so a crash at Account or login (`login`) forgets what the order already did and the restart cannot finish it.

**Covered by lessons:** lanes 4, 5 can take `journal_replay` as a policy overlay.

## R4. entitlement + timeout + order_lost

WHEN timeout hits the Entitlement check (`entitlement`) stage, THE bot SHALL retry the call with exponential backoff (500 ms doubling, up to 5 attempts) before it fails the order.

**Evidence:** run tmwxlulnc round 4; events seq 4947, 5014, 4429, 4457, 4425, 4453; journal .haunt/wave-3/lane-3/journal.jsonl:11, .haunt/wave-3/lane-3/journal.jsonl:12, .haunt/wave-3/lane-3/journal.jsonl:24; report /api/waves/3/report, /api/waves/4/report.

**Impact:** downtime 1.9 s, 8 lost orders, 8 repeated effects, about 6304 points; seen 8 times on lanes 3, 4 (Journaler, Reconciler). Lost orders review as one star.

**Root-cause hypothesis:** Journaler, Reconciler makes at most three plain retries 500 ms apart, which is shorter than a typical timeout window, so the order is cancelled while the endpoint is only briefly down.

**Covered by lessons:** lanes 3, 4 can take `retry_backoff` as a policy overlay.

## R5. entitlement + curse_slow + reported

WHEN an endpoint answers with curse slow at the Entitlement check (`entitlement`) stage, THE bot SHALL report the failure in the log and park the order instead of skipping the step.

**Evidence:** run tmwxlulnc round 3; events seq 4429, 4457, 4425, 4453, 4579, 4590; journal .haunt/wave-3/lane-3/journal.jsonl:11, .haunt/wave-3/lane-3/journal.jsonl:12, .haunt/wave-3/lane-3/journal.jsonl:24; report /api/waves/3/report.

**Impact:** downtime 0.2 s, 0 lost orders, 0 repeated effects, about 0 points; seen 9 times on lane 3 (Journaler). Lost orders review as one star.

**Root-cause hypothesis:** The bot treats the odd answer as success or ignores it, so the step is skipped silently.

**Covered by lessons:** no tier that met it can take this as a policy; it needs the code change.

## R6. login + http_404 + duplicate_effect

WHEN http 404 hits the Account or login (`login`) stage and the call is retried, THE bot SHALL send the order's idempotency key so the effect is created at most once.

**Evidence:** run tmwxlulnc round 2; events seq 2239, 2949, 3902, 3980, 2248, 2952; journal .haunt/wave-2/lane-4/journal.jsonl:106, .haunt/wave-2/lane-4/journal.jsonl:107, .haunt/wave-2/lane-4/journal.jsonl:108; report /api/waves/2/report.

**Impact:** downtime 0.1 s, 0 lost orders, 6 repeated effects, about 1806 points; seen 3 times on lanes 2, 4, 5 (Retrier, Reconciler, Phoenix). Lost orders review as one star.

**Root-cause hypothesis:** Retrier retries the Account or login (`login`) call after http 404 without a key, so the provider cannot tell the retry from a new request and writes a second row.

**Covered by lessons:** lanes 4, 5 can take `idempotency_key` as a policy overlay.

## R7. login + http_429 + order_lost

WHEN http 429 hits the Account or login (`login`) stage, THE bot SHALL retry the call with exponential backoff (500 ms doubling, up to 5 attempts) before it fails the order.

**Evidence:** run tmwxlulnc round 4; events seq 4468, 4469, 4606, 4609, 4477, 4478; journal .haunt/wave-3/lane-4/journal.jsonl:36, .haunt/wave-3/lane-4/journal.jsonl:37, .haunt/wave-3/lane-4/journal.jsonl:38; report /api/waves/3/report, /api/waves/4/report.

**Impact:** downtime 0.1 s, 6 lost orders, 0 repeated effects, about 1800 points; seen 6 times on lanes 4, 5 (Reconciler, Phoenix). Lost orders review as one star.

**Root-cause hypothesis:** Reconciler, Phoenix makes at most three plain retries 500 ms apart, which is shorter than a typical http 429 window, so the order is cancelled while the endpoint is only briefly down.

**Covered by lessons:** lanes 4 can take `retry_backoff` as a policy overlay.

## R8. ads + endpoint_down + order_lost

WHEN endpoint down hits the Ads and pause or resume (`ads`) stage, THE bot SHALL retry the call with exponential backoff (500 ms doubling, up to 5 attempts) before it fails the order.

**Evidence:** run tmwxlulnc round 4; events seq 6678, 7450, 7851, 7855; journal .haunt/wave-4/lane-4/journal.jsonl:216, .haunt/wave-4/lane-4/journal.jsonl:217; report /api/waves/4/report.

**Impact:** downtime 0.0 s, 1 lost order, 0 repeated effects, about 300 points; seen 1 times on lane 4 (Reconciler). Lost orders review as one star.

**Root-cause hypothesis:** Reconciler makes at most three plain retries 500 ms apart, which is shorter than a typical endpoint down window, so the order is cancelled while the endpoint is only briefly down.

**Covered by lessons:** lanes 4 can take `retry_backoff` as a policy overlay.

## R9. entitlement + http_429 + order_lost

WHEN http 429 hits the Entitlement check (`entitlement`) stage, THE bot SHALL retry the call with exponential backoff (500 ms doubling, up to 5 attempts) before it fails the order.

**Evidence:** run tmwxlulnc round 3; events seq 4549, 4765, 4776, 4761, 4772, 4923; journal .haunt/wave-3/lane-3/journal.jsonl:37, .haunt/wave-3/lane-3/journal.jsonl:38, .haunt/wave-3/lane-3/journal.jsonl:50; report /api/waves/3/report.

**Impact:** downtime 0.0 s, 2 lost orders, 2 repeated effects, about 1500 points; seen 2 times on lane 3 (Journaler). Lost orders review as one star.

**Root-cause hypothesis:** Journaler makes at most three plain retries 500 ms apart, which is shorter than a typical http 429 window, so the order is cancelled while the endpoint is only briefly down.

**Covered by lessons:** lanes 3 can take `retry_backoff` as a policy overlay.

## R10. login + timeout + order_lost

WHEN timeout hits the Account or login (`login`) stage, THE bot SHALL retry the call with exponential backoff (500 ms doubling, up to 5 attempts) before it fails the order.

**Evidence:** run tmwxlulnc round 4; events seq 1360, 1542, 1543, 1707, 1708, 1373; journal .haunt/wave-3/lane-3/journal.jsonl:106, .haunt/wave-3/lane-3/journal.jsonl:107, .haunt/wave-3/lane-3/journal.jsonl:108; report /api/waves/1/report, /api/waves/3/report.

**Impact:** downtime 0.0 s, 6 lost orders, 0 repeated effects, about 1800 points; seen 6 times on lanes 1, 2, 3, 5 (Rookie, Retrier, Journaler, Phoenix). Lost orders review as one star.

**Root-cause hypothesis:** Rookie makes at most three plain retries 500 ms apart, which is shorter than a typical timeout window, so the order is cancelled while the endpoint is only briefly down.

**Covered by lessons:** lanes 2, 3 can take `retry_backoff` as a policy overlay.

## R11. login + crash + order_lost

WHEN crash hits the Account or login (`login`) stage and the process dies, THE bot SHALL resume the order from its journal after the restart instead of cancelling it.

**Evidence:** run tmwxlulnc round 3; events seq 5060, 5258, 5262; journal .haunt/wave-3/lane-4/journal.jsonl:111, .haunt/wave-3/lane-4/journal.jsonl:112, .haunt/wave-3/lane-4/journal.jsonl:113; report /api/waves/3/report.

**Impact:** downtime 0.0 s, 1 lost order, 0 repeated effects, about 300 points; seen 1 times on lane 4 (Reconciler). Lost orders review as one star.

**Root-cause hypothesis:** Reconciler keeps no journal, so a crash at Account or login (`login`) forgets what the order already did and the restart cannot finish it.

**Covered by lessons:** lanes 4 can take `journal_replay` as a policy overlay.

## R12. entitlement + endpoint_down + retry_storm

WHEN calls at the Entitlement check (`entitlement`) stage fail repeatedly, THE bot SHALL open a circuit breaker and back off instead of retrying in a storm.

**Evidence:** run tmwxlulnc round 3; events seq 5445, 5456, 5467, 5586, 5596, 5607; journal .haunt/wave-3/lane-3/journal.jsonl:90, .haunt/wave-3/lane-3/journal.jsonl:91, .haunt/wave-3/lane-3/journal.jsonl:103; report /api/waves/3/report.

**Impact:** downtime 0.0 s, 0 lost orders, 0 repeated effects, about 0 points; seen 3 times on lane 3 (Journaler). Lost orders review as one star.

**Root-cause hypothesis:** Journaler keeps calling a failing Entitlement check (`entitlement`) endpoint at a fixed pace, so every order pays the full retry cost.

**Covered by lessons:** no tier that met it can take this as a policy; it needs the code change.

## R13. entitlement + endpoint_failure_rate + degraded

WHEN calls at the Entitlement check (`entitlement`) stage fail repeatedly, THE bot SHALL open a circuit breaker and back off instead of retrying in a storm.

**Evidence:** run tmwxlulnc round 4; events seq 4425, 4453, 4481, 4575, 4586, 4597; report /api/waves/3/report, /api/waves/4/report.

**Impact:** downtime 0.0 s, 0 lost orders, 0 repeated effects, about 0 points; seen 65 times on lanes 3, 4, 5 (Journaler, Reconciler, Phoenix). Lost orders review as one star.

**Root-cause hypothesis:** Journaler, Reconciler keeps calling a failing Entitlement check (`entitlement`) endpoint at a fixed pace, so every order pays the full retry cost.

**Covered by lessons:** lanes 5 can take `breaker_park` as a policy overlay.

## R14. entitlement + http_429 + retry_storm

WHEN calls at the Entitlement check (`entitlement`) stage fail repeatedly, THE bot SHALL open a circuit breaker and back off instead of retrying in a storm.

**Evidence:** run tmwxlulnc round 4; events seq 4575, 4586, 4597, 4761, 4772, 4783; journal .haunt/wave-3/lane-3/journal.jsonl:24, .haunt/wave-3/lane-3/journal.jsonl:25, .haunt/wave-3/lane-3/journal.jsonl:37; report /api/waves/3/report, /api/waves/4/report.

**Impact:** downtime 0.0 s, 0 lost orders, 0 repeated effects, about 0 points; seen 3 times on lanes 3, 5 (Journaler, Phoenix). Lost orders review as one star.

**Root-cause hypothesis:** Journaler keeps calling a failing Entitlement check (`entitlement`) endpoint at a fixed pace, so every order pays the full retry cost.

**Covered by lessons:** lanes 5 can take `breaker_park` as a policy overlay.

## R15. entitlement + internet_outage + retry_storm

WHEN calls at the Entitlement check (`entitlement`) stage fail repeatedly, THE bot SHALL open a circuit breaker and back off instead of retrying in a storm.

**Evidence:** run tmwxlulnc round 4; events seq 7039, 7043, 7047, 7053, 7105, 7151; journal .haunt/wave-4/lane-5/journal.jsonl:88, .haunt/wave-4/lane-5/journal.jsonl:89, .haunt/wave-4/lane-5/journal.jsonl:91; report /api/waves/4/report.

**Impact:** downtime 0.0 s, 0 lost orders, 0 repeated effects, about 0 points; seen 3 times on lanes 4, 5 (Reconciler, Phoenix). Lost orders review as one star.

**Root-cause hypothesis:** Reconciler keeps calling a failing Entitlement check (`entitlement`) endpoint at a fixed pace, so every order pays the full retry cost.

**Covered by lessons:** lanes 5 can take `breaker_park` as a policy overlay.

## R16. login + endpoint_down + retry_storm

WHEN calls at the Account or login (`login`) stage fail repeatedly, THE bot SHALL open a circuit breaker and back off instead of retrying in a storm.

**Evidence:** run tmwxlulnc round 4; events seq 5333, 5344, 5355, 5367, 5689, 5692; journal .haunt/wave-3/lane-3/journal.jsonl:79, .haunt/wave-3/lane-3/journal.jsonl:80, .haunt/wave-3/lane-3/journal.jsonl:81; report /api/waves/3/report, /api/waves/4/report.

**Impact:** downtime 0.0 s, 0 lost orders, 0 repeated effects, about 0 points; seen 6 times on lanes 3, 4, 5 (Journaler, Reconciler, Phoenix). Lost orders review as one star.

**Root-cause hypothesis:** Journaler, Reconciler keeps calling a failing Account or login (`login`) endpoint at a fixed pace, so every order pays the full retry cost.

**Covered by lessons:** lanes 5 can take `breaker_park` as a policy overlay.

## R17. login + endpoint_failure_rate + degraded

WHEN calls at the Account or login (`login`) stage fail repeatedly, THE bot SHALL open a circuit breaker and back off instead of retrying in a storm.

**Evidence:** run tmwxlulnc round 4; events seq 4606, 4609, 4613, 4620, 4623, 4627; report /api/waves/3/report, /api/waves/4/report.

**Impact:** downtime 0.0 s, 0 lost orders, 0 repeated effects, about 0 points; seen 159 times on lanes 3, 4, 5 (Journaler, Reconciler, Phoenix). Lost orders review as one star.

**Root-cause hypothesis:** Journaler, Reconciler keeps calling a failing Account or login (`login`) endpoint at a fixed pace, so every order pays the full retry cost.

**Covered by lessons:** lanes 5 can take `breaker_park` as a policy overlay.

## R18. login + http_429 + retry_storm

WHEN calls at the Account or login (`login`) stage fail repeatedly, THE bot SHALL open a circuit breaker and back off instead of retrying in a storm.

**Evidence:** run tmwxlulnc round 4; events seq 1143, 1147, 1151, 4606, 4609, 4613; journal .haunt/wave-1/lane-5/journal.jsonl:107, .haunt/wave-1/lane-5/journal.jsonl:108, .haunt/wave-1/lane-5/journal.jsonl:109; report /api/waves/1/report, /api/waves/3/report.

**Impact:** downtime 0.0 s, 0 lost orders, 0 repeated effects, about 0 points; seen 7 times on lanes 4, 5 (Reconciler, Phoenix). Lost orders review as one star.

**Root-cause hypothesis:** Reconciler keeps calling a failing Account or login (`login`) endpoint at a fixed pace, so every order pays the full retry cost.

**Covered by lessons:** lanes 5 can take `breaker_park` as a policy overlay.

## R19. login + power_outage + retry_storm

WHEN calls at the Account or login (`login`) stage fail repeatedly, THE bot SHALL open a circuit breaker and back off instead of retrying in a storm.

**Evidence:** run tmwxlulnc round 4; events seq 6746, 6749, 6753, 6756, 6760, 6767; journal .haunt/wave-4/lane-4/journal.jsonl:36, .haunt/wave-4/lane-4/journal.jsonl:37, .haunt/wave-4/lane-4/journal.jsonl:38; report /api/waves/4/report.

**Impact:** downtime 0.0 s, 0 lost orders, 0 repeated effects, about 0 points; seen 5 times on lanes 4, 5 (Reconciler, Phoenix). Lost orders review as one star.

**Root-cause hypothesis:** Reconciler keeps calling a failing Account or login (`login`) endpoint at a fixed pace, so every order pays the full retry cost.

**Covered by lessons:** lanes 5 can take `breaker_park` as a policy overlay.

