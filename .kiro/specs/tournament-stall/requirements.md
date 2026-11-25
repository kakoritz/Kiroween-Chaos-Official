# Tournament stall and hosted frames: requirements

Two flakes. A: the tournament step of `npm run e2e` sometimes never finishes. B: the hosted `?demo=full` shows long stretches with no creatures. No contract change.

## R1. A lane loop always ends
1. A bot blocked at an armed process-fault hook goes on when the runner answers `proceed` (its director did not fire there). It never waits for a kill that may not come.
2. After the runner sends `shutdown` to a bot (`idle`), the bot has a grace period to exit. If it is still alive after that, the runner kills it, so `runLane` returns and the wave can end.
3. A bot that never reports `ready` (or dies before it) is killed, not left running, and the lane loop fails visibly instead of leaking the child.
4. A bot that exits on its own inside the grace period is not killed.

## R2. A stuck tournament says where
1. When `npm run e2e` gives up on the tournament it prints the tournament phase and round, the wave and lane states, whether Next was pressed, and the last events.
2. The wait is `HAUNT_E2E_TOURNEY_MS` (default 20 minutes). Raising it is not the fix.

## R3. Hosted demo has no long empty stretches
1. While a demo script plays in the hosted page, no stretch longer than 5 s at 1x passes without a creature arriving.
2. Filler chaos uses the same ChaosSim a user press uses, only on active lanes, and never fails the playback if a lane cannot take it.
3. `npm run check:hosted` samples frames of `?demo=full` and fails on a creature-free stretch over the limit.
