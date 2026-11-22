# Spec map and precedence

When two documents disagree, the higher one wins.

| Rank | Document | Owns |
|---|---|---|
| 0 | `contract/V1_1.md` | Additive v1.1: pace slow, travel gaps, laps, reviews, decisions, new faults and endpoints. Mock, fixtures, validator and `window.__haunt` all implement it (PT-C0 done) |
| 1 | `contract/PROTOCOL.md` | Events, endpoints, ordering, state shapes, mock behavior |
| 2 | `contract/CONTRACT.md`, `STORYBOARDS.md` | IDs, catalogs, fixtures.  |
| 2b | `.kiro/specs/playtest-v2/` (design, ui, requirements, tasks) | Laps, reviews, scoring v2, travel, world events, wrong-order decisions, UI v2. **Wins over engine and arena specs where it differs** |
| 2d | `.kiro/specs/tournament-v3/`, `contract/V1_2.md`, `.kiro/specs/packs/`, `docs/FIT-CHECK.md` | Tournament, 11-step order, lessons, Casebook, dial, curses, swarm FX, miner and fix specs, packs, production mode. **Wins over playtest-v2 where it differs** |
| 2c | `.kiro/specs/campaign/`, `.kiro/specs/onboarding/`, `.kiro/specs/share/` | Campaign game, first-impression and video, badge, Action, Workflow Lab, real loop proof, Kiro proof |
| 3 | `.kiro/specs/engine/design.md` and `acceptance.md` | Pipeline, provider, journal, tiers, faults, scoring, grading, oracle |
| 4 | `.kiro/specs/inbox-app/design.md` | App 2 |
| 5 | `.kiro/specs/harness/` | Haunt product requirements and Lane A tasks |
| 6 | `.kiro/specs/arena/` | Lane B requirements, visuals and tasks |
| 7 | `docs/WINNING.md`, `DEMO-SCRIPT.md` | Rules, rubric, video |
| 8 | `docs/SWIMLANES.md`, `DEV-SETUP.md`, `AGENTS.md` | Process |
| 9 | `.kiro/specs/haunted-house/` | **First draft, partly superseded** |

## What is superseded in `haunted-house/`

- "Rooms" (Cellar, Mirror Hall, Crypt, Poltergeist, Locked Door) became the creature and fault catalog in `engine/design.md` section 5.
- SQLite for journal and ledger became JSONL.
- The 6-step order workflow became the 8-stage pipeline in `engine/design.md` section 1.
- "Survivor bot and Naive bot" became five tiers.
- Its task list is replaced by `harness/tasks.md`. Its R2, R3, R4, R7 are still valid as intent and are made exact in `engine/`.

## Glossary

| Term | Meaning |
|---|---|
| Haunt | The product: harness plus CLI plus reports |
| Arena | The game UI (Lane B) |
| Lane (track) | One tier's track in the arena. Also "Lane A / Lane B" means a work stream. Context makes it clear: "lane 1" is a track, "Lane A" is a session. |
| Tier | One of five bot implementations: rookie, retrier, journaler, reconciler, phoenix |
| Part | A resilience capability: retry, journal, idempotency, breaker, offline_queue. Shown as gear. |
| Fault | A technical failure (`crash`, `http_404`, ...) |
| Creature | How a fault is shown (Reaper, Zombie, ...) |
| Boss | A creature that hits all lanes at once |
| Effect | A side effect outside the bot (charge, email, ...) |
| Ledger | The provider's own record of effects. The source of truth. |
| Journal | The bot's own append-only memory |
| Repeat | An effect that happened more than once |
| Wave | One run of N orders through all lanes |
| Sweep, stack, ramp, soak | Haunt test modes |
| Hardening spec | A spec written by the reviewer from run findings, applied by Kiro |

## Glossary additions (play-test v2)

| Term | Meaning |
|---|---|
| Lap | One order's trip with its time, attempts, retries, downtime, issues |
| Issue | A counted problem event at a stage |
| Downtime | Time an order is not progressing because of a failure; costs points |
| Review | The customer's star rating of an order |
| Cancelled | A failed order (shown as cancelled) |
| World event | A failure with a story at a step (SMS down, gated house, wrong address) |
| Decision | A player choice (refund, discount, redo) for a wrong order |
| Night | A campaign level |
| Crew | The player's own lane in the campaign |
