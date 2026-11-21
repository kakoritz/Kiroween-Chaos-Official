# Campaign tasks

Depends on `playtest-v2` P0 to P2 (laps, scoring, reviews). Branches `core/CP-...` and `ui/CP-...`.

## Lane A
- [ ] **CP-C1 Campaign data and endpoint.** `packages/core/campaign/nights.json` (seven entries), `GET /api/campaign`, schema, mock data.
- [ ] **CP-C2 Crew bot and wave config.** `bots/crew.ts` and `bot/crew.py` driven by `HAUNT_PARTS`; `POST /api/wave/start {campaign}`; `lane_ready` for the Crew; rivals unchanged. Acceptance: campaign acceptance 1 to 4.
- [ ] **CP-C3 Mock and fixtures.** Scripted fixtures `night1` to `night6`, `finale` for the mock (with and without gear variants where the result differs), `inpage` `getCampaign()`.
- [ ] **CP-C4 Determinism and balance tests.** Each night is deterministic; medal thresholds checked against the rival tiers (Phoenix should reach gold on every night; Rookie should not reach bronze on nights 1 to 3).
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
