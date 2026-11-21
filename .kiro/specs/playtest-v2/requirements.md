# Play-test v2: requirements

Source: owner play-test notes (issues #124 to #128). Engine rules: `design.md`. UI rules: `ui.md`. Contract: `contract/V1_1.md`. Each requirement lists the task that delivers it (`tasks.md`).

## Glossary

- **Lap**: one order's trip through all stages, with its time, attempts, retries, downtime and issues.
- **Issue**: a counted problem event at a stage (definition: contract v1.1 section 3).
- **Downtime**: time an order is not progressing because of a failure (design section 3). It costs points.
- **Review**: the customer's star rating of an order (design section 6).
- **Cancelled**: an order that failed (the old "failed"). It costs a lot of credit.
- **World event**: a failure with a story at a specific step (SMS down, gated house, wrong address).
- **Decision**: a player choice (refund, discount, redo) when a wrong order is found.

## R1. Motion and pacing

1. WHEN an order starts, THE SYSTEM SHALL NOT emit the first `stage_start` until `grabMs` has passed, and THE UI SHALL show the skeleton at the start of the track grabbing the scroll from the start stack. (PT-C2, PT-U1)
2. WHEN a stage completes, THE SYSTEM SHALL NOT emit the next `stage_start` until `walkMs` has passed, and THE UI SHALL show the skeleton walking to the next station. (PT-C2, PT-U1)
3. WHEN an order is handed off, THE UI SHALL show the door opening, the scroll handed over, the door closing, stars floating, and the skeleton running back to the start; THE SYSTEM SHALL NOT emit the next `order_start` until `ceremonyMs + returnMs` has passed. (PT-C2, PT-U2)
4. THE SYSTEM SHALL offer pace `slow` (factor 3) and SHALL make it the default for interactive play and demo scripts. (PT-C1, PT-U9)

## R2. Lane logs

1. THE UI SHALL show one ticker row per lane with only the current message, sliding out the previous message. (PT-U4)
2. WHEN a ticker row, lane label, chip, or flag is clicked, THE UI SHALL open a lane popup with a live animated skeleton, the full log, per-stage attempts, retries, issues, downtime, recoverability, and the lap summary. (PT-U5, PT-C5)
3. THE SYSTEM SHALL provide per-order and per-stage records (attempts, recoveries, downtime). (PT-C5)

## R3. Status, issues, laps

1. THE UI SHALL colour stage chips green (passed), red (failed), yellow (in trouble), and normal (in progress) per `ui.md` section 3, with an issue flag and count. (PT-U3)
2. THE SYSTEM SHALL compute a lap object for every finished order and a summary per lane (best, slowest, average lap, retries, downtime, issues by stage, outcomes). (PT-C3)
3. THE UI SHALL show lap tables, best and slowest laps, and wave totals. (PT-U6)

## R4. Scoring

1. Downtime SHALL cost 2 points per 1x-second, capped at 300 per order. (PT-C4)
2. Recovering the order that was in flight at a boss SHALL give +150 and refund the downtime penalties received during the boss. (PT-C4)
3. A cancelled order SHALL cost 300 and a halted lane 400 plus 150 per abandoned order. (PT-C4)
4. THE UI SHALL explain scores (score popover) and show downtime and cancel animations. (PT-U8)

## R5. Reviews and stars

1. THE SYSTEM SHALL emit a `review` for every finished order with five sub-scores (timeliness, delays, issues, delivery, ease), stars from 1 to 5, reasons, and a running total. (PT-C6)
2. THE UI SHALL show the stars at the door, a review card, a live tracker (`8/15`), and a rating per lane at wave end. (PT-U7, PT-U6)
3. Reviews SHALL feed the score as `(stars - 3) x 40`. (PT-C6)

## R6. World events

1. THE SYSTEM SHALL support `sms_down`, `app_down`, `updates_down`, `wrong_address`, `no_answer`, `gated_house`, `car_accident` at their steps, with the outcomes of design table L. (PT-C7)
2. THE UI SHALL show a creature and caption for each, including four new creatures (scarecrow, black cat, phantom car, prankster). (PT-U10, PT-ART)
3. Stage 8 SHALL call the provider so handoff can fail. (PT-C7)

## R7. Wrong order and decisions

1. WHEN `order_typo` is armed, THE SYSTEM SHALL swap the order items and detect it at confirmation or handoff. (PT-C8)
2. WHEN detected, THE SYSTEM SHALL emit `decision_needed`, accept `POST /api/decision`, and apply refund, discount, or redo, with a tier default after the timeout. (PT-C8)
3. THE UI SHALL show a decision popup with consequences and play each outcome. (PT-U11)

## R8. Header, legend, controls

1. THE UI SHALL provide a gear menu for chaos mode, pace, speed, sound, motion, and SHALL close it after a selection, outside click, or Esc. (PT-U9)
2. THE UI SHALL explain the gear letters R J I B Q with tooltips and a legend. (PT-U9)
3. THE UI SHALL show "Play demo" and "Stop demo" buttons and a mode badge tooltip. (PT-U9)

## R9. Quality

1. All new scoring and review functions SHALL be pure and covered by properties P9 to P18. (PT-C9)
2. All new fixtures SHALL validate against the schema and the ordering rules 40 to 47. (PT-C10)
3. THE SYSTEM SHALL keep `npm run demo` and `npm run fresh-clone` working. (PT-X1)

## Out of scope for this spec

Campaign mode, gear shop, shareable badges, CI sweep action, bring-your-own-workflow wizard, guided tour: specified in `.kiro/specs/campaign/` and `.kiro/specs/share/`.
