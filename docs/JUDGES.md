# Judges: the 60-second tour

Haunt is a chaos and resilience harness for automation and AI agents, played as a game. Category: Skeleton Crew (one lean skeleton, two apps on it). Also entering Best Kiro Crew App.

## 0:00 to 0:15. The problem

Automations crash halfway through, then redo the work. A bot killed right after charging a customer charges again. Haunt reproduces that on purpose and grades the result.

## 0:15 to 0:35. The arena

Five bots race through an eight-stage order pipeline, each with more protection than the last (Rookie to Phoenix). Chaos creatures (Reaper, Wraith, Zombie, Ghost and more) inject crashes, timeouts, duplicates and outages. The arena UI reads a stream of real events. Nothing is animated without an event behind it.

## 0:35 to 0:50. The hero moment

Same crash, right after the charge. The Rookie charges twice. Phoenix replays its journal, finds its own charge and carries on. The ledger counter shows the difference (Rookie 2, Phoenix 1).

## 0:50 to 1:00. The loop

Run wave 1 and get a graded report. The reviewer turns the failures into a hardening spec. Kiro implements it. Run wave 2 and the grade rises. Both reports are saved in `docs/proof/`.

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
