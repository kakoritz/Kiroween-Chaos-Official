# Hardening tmwxlulnc

19 fixes for the patterns above the threshold (count 3, any lost order, or over 30 s of downtime), sorted by downtime cost. Written by the pattern miner; Kiro applies a spec with the review step, never automatically.

| # | Pattern | Downtime | Lost | Repeats | Status when written | Lessons cover it |
|---|---|---|---|---|---|---|
| 1 | `login + endpoint_down + outage` | 141.9 s | 0 | 0 | new | yes (lanes 5) |
| 2 | `login + slow_link + outage` | 11.9 s | 0 | 0 | new | yes (lanes 5) |
| 3 | `login + power_outage + order_lost` | 2.2 s | 3 | 0 | new | yes (lanes 4, 5) |
| 4 | `entitlement + timeout + order_lost` | 1.9 s | 8 | 8 | new | yes (lanes 3, 4) |
| 5 | `entitlement + curse_slow + reported` | 0.2 s | 0 | 0 | new | no |
| 6 | `login + http_404 + duplicate_effect` | 0.1 s | 0 | 6 | new | yes (lanes 4, 5) |
| 7 | `login + http_429 + order_lost` | 0.1 s | 6 | 0 | new | yes (lanes 4) |
| 8 | `ads + endpoint_down + order_lost` | 0.0 s | 1 | 0 | new | yes (lanes 4) |
| 9 | `entitlement + http_429 + order_lost` | 0.0 s | 2 | 2 | new | yes (lanes 3) |
| 10 | `login + timeout + order_lost` | 0.0 s | 6 | 0 | new | yes (lanes 2, 3) |
| 11 | `login + crash + order_lost` | 0.0 s | 1 | 0 | new | yes (lanes 4) |
| 12 | `entitlement + endpoint_down + retry_storm` | 0.0 s | 0 | 0 | new | no |
| 13 | `entitlement + endpoint_failure_rate + degraded` | 0.0 s | 0 | 0 | new | yes (lanes 5) |
| 14 | `entitlement + http_429 + retry_storm` | 0.0 s | 0 | 0 | new | yes (lanes 5) |
| 15 | `entitlement + internet_outage + retry_storm` | 0.0 s | 0 | 0 | new | yes (lanes 5) |
| 16 | `login + endpoint_down + retry_storm` | 0.0 s | 0 | 0 | new | yes (lanes 5) |
| 17 | `login + endpoint_failure_rate + degraded` | 0.0 s | 0 | 0 | new | yes (lanes 5) |
| 18 | `login + http_429 + retry_storm` | 0.0 s | 0 | 0 | new | yes (lanes 5) |
| 19 | `login + power_outage + retry_storm` | 0.0 s | 0 | 0 | new | yes (lanes 5) |

## Expected grade change

Removing these patterns removes 27 lost orders and 16 repeated effects. Rerun the tournament with seed 7 and the same rounds to verify; a pattern is verified only when the rerun shows it gone.

## What lessons already cover

- R1: lanes 5 can take the overlay now (no code).
- R2: lanes 5 can take the overlay now (no code).
- R3: lanes 4, 5 can take the overlay now (no code).
- R4: lanes 3, 4 can take the overlay now (no code).
- R5: needs code.
- R6: lanes 4, 5 can take the overlay now (no code).
- R7: lanes 4 can take the overlay now (no code).
- R8: lanes 4 can take the overlay now (no code).
- R9: lanes 3 can take the overlay now (no code).
- R10: lanes 2, 3 can take the overlay now (no code).
- R11: lanes 4 can take the overlay now (no code).
- R12: needs code.
- R13: lanes 5 can take the overlay now (no code).
- R14: lanes 5 can take the overlay now (no code).
- R15: lanes 5 can take the overlay now (no code).
- R16: lanes 5 can take the overlay now (no code).
- R17: lanes 5 can take the overlay now (no code).
- R18: lanes 5 can take the overlay now (no code).
- R19: lanes 5 can take the overlay now (no code).

## Not proposed

These patterns are above the threshold, but no small patch is known, so no change is proposed. They need a design discussion first.

- `triage + wrong_queue + order_lost`: no small patch is known for this shape; it needs a design discussion before any change.
- `account + internet_outage + order_lost`: no small patch is known for this shape; it needs a design discussion before any change.
- `confirmation + endpoint_down + order_lost`: no small patch is known for this shape; it needs a design discussion before any change.
- `account + endpoint_down + order_lost`: no small patch is known for this shape; it needs a design discussion before any change.
- `entitlement + internet_outage + order_lost`: no small patch is known for this shape; it needs a design discussion before any change.
- `ready + http_500 + order_lost`: no small patch is known for this shape; it needs a design discussion before any change.
- `account + timeout + order_lost`: no small patch is known for this shape; it needs a design discussion before any change.
- `login + internet_outage + order_lost`: no small patch is known for this shape; it needs a design discussion before any change.
- `assign + wrong_queue + order_lost`: no small patch is known for this shape; it needs a design discussion before any change.
- `login + slow_link + order_lost`: no small patch is known for this shape; it needs a design discussion before any change.
- `login + endpoint_down + order_lost`: no small patch is known for this shape; it needs a design discussion before any change.
- `login + http_500 + order_lost`: no small patch is known for this shape; it needs a design discussion before any change.

## Reports

- /api/waves/7/report
- /api/waves/8/report
- /api/waves/2/report
- /api/waves/4/report
- /api/waves/1/report
- /api/waves/3/report

Lint: `npm run haunt -- spec-lint .kiro/specs/hardening-tmwxlulnc`
