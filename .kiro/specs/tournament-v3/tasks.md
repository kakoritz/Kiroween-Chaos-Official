# Tournament v3: tasks

Branches `core/TV3-...` and `ui/TV3-...`. One PR per task. Contract first (TV3-C0), then the stage change (TV3-C1) before anything that draws stages. Test with `npm run demo` after each task; no task lands if the fresh-clone demo breaks.

## Lane A (Core)
- [ ] **TV3-C0 Contract v1.2.** Land `contract/V1_2.md` in the mock: `stages` list in state, `round_*` events, `awaiting_next` and `POST /api/next`, `intensity`, `curse*`, `corpse`, `lesson`, `casebook`, `pattern`, new faults. Fixtures. (Lane B approves.)
- [ ] **TV3-C1 New order and stage list.** Eleven stages, legacy mapping, ledger columns, kill hooks, bots for all five tiers, fixtures, grader and tests. Behind `HAUNT_STAGES=v2` until all five bots pass; then default. Property tests P1 to P18 stay green.
- [ ] **TV3-C2 Wave end review state.** `awaiting_next`, `POST /api/next`, no auto start; optional auto-continue setting; fix `npm run demo` loops to respect it (the hero script presses Next itself).
- [ ] **TV3-C3 Never perfect.** Gremlin floor rule, per-lane per-round issue counter, property P19, review formula cap.
- [ ] **TV3-C4 Intensity dial.** Level table (spec section 5.1), `POST /api/intensity`, live plan scaling, unknown-fault fuzz pool with seed, level 11, auto-ramp on top of `ramp`.
- [ ] **TV3-C5 Random outage timer.** Seeded 1 to 30 s draw per level; `outageMs` in the event; replaces the fixed 20 s default.
- [ ] **TV3-C6 Transit faults.** `weather`, `road_hazard`, `delay`, `out_of_gas`, `not_on_truck` (plus existing `wrong_address`) as stalls and reroutes at stage `transit`; creatures reuse `phantom_car` and `scarecrow` or new art (see UI).
- [ ] **TV3-C7 Tournament engine.** Rounds, same seeded plan for all live lanes, RP scoring, tie-breaks, elimination, halt rule, corpses and wall corpses in state, `round_start`, `round_end`, `lane_eliminated`, `corpse`, champion.
- [ ] **TV3-C8 Lessons ledger and policy overlay.** `haunt.policy` schema, action sets per tier, learning on overcome and on suggested, persistence, reset, `lesson` events.
- [ ] **TV3-C9 Curses.** Five curses, per-endpoint, per-lane, persistence across rounds, `curse_response` classification (handled, reported, swallowed, crashed), swallowed penalty, report table.
- [ ] **TV3-C10 Casebook and awards.** Signature normaliser, case table, awards (Champion, Battle-Tested, Iron Skeleton, Fastest Recovery, Wooden Spoon), `casebook` data in the report and `GET /api/tournament`.
- [ ] **TV3-C11 Pattern miner.** `patterns.json`, clustering by signature and time shape, thresholds, status flow, `pattern` events.
- [ ] **TV3-C12 Fix spec writer and lint.** `hardening-<runId>` with requirements, design (diff budget), tasks (test and acceptance), `haunt spec-lint`, MCP tool `haunt_specs`. Replaces the rule-based text in the reviewer.
- [ ] **TV3-C13 Self-improving loop.** Policy auto-apply, rerun plan, compare report "closed n of m patterns", `haunt improve` command.
- [ ] **TV3-C14 Regression and fresh-clone.** Proof run recorded in `docs/proof/tournament.md`; `npm run fresh-clone` green; also make `npm run demo` build the UI when `packages/arena-ui/dist/assets` is missing.

## Lane B (Visuals), after TV3-C0 serves the mock
- [ ] **TV3-U1 Stage list from server.** Draw chips from `state.stages`; 11 chips fit at 1600 wide and scale down; hosted demo fixtures updated.
- [ ] **TV3-U2 Review state.** "Review" tint, summary card with Next (Space and N), logs stay live-browsable.
- [ ] **TV3-U3 Popup log filters and freeze.** Order filter, type filter, pin, "paused" chip, Back to live, scroll and selection kept. Same filter on the main log.
- [ ] **TV3-U4 Review card resize.** Half size over the ORDER card; door fully visible.
- [ ] **TV3-U5 Swarm FX.** Arrive, harass (shoo animation), dissipate, defeated circling, safety timer; reducer derived.
- [ ] **TV3-U6 Intensity dial.** Header knob 1 to 11, 11 override styling, auto-ramp toggle, sound rise.
- [ ] **TV3-U7 Curses.** Purple chips, lane tags, "Curse a lane" control, outage countdown ring.
- [ ] **TV3-U8 Tournament UI.** Round indicator, standings card with the drop, FALLEN row, corpse and wall corpse drawing, champion podium.
- [ ] **TV3-U9 Lessons and Casebook.** Scroll icons, learned sparkle, Casebook table, awards, final screen order.
- [ ] **TV3-U10 Transit art.** Weather, hazard, out of gas, not on truck creatures or effects (code-drawn).
- [ ] **TV3-U11 Pattern and spec view.** List of patterns with status, open generated spec, rerun and compare buttons.

## Cut line
1. **Must:** TV3-C0, C1, C2, C3, U1, U2, U3, U4 (these fix visible faults from the play-test and the new order).
2. **Then:** C4, C5, C7, U6, U8, U5 (the competition and the dial).
3. **Then:** C8, C10, C11, C12, U9, U11 (learning, Casebook, specs: the Kiro-depth story).
4. **Then:** C9, U7, C6, U10 (curses, transit), C13.
5. **Last:** C14 proof.
