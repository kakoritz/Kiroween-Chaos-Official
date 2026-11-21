# Blog post draft

Draft only. Not published.

## We built a haunted house for bugs: Haunt at Kiroween 2026

Automations crash halfway through. The bad part is not the crash. The bad part is what happens on restart, when the bot redoes work it already finished. A bot killed right after charging a customer charges them again.

For Kiroween 2026 we built Haunt, a chaos engineering harness for automation and AI agents, and we played it as a game. Chaos creatures such as the Reaper, Wraith, Zombie and Ghost inject crashes, timeouts, duplicates and outages into a workflow. A ledger counts every side effect, and a grader turns the result into a report.

### The hero moment

Five bots run an eight-stage order pipeline, each with more protection than the last: Rookie, Retrier, Journaler, Reconciler and Phoenix. Hit them with the same crash right after the charge. The Rookie charges twice. Phoenix replays its journal, finds its own charge and carries on.

### The loop

Wave 1 produces a graded report. A reviewer reads the failures and writes a hardening spec. The hardened Rookie runs in wave 2. In our saved proof (`docs/proof/`), the orders app went from grade F to grade C, and repeated effects went from 5 to 0. Lost orders stayed at 1 in both waves. We left that in the report because a harness that hides failures is not worth much.

### How Kiro drove the build

We worked from specs, not chat. Each spec area has requirements, design, tasks and an acceptance file that acts as the answer key. Steering files keep every session on the same product rules. Hooks regenerate fixtures when the contract changes and run property tests when the SDK is saved. A chaos director agent picks creatures, and a reviewer agent writes the fix spec after a failed wave.

Two lanes, core and visuals, worked in parallel against one contract. Each task was one branch and one pull request, and each is logged with a date in `docs/KIRO-LOG.md`.

### Two apps, one skeleton

The skeleton is the Haunt harness: engine, SDK, creatures, journal and reports. The orders app (Node) and the inbox app (Python) both run on it, which is why we entered Skeleton Crew.

### Try it

```
npm install
npm run typecheck
npm test
npm run build:bots
npm run haunt -- sweep --tier phoenix --orders 1 --speed 8
```

Tests run locally only. Everything binds to 127.0.0.1.

### What is left

Some tasks are marked partial in the log. We list them rather than round them up.
