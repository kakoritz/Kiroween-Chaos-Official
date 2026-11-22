# Hardening imp-mwrw6vu6

5 fixes for the patterns above the threshold (count 3, any lost order, or over 30 s of downtime), sorted by downtime cost. Written by the pattern miner; Kiro applies a spec with the review step, never automatically.

| # | Pattern | Downtime | Lost | Repeats | Status when written | Lessons cover it |
|---|---|---|---|---|---|---|
| 1 | `account + slow_link + outage` | 10.3 s | 0 | 0 | new | no |
| 2 | `payment + crash + order_lost` | 0.1 s | 3 | 0 | new | no |
| 3 | `payment + http_404 + order_lost` | 0.0 s | 5 | 0 | new | yes (lanes 2, 3, 4) |
| 4 | `payment + endpoint_failure_rate + degraded` | 0.0 s | 0 | 0 | new | no |
| 5 | `payment + http_404 + retry_storm` | 0.0 s | 0 | 0 | new | no |

## Expected grade change

Over 45 orders these patterns cost 8 lost orders and 0 repeated effects: reliability 82 (grade B) now, about 100 (grade A) once every requirement holds. Rerun the tournament with seed 7 and the same rounds to verify; a pattern is verified only when the rerun shows it gone.

## What lessons already cover

- R1: needs code.
- R2: needs code.
- R3: lanes 2, 3, 4 can take the overlay now (no code).
- R4: needs code.
- R5: needs code.

## Reports

- /api/waves/1/report
- /api/waves/2/report

Lint: `npm run haunt -- spec-lint .kiro/specs/<run>`
