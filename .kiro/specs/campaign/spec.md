# Campaign: "Haunted Nights" (requirements and design)

Goal: turn the demo into a **game people want to play and a lesson developers remember**. The player equips real resilience parts on their own skeleton, survives six nights of escalating chaos, and earns medals. Each night teaches one real engineering pattern. This directly raises Potential Impact (teaches and is usable), Innovation (chaos engineering as a progression game), Design and Presentation.

Depends on: `playtest-v2` (laps, reviews, scoring v2, world events, decisions). Lane split: Core builds the Crew bot, the campaign data and the wave config; UI builds the hub, shop, briefing and results.

## 1. Concept

- **Your Crew** is lane 1: one skeleton the player dresses with gear (the five parts R J I B Q) between nights. Lanes 2 to 5 are the **Hall of Fame rivals** (the fixed tiers Retrier, Journaler, Reconciler, Phoenix) so the player always sees how their build compares.
- Each **night** is a scripted wave (orders, pace, chaos plan, bosses) that is fair but tests a specific weakness. A night is won with **medals** (bronze, silver, gold) based on credits (score), average review stars and zero repeats.
- **Credits** (the night's score, never negative for spending) buy gear in the **Gear Shop**. Earn more by replaying nights.
- The campaign works in all modes: mock (scripted fixtures), live (real engine), browser (in-page engine).

## 2. Nights

| Night | Title | Threat (scripted) | The lesson (real pattern) | Intended gear | Gold needs |
|---|---|---|---|---|---|
| 1 | The Double Charge | Reaper strikes Payment `after_effect_before_journal` on every order | Idempotency keys and checkpoints stop repeated side effects | J, I | 0 repeats, 3.5+ avg stars |
| 2 | Flaky Network | Zombie timeouts, Goblin 429s, Imp 500s at random effect stages | Retries with backoff; why blind retry duplicates | R, B | 0 cancelled orders |
| 3 | Missing Pieces | Poltergeist missing files, Witch bad data, Doppelganger duplicates | Dead-letter queue, park and resume, deduplication | Q, J | 0 abandoned, 0 repeats |
| 4 | The Long Road | World events: sms_down, app_down, wrong_address, no_answer, car_accident | Circuit breakers, graceful degradation, recovery time | B, Q, R | downtime under 20 s per order |
| 5 | Boss Night | Lich, Banshee Queen, Headless Horseman in turn | Correlated failure; everything together | all five | recover every boss order |
| 6 | The Inbox (bonus) | An AI agent files tickets and sends replies; the same crashes | The same skeleton protects a different app (Python) | all five | 0 repeated tickets or replies |
| Finale | Wrong Order | `order_typo` with decisions plus a random storm | Compensating actions (refund, discount, redo) | all five | 4.5+ avg stars |

Night 6 runs the Python inbox app in the same arena (this is the Skeleton Crew proof as gameplay).

## 3. Gear shop

| Part (badge) | Cost (credits) | Plain-words effect | What it blocks |
|---|---|---|---|
| Lantern (R, retry) | 200 | Tries again 3 times | One-off timeouts and 5xx |
| Spellbook (J, journal) | 300 | Remembers finished work after a crash | Restarting from zero |
| Seal (I, idempotency) | 400 | Every charge carries a unique key; checks before repeating | Double charges and double emails |
| Shield (B, breaker) | 500 | Waits longer each try and stops hammering a broken service | Retry storms, rate limits |
| Coffin Stash (Q, queue) | 500 | Parks broken orders and resumes them later | Lost orders, poison input |
Start with 0 gear (the Rookie) and 300 credits. Gear is permanent once bought. A **Sandbox** mode (any night, any gear, no credits needed) lets players experiment.

## 4. Requirements (EARS)

1. THE SYSTEM SHALL provide six nights and a finale as data (`packages/core/campaign/nights.json`) served by `GET /api/campaign`. (CP-C1)
2. WHEN a night starts with `POST /api/wave/start {campaign: {night, parts}}`, THE SYSTEM SHALL run lane 1 as the **Crew bot** with exactly the chosen parts and lanes 2 to 5 as the rival tiers. (CP-C2)
3. THE Crew bot SHALL read `HAUNT_PARTS` and enable `retry`, `journal`, `idempotency`, `breaker`, `offline_queue` accordingly, passing idempotency keys only when `idempotency` is on. (CP-C2)
4. WHEN a night ends, THE UI SHALL compute medals from `wave_end.summary[1]` using the night's thresholds, award credits equal to the lane score if positive, and persist progress. (CP-U3)
5. THE UI SHALL show a campaign hub, a night briefing (threat, lesson in plain words, hint), a gear shop with a paper-doll skeleton, and a results screen with medals and "what happened". (CP-U1, CP-U2, CP-U3)
6. WHEN the Crew lane loses points, THE UI SHALL explain why in words and suggest the gear that would have helped, using the review reasons and issue stats. (CP-U3)
7. THE SYSTEM SHALL let the player replay any unlocked night; a night unlocks on bronze or better of the previous night. (CP-U3)
8. THE campaign SHALL run in mock mode with scripted demo-style plans so it works in the hosted demo. (CP-C3)
9. Sandbox mode SHALL allow toggling parts on lane 1 before any wave and show the grade change. (CP-U4)

## 5. Design

### Data (`nights.json`)
```
{ id: 1, title, briefing, lesson: [3 short lines], hint, orders: 4, pace: "slow",
  plan: [ {when:{lane:1,event:"stage_start",stage:"payment",attempt:1}, forEachOrder:true, fault:"crash", point:"after_effect_before_journal"} ],
  rivals: ["retrier","journaler","reconciler","phoenix"],
  medals: { bronze: {credits: 100}, silver: {credits: 400, repeats: 0}, gold: {credits: 700, repeats: 0, avgStars: 3.5} },
  gearHint: ["journal","idempotency"] }
```
Plans use the demo-script trigger format (`runtime.md` section 33). Random elements use a fixed seed per night so a night is **deterministic** and winnable.

### The Crew bot
`apps/haunted-orders/src/bots/crew.ts`: same pipeline as the tiers, parts from `HAUNT_PARTS`. The inbox has `bot/crew.py` with the same env var. Both report parts at `--parts` for `part_added`/gear display. Rivals are unchanged.

### Medals and credits
Medal = highest tier whose thresholds are all met by lane 1's `wave_end` summary. Credits awarded = `max(0, lane score)` the first time per medal tier and 25 percent of it on replays (so farming is slow but possible). Stars average from `summary.stars.avg`.

### UI screens (Lane B)
1. **Hub:** a crypt map with seven tombstone doors (nights), medals shown on each, locked doors greyed, a gear icon for the shop, "Sandbox", credits counter, best medal count.
2. **Briefing card:** night title, a one-line story ("The power dies right after the charge"), "What you will learn" (3 lines with the pattern name), hint ("Try Spellbook and Seal"), Start button, rivals preview.
3. **Gear shop (paper doll):** the skeleton in the centre, five slots; owned gear is draggable onto slots, locked gear shows price; tooltip with plain words and what it blocks; "Equip all owned" and "Reset". Live preview of the skeleton with the gear.
4. **Play:** the normal arena with lane 1 labelled "Your Crew" and a badge showing equipped gear; rivals as ghosts at 70 percent opacity labelled "Hall of Fame".
5. **Results:** medal animation, credits earned, lane comparison, "What happened" list (top three causes of lost points in plain words with a suggested gear), Next night, Retry, Shop.

### Persistence
`localStorage["haunt.campaign.v1"] = {credits, owned: [...], medals: {night: tier}, best: {night: credits}}`. Export and import JSON in the settings (so progress moves between machines). Server stores nothing.

### Contract (additive, in `contract/V1_1.md` after this lands)
`GET /api/campaign` returns `{nights: [...], gear: [...]}`; `POST /api/wave/start` accepts `campaign`; `lane_ready` for lane 1 has `tier: "crew"`, `label: "Your Crew"` and `parts`. `inpage` mirrors as `getCampaign()`.

## 6. Acceptance

1. Night 1 with no gear: Crew lane has repeats and a negative or low score; with Spellbook and Seal: zero repeats (test in in-process mode).
2. Night 2 with Lantern and Shield: zero cancelled orders; with none: at least one.
3. Night 5: every boss window recovered with all five parts.
4. Each night is deterministic: two runs with the same gear give the same lane 1 score.
5. Medals computed identically in mock, live and browser modes for the same events.
6. The campaign hub, shop and results are keyboard accessible and readable at 1080p video capture.
