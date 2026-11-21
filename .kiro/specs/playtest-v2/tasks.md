# Play-test v2: tasks

Branches: `core/PT-...` (Lane A), `ui/PT-...` (Lane B). One PR per task. Contract changes (`contract/V1_1.md`) are one PR with the `contract` label. Record every ambiguity decision in `docs/DECISIONS.md`. Tick the box in this file in the same PR.

## Phases and dependencies

```
P0  PT-C0 contract+schema+fixtures+mock  ──┬─> P1 UX (PT-U1..U5, U9)  needs PT-C2 travel, PT-C5 order records
                                           ├─> P2 laps/score/reviews (PT-C3,C4,C6, PT-U3,U6,U7,U8)
                                           ├─> P3 world events (PT-C7, PT-U10, PT-ART)
                                           └─> P4 wrong order (PT-C8, PT-U11)
```
Order: P0, then P1 (the visible fixes the owner asked for first), then P2, P3, P4. Lane B can build P1, P2, P3 against the mock as soon as PT-C0 merges.

## Lane A (Core)

- [ ] **PT-C0 Contract v1.1 plumbing.** (Partial: PT-C0a schema done, `contractMinor`, `review`, `decision_*`, travel, lap and summary fields. PT-C0b validator rules 40 to 47 done, gated on `hello.contractMinor` >= 1, with negative tests in `packages/haunt/test/validate-v1-1.test.ts`. PT-C0c fixtures done: `hero-crash` regenerated with travel, laps and reviews, plus `laps-reviews`, `cancelled`, `world-events`, `typo-*`, `boss-recovered`, `downtime`; `full` and `loop` still v1.0. PT-C0d mock endpoints done (order record, laps, wave laps and stars, decision; covered by `test:contract`). The `window.__haunt` functions remain.) Merge `contract/V1_1.md` (this PR). Extend `events.schema.json` (new fields, `review`, `decision_*`, `hello.contractMinor`), the validator (rules 40 to 47), `tools/make-fixtures.ts` (travel gaps, laps, reviews, the new fixtures), the mock endpoints (`/api/lane/:lane/order/:order`, `/laps`, `/api/waves/:n/laps|stars`, `/api/decision`), and `window.__haunt` functions. Acceptance: all fixtures validate; `test:contract` covers the new endpoints in mock; `hero-crash` regenerated with travel and reviews.
- [ ] **PT-C1 Pace `slow`.** Add pace factor 3, default for interactive and demo scripts; update `expectedMs`; demo scripts `hero` 3 orders, `full` 6, `loop` 2 per wave. Acceptance: tests at pace slow and speed 1 and 4; P13 constants.
- [ ] **PT-C2 Travel scheduler.** Per-lane clock in the runner and `hold` message in the SDK (design section 1); guarantees of contract rule 40. Acceptance: P13; the hero crash still reconciles; replay pairs and restarts exempt.
- [ ] **PT-C3 Lap tracker and summaries.** `LapTracker` (pure), `lap` on `order_done` and `order_failed`, `wave_end.summary` additions, wave report `laps` and `stars`. Acceptance: P9, P10; `GET /api/lane/:lane/laps` and wave endpoints live.
- [ ] **PT-C4 Scoring v2.** Replace the score table (design section 5): downtime, cancelled -300, halt -400, abandoned -150, boss recovered and refund, speed threshold with travel baseline. Update `acceptance.md` table D and tests. Acceptance: all worked examples pass; P14, P16.
- [ ] **PT-C5 Order and stage records.** `GET /api/lane/:lane/order/:order` with stage rows (attempts, retries, recoverable, issues, downtime, recoveries). Acceptance: matches events for every fixture; mock and live agree.
- [ ] **PT-C6 Reviews and stars.** `review()` pure function, `review` event, `cum`, per-lane rating, score from stars, reasons table. Acceptance: P11, P12; unit tests for every sub-score threshold and cap.
- [ ] **PT-C7 World events.** Stage 8 handoff provider call and `handoff_block` mode; faults `sms_down`, `app_down`, `updates_down`, `wrong_address`, `no_answer`, `gated_house`, `car_accident` through `POST /api/chaos`, random mode (family `world`), `GET /api/creatures` additions, deferral. Acceptance: table L (L1 to L7) in in-process and integration modes; timing rows at speed 1 or 2.
- [ ] **PT-C8 Wrong order and decisions.** `order_typo` mutation at `input_read`, provider `typo` mode, complaint at confirmation and handoff, `WrongOrder` in the SDK, `decision_needed`, `POST /api/decision`, refund, discount, redo with new keys, tier default policies, journal records, ledger exemption (P15). Acceptance: L8 for all tiers; P18; restart during a pending decision.
- [ ] **PT-C9 Property and unit tests.** P9 to P18 plus the worked examples.
- [ ] **PT-C10 Fixtures and storyboards.** Update `STORYBOARDS.md` with travel, ceremony, reviews, cancelled, downtime, boss recovered, decisions; generate all fixtures; validator rules 40 to 47.
- [ ] **PT-C11 Reports and CLI.** Wave report laps and stars, sweep columns for the world faults and `order_typo:<choice>`, `cancelled` label in HTML and Markdown, MCP `haunt_report` includes laps.
- [ ] **PT-C12 Mock templates.** Rows for table L and the decision flow in `outcomes.json`; `T_CANCELLED`, `T_DECISION_*`.
- [ ] **PT-C13 Inbox mapping.** Decide which new faults apply to the Python inbox (suggest none except `updates_down`-like on `reply`), record in `docs/DECISIONS.md`, set `apps` on each creature.

## Lane B (Visuals)

- [ ] **PT-U1 Lap choreography.** Skeleton anchor states, walking, grab from the **start stack**, `next` chip, `travel_violation` snap (ui.md sections 1 and 2). Acceptance: criteria 1 and 2 of ui.md section 17 against `laps-reviews`.
- [ ] **PT-U2 Handoff ceremony and cancel sequence.** Door open, handover, close, stars float, run back; cancel burn and trudge (ui.md sections 1 and 7).
- [ ] **PT-U3 Chips v2.** `chipState()` pure module, colours, flags, heat strip, tooltips (ui.md section 3). Acceptance: unit tests for every state.
- [ ] **PT-U4 Lane ticker.** One row per lane, sliding messages, queue and fast-forward, templates, click to popup (ui.md section 4).
- [ ] **PT-U5 Lane popup v2.** Live mini scene, stage table, order picker, log filters, lap summary, replay (ui.md section 5). Replaces and extends UI-C1.
- [ ] **PT-U6 Laps and wave summary.** Lap table with best and slowest tags, wave end card v2, star progression chart, report tab "Laps & stars" (ui.md section 6).
- [ ] **PT-U7 Reviews.** Door stars, review card, customer ghost, live tracker in the label card, rating titles (ui.md sections 6 and 7).
- [ ] **PT-U8 Score visuals.** Downtime chip, cancel slam, boss recovered banner, score explainer popover, rank board fixes (ui.md section 8).
- [ ] **PT-U9 Header, gear menu, legend, pace.** Gear menu that closes, Play and Stop demo buttons, badge tooltip, legend modal and gear badge tooltips, Slow default pace control (ui.md sections 9 and 12).
- [ ] **PT-U10 World creature choreographies.** Scarecrow, black cat, phantom car, prankster, plus captions on gargoyle, imp, goblin (ui.md section 11).
- [ ] **PT-U11 Decision popup.** Modal, countdown, keyboard, outcome animations (ui.md section 10).
- [ ] **PT-U12 Sound additions and a11y.** Ui.md sections 13 and 14.
- [ ] **PT-ART Art for new creatures.** Scarecrow, black cat, phantom car, prankster, door sprite with open and closed states, customer ghost, star and review card art. Lab page entries and silhouette check. CC0 allowed for props only if listed in `docs/ASSETS.md`.
- [ ] **PT-U13 UI tests.** Reducers unit tests, one smoke e2e (ui.md section 16).

## Shared

- [ ] **PT-X1 Regression.** `npm run demo`, `npm run fresh-clone`, hero crash, loop proof and all existing property tests still pass after the scoring and pace changes. Update screenshots in `docs/proof/`.
- [ ] **PT-X2 Docs.** `docs/SPEC-MAP.md` row, `docs/DEMO-SCRIPT.md` timings (3 min video is edited from the slower demos), `docs/KIRO-LOG.md` entries.

## Cut line inside this spec

Must have: PT-C0, C1, C2, C3, C4, C5, C6, U1, U2, U3, U4, U5, U6, U7, U8, U9. Next: PT-C7, U10, ART (world events). Last: PT-C8, U11 (wrong order decisions). If time is short, ship world events as captions on existing creatures and skip new art.
