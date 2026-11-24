# Campaign credits: requirements

Bug: the hub's Credits line can show 0 until the gear shop has been opened once, even though the player is owed the start grant (300 credits) or has earned credits. No contract change.

## R1. Hub shows the true total on first open
1. A save with no credits, gear, medals or bests is fresh. The hub shows the start grant from `GET /api/campaign` (`start.credits`, default 300) for it.
2. A save that has any progress shows its stored credits unchanged.

## R2. Results build on the true total
1. Finishing a night adds the earned credits to the true total, so the start grant is not lost when results are saved before the shop was opened.
2. After a night the hub shows start grant plus earned credits.

## R3. One rule for "fresh"
1. The hub, the shop and the results share one freshness check and one grant rule (`hub-model.ts`).

## R4. End to end
1. `GET /api/campaign` serves a start grant of 300 credits, the value the hub shows on first open.
