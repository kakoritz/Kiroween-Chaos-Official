# Hardening tmwxlggpg

7 fixes for the patterns above the threshold (count 3, any lost order, or over 30 s of downtime), sorted by downtime cost. Written by the pattern miner; Kiro applies a spec with the review step, never automatically.

| # | Pattern | Downtime | Lost | Repeats | Status when written | Lessons cover it |
|---|---|---|---|---|---|---|
| 1 | `unknown + endpoint_down + outage` | 140.6 s | 0 | 0 | new | yes (lanes 5) |
| 2 | `unknown + slow_link + outage` | 18.6 s | 0 | 0 | new | yes (lanes 5) |
| 3 | `pay + endpoint_down + order_lost` | 0.7 s | 3 | 3 | new | yes (lanes 3) |
| 4 | `pay + http_429 + order_lost` | 0.7 s | 3 | 3 | new | yes (lanes 3) |
| 5 | `pay + slow_link + order_lost` | 0.5 s | 2 | 2 | new | yes (lanes 3) |
| 6 | `pay + http_500 + order_lost` | 0.3 s | 1 | 1 | new | yes (lanes 3) |
| 7 | `pay + endpoint_down + retry_storm` | 0.0 s | 0 | 0 | new | no |

## Expected grade change

Removing these patterns removes 9 lost orders and 9 repeated effects. Rerun the tournament with seed 7 and the same rounds to verify; a pattern is verified only when the rerun shows it gone.

## What lessons already cover

- R1: lanes 5 can take the overlay now (no code).
- R2: lanes 5 can take the overlay now (no code).
- R3: lanes 3 can take the overlay now (no code).
- R4: lanes 3 can take the overlay now (no code).
- R5: lanes 3 can take the overlay now (no code).
- R6: lanes 3 can take the overlay now (no code).
- R7: needs code.

## Not proposed

These patterns are above the threshold, but no small patch is known, so no change is proposed. They need a design discussion first.

- `triage + wrong_queue + order_lost`: no small patch is known for this shape; it needs a design discussion before any change.
- `account + internet_outage + order_lost`: no small patch is known for this shape; it needs a design discussion before any change.
- `confirmation + endpoint_down + order_lost`: no small patch is known for this shape; it needs a design discussion before any change.
- `account + endpoint_down + order_lost`: no small patch is known for this shape; it needs a design discussion before any change.
- `account + timeout + order_lost`: no small patch is known for this shape; it needs a design discussion before any change.
- `assign + wrong_queue + order_lost`: no small patch is known for this shape; it needs a design discussion before any change.

## Reports

- /api/waves/7/report
- /api/waves/8/report
- /api/waves/2/report
- /api/waves/3/report
- /api/waves/4/report

Lint: `npm run haunt -- spec-lint .kiro/specs/hardening-tmwxlggpg`
