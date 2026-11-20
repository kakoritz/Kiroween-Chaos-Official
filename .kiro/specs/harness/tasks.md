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
