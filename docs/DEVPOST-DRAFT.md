# Devpost draft

Draft only. Nothing here is published. Wording is proposed and needs the owner's approval (`docs/OPEN-ITEMS.md` item 11).

The one story used everywhere (video, README, this page, blog, social, judges):

- Hook: "Charged. Charged again."
- Number: "Rookie: 2 charges. Phoenix: 1."
- Tagline (proposed): "Break your bots before the world does."

## Name

Haunt (Kiroween-Chaos)

## Tagline

Break your bots before the world does. Chaos engineering, played as a game.

## Category

Skeleton Crew: one lean skeleton (the Haunt harness) with two apps built on it. Also entering Best Kiro Crew App.

## Inspiration

"Charged. Charged again." A bot crashes right after charging a customer, restarts, and does the work twice. Automations and AI agents crash halfway through all the time, and the damage is the repeated side effect: a double charge, a duplicate email, a duplicate ticket. Haunt reproduces that failure on purpose, shows it, and grades the result.

## What it does

- Hits a workflow with chaos creatures (Reaper, Wraith, Zombie, Ghost and others) that inject crashes, timeouts, duplicates, outages and missing files.
- Runs five bots through an eight-stage order pipeline, each with more protection than the last (Rookie, Retrier, Journaler, Reconciler, Phoenix).
- Hero moment: the same crash lands right after the charge. Rookie: 2 charges. Phoenix: 1. Phoenix replays its journal, finds its own charge and carries on. The provider's ledger is the truth.
- Plug in your own process and get a graded stress test report (sweep and ramp runs) in JSON, Markdown and offline HTML.
- Closes the loop: wave 1 gets a graded report, a reviewer writes a postmortem and a hardening spec, Kiro applies the fix, wave 2 runs, and the two reports are compared.

## Proof from the repo

From `docs/proof/loop-proof.md` for the orders app. The fix in this recording is hand-written and replayed. A live run where Kiro applies the fix is tracked as task SH-C4 in `.kiro/specs/share/`. Say "F to A" in public only after that live proof exists. Until then say what the recording shows.

| | Wave 1 | Wave 2 |
|---|---|---|
| Grade | F | A (recorded fix) |
| Repeated effects | 5 | 0 |
| Findings F1 to F5 | open | resolved |

## How we built it with Kiro

- Specs in `.kiro/specs/` (engine, harness, inbox-app, haunted-house, arena, playtest-v2, onboarding, share). Each has requirements, design and tasks. Acceptance files are the answer key.
- Steering in `.kiro/steering/` keeps sessions on the same product rules.
- Hooks in `.kiro/hooks/` regenerate fixtures when the contract changes, run property tests when the SDK is saved, and run the reviewer at the end of a wave.
- Agents in `.kiro/agents/`: a chaos director that picks creatures and a reviewer that writes the fix spec after a failed wave.
- Two lanes (core and visuals) worked in parallel against one contract, `contract/CONTRACT.md`. Each task is one branch and one pull request, logged in `docs/KIRO-LOG.md`.

## Two apps on one skeleton

- `apps/haunted-orders/`: Node order pipeline with five tier bots.
- `apps/haunted-inbox/`: Python app (standard library only) run through the Proxy and Process adapters, shown in the same arena.

## Challenges

- Keeping the arena honest: the UI reads a stream of real events, and nothing is animated without an event behind it. A validator checks the live stream against the contract.
- Making crashes replayable: seeded runs and determinism tests.
- Keeping core and visuals in step through a single contract.
- Keeping every claim as strong as its evidence, and no stronger.

## What is not finished

See `docs/KIRO-LOG.md` and `docs/OPEN-ITEMS.md`. Items marked partial there are not complete.

## Built with

TypeScript, Node, Python, Vitest, fast-check, Kiro specs, hooks, steering and agents.

## Try it

Hosted demo (no install): URL to be filled in by a human once the demo is published.

Or locally:

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
