# Judges: the first 5 minutes

"Charged. Charged again." Chaos engineering for AI agents, played as a haunted house. Kiroween Chaos crashes and curses your bots, grades how they survive, and shows the exact fix. One engine, two apps: Node and Python. Break your bots before the world does. Category: Skeleton Crew (one lean skeleton, two apps on it). Also entering Best Kiro Crew App.

Links (filled in by a human at release): hosted demo, repo.

## Pick a path

| Path | Needs | Time | What is real |
|---|---|---|---|
| **A. Hosted** (open the hosted URL) | A desktop browser | 1 min | Arena, Workflow Lab and campaign run in your browser. Tournament, Casebook and improve loop replay **recorded** runs of the real engine; a banner says so |
| **B. Local** (`npm ci && npm run demo`) | Node 20+ (Python 3.12 for the Ticket Desk) | 2 min | Everything: real child processes, real provider, real ledger |
| **C. Hosted build, served locally** (`npm ci && npm run build:hosted && npm run serve:hosted`) | Node 20+ | 1 min | Same as A, at http://127.0.0.1:8080/ |

Path B opens the arena at `http://127.0.0.1:7070/`. If 7070 or 7071 is taken: `HAUNT_PORT=17070 HAUNT_PROVIDER_PORT=17071 npm run demo`. Everything binds to `127.0.0.1`.

## The tour

1. **The hook.** A bot crashes right after charging a customer, restarts, and charges again. Automations and AI agents do this with charges, emails and tickets.
2. **The hero moment (0:00 to 1:00, `npm run demo` opens it).** Same crash, right after the charge. Rookie: 2 charges. Phoenix: 1. Phoenix replays its journal, finds its own charge and carries on. The ledger is the provider's own record, so it is the truth.
3. **The tournament.** Press **Start tournament**. Five bots race through an 11-stage order pipeline, each wearing more of the five protections than the last (Rookie to Phoenix). Chaos creatures inject crashes, timeouts, duplicates and outages. Press **Next** between rounds: the weakest lane falls and stays as a corpse, lessons carry over.
4. **The dial and curses.** Drag **INTENSITY** from 1 to 11 (THROW EVERYTHING). Curses follow one endpoint of one lane: cursed 404, slow, flaky 500, clock skew, rate limit.
5. **The Casebook.** At the end: champion, awards, and every edge case with who solved it, how and at what cost.
6. **Patterns and the loop.** Open **Patterns**: recurring problems ranked by cost, **Write fix spec**, then **Improve**. The loop reruns the same seed and compares. Read it as a **projection**: the improve rerun simulates parts a lane lacks, so it shows what the fix would do, it does not run patched code. The recorded real fix is in `docs/proof/live-fix.md`.
7. **The second app.** Switch the header app to **Haunted Inbox**: a Python Ticket Desk that files tickets and sends replies, on the same skeleton with no engine change.
8. **Campaign and Lab.** Open the crypt from the title screen (seven Haunted Nights, gear shop, medals). Open `/workflow-lab.html` to model your own workflow; presets include the streaming pack. Lab results are model-based and labelled so.

## Optional checks (each run and timed)

| Command | Expect |
|---|---|
| `npm run demo -- --check` | `demo check ok (mode live, contract 1)` in about 6 s |
| `npm run validate:events` | `validate:events: 44 file(s) ok` |
| `npm run validate:live` | `0 violations` after about 2.5 minutes |
| `npm run haunt -- ramp --tier phoenix --orders 4 --steps 1,2 --speed 16 --no-gate` | A ramp table in about 12 s |
| `npm run haunt -- monkey --mode staging --dry-run` | A plan with one `INJECT latency` line; nothing is injected |
| `npm run verify` | Runs the five PR checks (script arrives with PR #253) |

Do not run a default `npm run haunt -- sweep`: it takes more than 5 minutes (about 5 even with `--orders 1 --speed 16`). `npm run e2e` takes 6 to 10 minutes.

## Where to look

| Want to see | Open |
|---|---|
| The skeleton (engine, creatures, journal, tournament, miner, reports) | `packages/haunt/` |
| The second app (Python Ticket Desk) | `apps/haunted-inbox/` |
| The guarded monkey | `packages/haunt/src/monkey/`, `docs/PRODUCTION-MODE.md` |
| The campaign | `packages/core/campaign/`, `packages/arena-ui/src/campaign/` |
| The seam between Core and Visuals | `contract/CONTRACT.md` |
| Specs that drove the build | `.kiro/specs/` |
| How Kiro built it | `docs/KIRO-WRITEUP.md`, `docs/KIRO-LOG.md` |
| Setup and conventions | `docs/DEV-SETUP.md` |

## Honest status

- Real: Orders app, five tiers, hero crash, Inbox (Python), tournament, dial, curses, Casebook, miner, fix specs, guarded monkey, `validate:live` at 0 violations.
- Model-based or recorded: Workflow Lab and packs, the improve loop projection, the hosted tournament.
- Not built: a runnable streaming app, a live Kiro-applied fix on record, Power and Crew app installed in a Kiro window.
- Mobile: the arena is a fixed 1280x720 canvas (about 30% on a phone). Use a desktop browser.
- Tests run locally only; CI does not run them.
