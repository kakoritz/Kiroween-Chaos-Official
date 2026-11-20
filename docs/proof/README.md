# Loop proof (H6.10)

Captured 2026-11-20 on 127.0.0.1 with `npm run live -- --loop`, then `POST /api/demo/start {"script":"loop","speed":4}` twice on one server (2 lanes, 3 orders, seed 7, one Reaper crash at `after_effect_before_journal` per order per lane).

## Wave 1 (before the fix)

- `wave1-report.json`: `GET /api/waves/1/report`. Lane 1 (Rookie, no parts) F, lane 2 (Phoenix) C. Wave grade F, score -360.
- `wave1-postmortem.md`: `GET /api/waves/1/postmortem`. 6 chaos presses, 5 repeated effects, 1 lost order.
- Hardening spec written by the reviewer (`runReviewer` + `writeReview`, packages/haunt/src/reviewer) from lane 1's wave 1 events: `.kiro/specs/hardening-loop-w1/` (requirements, design, tasks). Served at `GET /api/waves/1/hardening`. Every finding asks for the SDK `idempotency` part.

## The fix

`apps/haunted-orders/src/bots/rookie.hardened.ts` is the recorded fix: the Rookie with `retry`, `journal` and `idempotency`. With `--loop`, lane 1 runs it from wave 2 on (runtime.md section 32).

## Wave 2 (after the fix)

- `wave2-report.json`: `GET /api/waves/2/report`. Lane 1 (hardened Rookie) A, lane 2 (Phoenix) C. Wave grade C, score 450.
- `wave2-postmortem.md`: 6 chaos presses, 0 repeated effects, no findings.

## Comparison

`loop-proof.md` is `renderProofMarkdown(compareWaves(wave1, wave2))`: grade F to C, repeats 5 to 0, findings F1 to F5 all resolved, no new findings. The Rookie lane itself goes F to A. The wave grade stops at C because the Phoenix lane loses one order in both waves; that lane is not part of this fix.
