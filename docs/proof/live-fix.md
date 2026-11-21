# Live fix proof (SH-C4)

Dated 2026-11-21. Plan stated: **crash at `after_effect_before_journal`, once per order per lane, 2 lanes, 3 orders, seed 7** (the `loop` demo plan). This is a crash-only plan. It is not the full sweep, so the A below covers crash faults only.

## What is real

- Wave 1 (Rookie, no parts): grade F, 5 repeated effects, 0 lost orders. Files: `wave1-report.json`, `wave1-postmortem.md`.
- The reviewer (`runReviewer` + `writeReview`) wrote `.kiro/specs/hardening-loop-w1/` from those wave 1 events. Every finding asks for the SDK `idempotency` part. No finding asked for a breaker or offline queue, and no Phoenix lost order or `updates` crash appeared in either wave, so there was nothing extra to fix.
- Wave 2 (hardened Rookie with `retry`, `journal`, `idempotency`): grade A, 6 of 6 crash presses pass, 5 repeats down to 0, 0 lost orders. Files: `wave2-report.json`, `wave2-postmortem.md`, `loop-proof.md`.

## What is recorded, not live

The fix in `apps/haunted-orders/src/bots/rookie.hardened.ts` is a **Recorded fix**. It was written ahead of time to satisfy the spec, not produced by a Kiro session running the spec's tasks. The browser demo replays it and carries the "Recorded fix" label.

Until a real Kiro session applies `.kiro/specs/hardening-loop-w1/tasks.md` and the diff is saved here (transcript, diff, screen recording), the video must say "recorded fix", not "Kiro applied the fix live".

## Claim allowed today

"On the crash-only loop plan, wave 1 grades F and wave 2 grades A after the hardening spec's parts are added (fix recorded)."

## To make the fix live

1. Run the loop wave 1: `npm run live -- --loop`, then `POST /api/demo/start {"script":"loop","speed":4}`.
2. Open `.kiro/specs/hardening-<run-id>/` in Kiro and run its tasks against `apps/haunted-orders/src/bots/rookie.ts`.
3. Save the transcript, `git diff` of the bot, and a screen recording in this folder.
4. Rebuild bots, start wave 2, save both reports.
