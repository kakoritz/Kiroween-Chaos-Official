# Spec map and precedence

When two documents disagree, the higher one wins.

| Rank | Document | Owns |
|---|---|---|
| 1 | `contract/PROTOCOL.md` | Events, endpoints, ordering, state shapes, mock behavior |
| 2 | `contract/CONTRACT.md`, `STORYBOARDS.md` | IDs, catalogs, fixtures.  |
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
