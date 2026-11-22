# Devpost draft (ON-D2)

Draft only. Nothing here is published. The owner approves wording and fills the links. Every claim below points at a file in the repo; lines marked **TO VERIFY** need the owner.

## Name

Haunt (Kiroween-Chaos)

## Tagline

Break your bots before the world does. Chaos engineering, played as a tournament.

## Category

Skeleton Crew. Also entering Best Kiro Crew App, Best Demo, the Bonus Blog Prize and Social Blitz.

## Inspiration

"Charged. Charged again." A process crashes right after charging a customer, restarts, and does the work twice. Automations and AI agents do this all the time, and the damage is always the repeated side effect. We kept seeing the same bug in different clothes: a duplicate charge, a duplicate ticket, a double stream. Haunt reproduces that failure on purpose, shows who survives, and then writes the fix as a Kiro spec.

## What it does

- Runs five bots (Rookie, Retrier, Journaler, Reconciler, Phoenix) through the same chaos. The provider's ledger is the truth, not the bot. After a crash right after the charge: Rookie 2 charges, Phoenix 1 (`packages/haunt/test/hero-crash.test.ts`).
- **Tournament.** Rounds of 5, 4, 3, 2 lanes on one seeded storm. The lowest lane is eliminated and leaves a corpse on the stage where it died.
- **Intensity dial** from 1 to 10 and an override at 11 (THROW EVERYTHING), changeable live. **Curses** (cursed 404, slow endpoint, flaky 500, skewed clock, rate limit) follow a lane and the report shows whether it handled, reported, swallowed or crashed on each.
- **Lessons and the Casebook.** A lane that overcomes an edge case records the mechanism and reuses it. The Casebook lists every edge case, who solved it, how and at what cost, with awards (Champion, Battle-Tested, Iron Skeleton, Fastest Recovery, Wooden Spoon).
- **Pattern miner and fix specs.** Recurring problems become `.kiro/specs/hardening-<run>/` with evidence, a smallest-patch design and a test per requirement; `haunt spec-lint` checks it. The **improve loop** runs, mines, applies cheap fixes as policy, reruns the same plan and compares. Sample from `docs/proof/sample-hardening-spec/`: "closed 5 of 9 patterns", grade C to B, on one seeded run.
- Plug in your own process with a `haunt.yaml` and get a graded report (JSON, Markdown, offline HTML), a badge and a scorecard.

## Two apps on one skeleton

- `apps/haunted-orders/` (Node): an 11-step order pipeline from account to handoff.
- `apps/haunted-inbox/` (Python, standard library only): reads mail, classifies, files a ticket, sends a reply. Same harness, no engine change.

Not built yet, and we say so: the full 11-stage Ticket Desk flow with fake Jira, Asana and KACE adapters, and a streaming pack. Both are specified in `.kiro/specs/packs/spec.md`.

## How we built it with Kiro

- **Specs.** 12 spec folders (30 files) in `.kiro/specs/`: engine, harness, arena, campaign, playtest-v2, onboarding, share, tournament-v3, packs and more. Acceptance files were the answer key. 159 task boxes are ticked and 76 are open (the boxes lag some merged work).
- **Steering.** `product.md`, `tech.md`, `contract.md`, `art.md`. The rule "everything the UI shows is driven by a contract event" shaped the mock server and the browser build.
- **Hooks.** Five in `.kiro/hooks/`: fixture validation on contract save, the crash-point property test on SDK save, trace regeneration, spec lint on hardening specs, and the reviewer at wave end.
- **MCP and Power.** `haunt-mcp` exposes `haunt_define`, `haunt_sweep`, `haunt_ramp`, `haunt_report`, `haunt_badge`. A stdio client ran `initialize` and `tools/list` against the Power and Crew manifests (`docs/proof/installed/`). **TO VERIFY:** not yet installed into a Kiro IDE or Kiro Crew window.
- **Crew agents.** `chaos-director` (runs sweeps, never edits bots) and `reviewer` (writes postmortems and hardening specs, write access limited by path). Two lanes, core and visuals, worked in parallel on one contract, one branch and one PR per task: 216 PRs.
- **Property tests.** fast-check kills the bot at every hook call. It found a real replay bug (see the blog post).

## Challenges

- Keeping the arena honest: the UI only draws what a contract event says, and a validator checks the live stream. The first live stream failed it with 500+ violations.
- Overstated proof. Early waves graded A because ledger repeats were not attached yet. The first saved loop proof showed C, not A. We corrected the claim.
- Changing the order pipeline from 8 to 11 stages touched bots, fixtures, ledger, grader and UI at once.
- Dense screen: 11 stage chips, corpses, swarms and curses at once. The first-run view stays calm and the dial adds the chaos.

## Accomplishments

- The same crash, two numbers, proven by the provider's ledger.
- A game loop that ends in a lint-checked spec rather than a score.
- 1,434 tests in 157 files; on one local run 1,432 passed and 1 failed with a worker timeout under load.
- One skeleton, two languages.

## What we learned

- A spec with an acceptance table catches more than a prompt does, but only when the task names the exact file and row.
- Counting side effects at the provider is the only count worth trusting.
- Say "recorded" when it is recorded. The loop proof's fix file is hand-written; we label it that way (`docs/proof/live-fix.md`).

## What's next

- Apply a generated fix spec live in Kiro and save the transcript and diff.
- Build the Ticket Desk flow and the streaming pack, so all three outfits are real.
- Production mode (`haunt monkey`) with allowlist, blast radius and kill switch (designed, not built).
- Install the Power and the Crew app in real Kiro windows and capture them.

## Built with

TypeScript, Node, Python, Vitest, fast-check, Vite, Kiro specs, steering, hooks, agents, MCP.

## Try it

Hosted demo: **TO FILL** (not published yet; `npm run build:hosted` builds it). Locally:

```
npm ci
npm run demo
```

## Links

Repo, video and demo URLs: to be filled by the owner at submission.
