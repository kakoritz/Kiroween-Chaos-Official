# Judges: the 60-second tour

"Charged. Charged again." Haunt is chaos engineering for automation and AI agents, played as a game. Break your bots before the world does. Category: Skeleton Crew (one lean skeleton, two apps on it). Also entering Best Kiro Crew App.

Links (filled in by a human at submission): hosted demo, video, repo.

## 0:00 to 0:05. The hook

A bot crashes right after charging a customer, restarts, and charges again. Automations and AI agents do this with charges, emails and tickets.

## 0:05 to 0:25. The arena

Five bots race through an eight-stage order pipeline, each with more protection than the last (Rookie to Phoenix). Chaos creatures (Reaper, Wraith, Zombie, Ghost and more) inject crashes, timeouts, duplicates and outages. The arena reads a stream of real events. Nothing is animated without an event behind it.

## 0:25 to 0:45. The hero moment

Same crash, right after the charge. Rookie: 2 charges. Phoenix: 1. Phoenix replays its journal, finds its own charge and carries on. The ledger is the provider's own record, so it is the truth.

## 0:45 to 1:00. The loop and your own process

Wave 1 gets a graded report, the reviewer writes a hardening spec, Kiro applies the fix, and wave 2 grades higher. Plug in your own process the same way. The saved recording in `docs/proof/` shows F to A with a recorded fix. The live Kiro-applied proof is tracked in `docs/OPEN-ITEMS.md`.

## Where to look

| Want to see | Open |
|---|---|
| The skeleton (engine, creatures, journal, reports) | `packages/haunt/` |
| Server, mock server, live event stream | `packages/core/` |
| The seam between Core and Visuals | `contract/CONTRACT.md` |
| Specs that drove the build | `.kiro/specs/` |
| Dated build notes | `docs/KIRO-LOG.md` |
| The 3-minute video plan | `docs/DEMO-SCRIPT.md` |
| Setup and local run | `docs/DEV-SETUP.md` |

## Run it locally

```
npm install
npm run typecheck
npm test
npm run mock
```

Tests run locally only. There are no tests in CI by design.

## Honest status

`docs/KIRO-LOG.md` lists what is done and what remains per task. Items marked partial there are not finished. `docs/OPEN-ITEMS.md` lists decisions that need a human.
