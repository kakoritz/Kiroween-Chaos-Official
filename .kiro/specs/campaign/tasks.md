# Campaign tasks

Depends on `playtest-v2` P0 to P2 (laps, scoring, reviews). Branches `core/CP-...` and `ui/CP-...`.

## Lane A
- [x] **CP-C1 Campaign data and endpoint.** `packages/core/campaign/nights.json` (seven entries), `GET /api/campaign`, schema, mock data.
- [x] **CP-C2 Crew bot and wave config.** `bots/crew.ts` and `bot/crew.py` driven by `HAUNT_PARTS`; `POST /api/wave/start {campaign}`; `lane_ready` for the Crew; rivals unchanged. Acceptance: campaign acceptance 1 to 4. Done: 1, 2 and 4 in in-process mode; 3 (night 5 boss windows) is exercised but asserted in CP-C4. Partial: stars and downtime thresholds need play-test v2 events.
- [x] **CP-C3 Mock and fixtures.** Scripted fixtures `night1` to `night6`, `finale` for the mock (with and without gear variants where the result differs), `inpage` `getCampaign()`. Done: `packages/core/mock/campaign-fixtures.ts` (called from `tools/make-fixtures.ts`), committed `night<N>` (no gear) and `night<N>-<letters>` (gear hint, e.g. `night1-j-i`, `night2-r-b`), any other gear built on demand by `POST /api/wave/start {campaign}` in the mock, `getCampaign()` in HttpApi, InPageApi, ArenaApi and the inpage stub. Partial: nights 4, 5 and the finale are built from the V1_1 types with the sim decorator and a scripted finale lane until S1 merges world events, boss recovery scoring and decisions; the mock plays two of night 5's three bosses (windows cannot overlap at the slow pace); night 3 with only Spellbook and Coffin Stash still fails (the planner halts bad input without Lantern).
- [x] **CP-C4 Determinism and balance tests.** Each night is deterministic; medal thresholds checked against the rival tiers (Phoenix should reach gold on every night; Rookie should not reach bronze on nights 1 to 3). Done: `packages/haunt/src/campaign/balance.ts` and `packages/haunt/test/campaign-balance.test.ts` (acceptance 4, and acceptance 5 for mock and wire events); no threshold changes in nights.json. Partial: runs on the scripted mock waves; a live and browser engine replay (acceptance 5) is a `todo` until S1 lands scoring v2 in the live runner, because the mock summaries differ from a re-score (night 1 hint gear 796 vs 632) and night 3 with the hint gear still fails in the mock.
- [ ] **CP-C5 Inbox night.** Night 6 on the Python app with the Crew parts (depends on the live inbox runner in the arena).

## Lane B
- [ ] **CP-U1 Hub and briefing.** Crypt map of nights, locks, medals, briefing card with lesson and hint.
- [ ] **CP-U2 Gear shop.** Paper-doll skeleton, drag and drop (and keyboard), prices, tooltips in plain words, equip and reset.
- [ ] **CP-U3 Results, medals, persistence.** Medal computation, credit awards, "what happened" explainer, unlock rules, localStorage and export/import.
- [ ] **CP-U4 Sandbox.** Toggle parts on lane 1 before a wave, run, see the grade and the issue changes; "Reset" and "Compare to last run".
- [ ] **CP-U5 Campaign visuals.** Rivals ghosted, "Your Crew" label and gear badge, medal and credit animations, sounds.
- [ ] **CP-ART Art.** Tombstone-door map, medals, shop background, paper-doll gear icons (reuse the gear art).

## Cut line
Ship nights 1, 2 and 5 with the shop and results first. Add 3 and 4, then the Sandbox, then night 6 and the finale.
