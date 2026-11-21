# Devpost draft

Draft only. Nothing here is published.

## Name

Haunt (Kiroween-Chaos)

## Tagline

Chaos engineering for automation and AI agents, played as a game.

## Category

Skeleton Crew: one lean skeleton (the Haunt harness) with two apps built on it. Also entering Best Kiro Crew App.

## Inspiration

Automations crash halfway through and then redo work they already did. A bot killed right after charging a customer charges again. Haunt reproduces that failure on purpose, shows it, and grades the result.

## What it does

- Hits a workflow with chaos creatures (Reaper, Wraith, Zombie, Ghost and others) that inject crashes, timeouts, duplicates, outages and missing files.
- Runs five bots through an eight-stage order pipeline, each with more protection than the last (Rookie, Retrier, Journaler, Reconciler, Phoenix).
- Hero moment: the same crash lands right after the charge. The Rookie charges twice. Phoenix replays its journal, finds its own charge and carries on. The ledger counter shows the difference.
- Produces a graded stress test report (sweep and ramp runs) in JSON, Markdown and offline HTML.
- Closes the loop: wave 1 gets a graded report, a rule-based reviewer writes a postmortem and a hardening spec, the hardened Rookie runs in wave 2, and the two reports are compared.

## Proof from the repo

From `docs/proof/loop-proof.md` for the orders app:

| | Wave 1 | Wave 2 |
|---|---|---|
| Grade | F | C |
| Repeated effects | 5 | 0 |
| Lost orders | 1 | 1 |

Findings F1 to F5 were resolved. Lost orders did not improve, and we say so.

## How we built it with Kiro

- Specs in `.kiro/specs/` (engine, harness, inbox-app, haunted-house, arena). Each has requirements, design, tasks and an acceptance file used as the answer key.
- Steering in `.kiro/steering/` keeps sessions on the same product rules.
- Hooks in `.kiro/hooks/` regenerate fixtures when the contract changes, run property tests when the SDK is saved, and run the reviewer at the end of a wave.
- Agents in `.kiro/agents/`: a chaos director that picks creatures and a reviewer that writes the fix spec after a failed wave.
- Two lanes (core and visuals) worked in parallel against one contract, `contract/CONTRACT.md`. Each task is one branch and one pull request, logged in `docs/KIRO-LOG.md`.

## Two apps on one skeleton

- `apps/haunted-orders/`: Node order pipeline with five tier bots.
- `apps/haunted-inbox/`: Python app (standard library only) run through the Proxy and Process adapters.

## Challenges

- Keeping the arena honest: the UI reads a stream of real events, and nothing is animated without an event behind it. A validator checks the live stream against the contract.
- Making crashes replayable: seeded runs and determinism tests.
- Keeping core and visuals in step through a single contract.

## What is not finished

See `docs/KIRO-LOG.md` and `docs/OPEN-ITEMS.md`. Items marked partial there are not complete.

## Built with

TypeScript, Node, Python, Vitest, fast-check, Kiro specs, hooks, steering and agents.

## Try it

```
npm install
npm run typecheck
npm test
npm run build:bots
npm run haunt -- sweep --tier phoenix --orders 1 --speed 8
```

Tests run locally only. Servers bind to 127.0.0.1.

## Links

Repo URL, video URL and demo URL: to be filled in by a human at submission.
