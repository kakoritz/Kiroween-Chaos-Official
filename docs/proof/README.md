# Loop proof (H6.10)

Re-recorded 2026-11-21 with scoring v2 on 127.0.0.1 with `npm run live -- --loop`, then `POST /api/demo/start {"script":"loop","speed":4}` twice on one server (2 lanes, 3 orders, seed 7, one Reaper crash at `after_effect_before_journal` per order per lane).

## Wave 1 (before the fix)

- `wave1-report.json`: `GET /api/waves/1/report`. Lane 1 (Rookie, no parts) F, lane 2 (Phoenix) A. Wave grade F, score -229 (scoring v2).
- `wave1-postmortem.md`: `GET /api/waves/1/postmortem`. 6 chaos presses, 5 repeated effects, 0 lost orders.
- Hardening spec written by the reviewer (`runReviewer` + `writeReview`, packages/haunt/src/reviewer) from lane 1's wave 1 events: `.kiro/specs/hardening-loop-w1/` (requirements, design, tasks). Served at `GET /api/waves/1/hardening`. Every finding asks for the SDK `idempotency` part.

## The fix

`apps/haunted-orders/src/bots/rookie.hardened.ts` is the recorded fix: the Rookie with `retry`, `journal` and `idempotency`. With `--loop`, lane 1 runs it from wave 2 on (runtime.md section 32).

## Wave 2 (after the fix)

- `wave2-report.json`: `GET /api/waves/2/report`. Lane 1 (hardened Rookie) A, lane 2 (Phoenix) A. Wave grade A, score 702 (scoring v2). All 6 chaos presses pass, 0 lost orders (ord-0002 completes).
- `wave2-postmortem.md`: 6 chaos presses, 0 repeated effects, no findings.

## Comparison

`loop-proof.md` is `renderProofMarkdown(compareWaves(wave1, wave2))`: grade F to A, repeats 5 to 0, findings F1 to F5 all resolved, no new findings. The Rookie lane goes F to A and the wave grade is A.

## Honesty label

The fix is a **Recorded fix**. See live-fix.md for the stated plan and what is still to be done live.

