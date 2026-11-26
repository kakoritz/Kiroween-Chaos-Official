# Hardening tmwxll5oj

9 fixes for the patterns above the threshold (count 3, any lost order, or over 30 s of downtime), sorted by downtime cost. Written by the pattern miner; Kiro applies a spec with the review step, never automatically.

| # | Pattern | Downtime | Lost | Repeats | Status when written | Lessons cover it |
|---|---|---|---|---|---|---|
| 1 | `unknown + internet_outage + outage` | 12.2 s | 0 | 0 | new | yes (lanes 5) |
| 2 | `pay + http_404 + duplicate_effect` | 0.0 s | 0 | 3 | new | no |
| 3 | `pay + crash + duplicate_effect` | 0.0 s | 0 | 8 | new | no |
| 4 | `ready + timeout + order_lost` | 0.0 s | 6 | 0 | new | no |
| 5 | `ready + http_404 + order_lost` | 0.0 s | 2 | 2 | new | no |
| 6 | `ready + curse_slow + crashed` | 0.0 s | 2 | 0 | new | no |
| 7 | `pay + slow_link + retry_storm` | 0.0 s | 0 | 0 | new | no |
| 8 | `pay + timeout + retry_storm` | 0.0 s | 0 | 0 | new | no |
| 9 | `ready + curse_slow + reported` | 0.0 s | 0 | 0 | new | no |

## Expected grade change

Removing these patterns removes 10 lost orders and 13 repeated effects. Rerun the tournament with seed 7 and the same rounds to verify; a pattern is verified only when the rerun shows it gone.

## What lessons already cover

- R1: lanes 5 can take the overlay now (no code).
- R2: needs code.
- R3: needs code.
- R4: needs code.
- R5: needs code.
- R6: needs code.
- R7: needs code.
- R8: needs code.
- R9: needs code.

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
- /api/waves/1/report
- /api/waves/3/report

Lint: `npm run haunt -- spec-lint .kiro/specs/hardening-tmwxll5oj`
