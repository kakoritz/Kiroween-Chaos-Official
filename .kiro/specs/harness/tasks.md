# Tasks: Core lane (Lane A)

Branch prefix `core/`. Each task is one PR. Tags: [C] touches `contract/`.

## H0. Unblock the visuals lane (do first)
- [ ] H0.1 [C] Write `contract/events.schema.json` from CONTRACT.md and a validator script.
- [ ] H0.2 [C] Hand-author the five fixtures and validate them.
- [ ] H0.3 Mock server: all REST calls and SSE, replay fixtures, accept chaos commands and answer with scripted events.
- [ ] H0.4 `npm run mock` and a README section for Lane B.

## H1. Engine (haunted-house tasks 1 to 8)
- [ ] H1.1 Provider with idempotency keys and ledger.
- [ ] H1.2 SDK: journal, `step()`, `effect()`, replay, reconcile.
- [ ] H1.3 Pipeline of eight stages and five policy tiers.
- [ ] H1.4 Chaos director, hook points, nested fault stack, real SIGKILL.
- [ ] H1.5 Runner, wave manager, event log (JSONL), score engine.
- [ ] H1.6 Live server implementing the contract. Fixtures regenerated from real runs.
- [ ] H1.7 Hero crash test: Rookie 2 charges, Phoenix 1.

## H2. Monkeys as plugins
- [ ] H2.1 Plugin interface and loader.
- [ ] H2.2 Six core monkeys: crash, timeout, 404, missing file, duplicate, power outage.
- [ ] H2.3 Remaining monkeys and the three bosses.

## H3. Harness product
- [ ] H3.1 `haunt.yaml` loader and validator.
- [ ] H3.2 Sweep mode and coverage matrix.
- [ ] H3.3 Stack mode and depth curve.
- [ ] H3.4 Ramp mode, knee and break detection.
- [ ] H3.5 Soak mode.
- [ ] H3.6 Boss mode and Compare mode.
- [ ] H3.7 Proxy adapter and Process adapter.
- [ ] H3.8 Second sample process (non-Node) to prove reuse.

## H4. Report and loop
- [ ] H4.1 Grading rules and target checks.
- [ ] H4.2 Report builder: JSON, Markdown, offline HTML.
- [ ] H4.3 Reviewer: postmortem and hardening spec writer.
- [ ] H4.4 CI exit codes and a GitHub Actions example.
- [ ] H4.5 Determinism tests.

## H5. Ship
- [ ] H5.1 README, quick start, "How Kiro built this".
- [ ] H5.2 Demo run script that feeds the UI lane's demo mode.

## Cut line
Ship H0, H1, H2.2, H3.1, H3.2, H3.4, H4.1, H4.2. That gives a graded sweep and a ramp report on the demo bot. Everything else is polish.

## H6. Win-the-hackathon items (see docs/WINNING.md)
- [ ] H6.1 Repo layout for Skeleton Crew: `packages/haunt` is the skeleton, `apps/haunted-orders` and `apps/haunted-inbox` are the two apps, each in its own folder.
- [ ] H6.2 App 2: Haunted Inbox in **Python** (email triage, ticket, reply), tested through the Proxy and Process adapters.
- [ ] H6.3 Browser target: engine runs in Web Workers, crash is `worker.terminate()`, journal and ledger in the page. Contract mode `browser`. Hosted on GitHub Pages.
- [ ] H6.4 Property-based tests with `fast-check` for crash point by step: side-effect count is 1 for Phoenix. Record any bug it finds in KIRO-LOG.
- [ ] H6.5 `haunt-mcp` server: `haunt_define`, `haunt_sweep`, `haunt_ramp`, `haunt_report`.
- [ ] H6.6 Custom agents `chaos-director` and `reviewer` in `.kiro/agents/`.
- [ ] H6.7 Hooks in `.kiro/hooks/`: PBT on SDK save, fixture validation on contract save, reviewer on wave end.
- [ ] H6.8 Kiro Power packaging of Haunt.
- [ ] H6.9 Kiro Crew app packaging: manifest, MCP tools, reviewer agent, skill `stress-test-my-workflow`, and a page that hosts the arena UI. Read the Kiro Crew apps doc first.
- [ ] H6.10 The loop proof: run wave 1 (Rookie F), reviewer writes the hardening spec, Kiro implements it, run wave 2 (grade A). Save both reports in `docs/proof/`.
- [ ] H6.11 `docs/KIRO-LOG.md`: dated notes as we build. `docs/JUDGES.md`: a 60-second tour.
- [ ] H6.12 Fresh-clone test script and a CI job for it.

## Cut line update
Never cut: H0, H1, H2.2, H3.1, H3.2, H4.1, H4.2, H6.3, H6.4, H6.10, H6.11. Cut first: H3.5, H3.6, H6.8.

## Frankenstein theme for Lane A
- [ ] F-A1. Express the five tiers as sets of resilience parts. Policy objects become `parts[]`. Adding a part changes behavior.
- [ ] F-A2. Emit `part_stitched` when a hardening spec lands and the policy gains a part.
- [ ] F-A3. Write the write-up section "What we stitched together and why it is unexpectedly powerful" in KIRO-LOG and the Devpost text.
