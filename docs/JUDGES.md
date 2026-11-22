# Judges: the 60-second tour

"Charged. Charged again." Haunt is chaos engineering for automation and AI agents, played as a game. Break your bots before the world does. Category: Skeleton Crew (one lean skeleton, two apps on it). Also entering Best Kiro Crew App.

Links (filled in by a human at submission): hosted demo, video, repo.

## 0:00 to 0:05. The hook

A bot crashes right after charging a customer, restarts, and charges again. Automations and AI agents do this with charges, emails and tickets.

## 0:05 to 0:25. The arena

Five bots race through an 11-stage order pipeline (account to handoff), each wearing more of the five protections than the last (Rookie to Phoenix). Chaos creatures (Reaper, Wraith, Zombie, Ghost and more) inject crashes, timeouts, duplicates, outages and road hazards. The intensity dial runs from 1 to 11 (THROW EVERYTHING). The arena reads a stream of real events. Nothing is animated without an event behind it.

## 0:25 to 0:45. The hero moment

Same crash, right after the charge. Rookie: 2 charges. Phoenix: 1. Phoenix replays its journal, finds its own charge and carries on. The ledger is the provider's own record, so it is the truth.

## 0:45 to 1:00. The tournament, the Casebook and the loop

A tournament runs rounds of 5, 4, 3 and 2 lanes; the weakest lane falls and stays as a corpse, lessons carry into the next round, and the Casebook lists every edge case with who solved it. The pattern miner turns the rounds into a hardening spec, and the improve loop reruns the same seed and compares: wave 1 gets a graded report, the reviewer writes the spec, Kiro applies the fix, and the rerun grades higher. Plug in your own process the same way. The saved recording in `docs/proof/` shows F to A with a recorded fix. The live Kiro-applied proof is tracked in `docs/OPEN-ITEMS.md`.

## Where to look

| Want to see | Open |
|---|---|
| The skeleton (engine, creatures, journal, tournament, miner, reports) | `packages/haunt/` |
| The second app (Python Ticket Desk on the same skeleton) | `apps/haunted-inbox/` |
| The campaign (Haunted Nights, gear shop, medals) | `packages/core/campaign/`, `packages/arena-ui/src/campaign/` |
| Server, mock server, live event stream | `packages/core/` |
| The seam between Core and Visuals | `contract/CONTRACT.md` |
| Specs that drove the build | `.kiro/specs/` |
| Dated build notes | `docs/KIRO-LOG.md` |
| The 3-minute video plan | `docs/DEMO-SCRIPT.md` |
| Setup and local run | `docs/DEV-SETUP.md` |
| An automated end-to-end check of the live product | `npm run e2e` |

## Run it locally

```
npm install
npm run build:bots
npm run ui:build
npm run demo        # live server on 7070, arena in demo mode (mock if the live parts are missing)
npm run typecheck
npm test
npm run e2e         # optional: starts its own live server on ports 7171 and 7172 and prints a pass/fail table
```

In the arena: **Start tournament**, press **Next** between rounds, drag **INTENSITY** to 11, open **Patterns** and press **Improve**, switch the app to **Haunted Inbox**, or open the crypt (campaign) from the title screen. Tests run locally only. There are no tests in CI by design.

## Honest status

`docs/KIRO-LOG.md` lists what is done and what remains per task. Items marked partial there are not finished. `docs/OPEN-ITEMS.md` lists decisions that need a human.
