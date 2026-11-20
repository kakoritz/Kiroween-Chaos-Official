# Tasks: Core lane (Lane A)

Branch prefix `core/`. Each task is one PR. Tags: [C] touches `contract/`.

## H0. Unblock the visuals lane (do first)
- [ ] H0.1 [C] Write `contract/events.schema.json` from CONTRACT.md and a validator script.
- [ ] H0.2 [C] Generate the fixtures (see H0.5) and validate them. Do not hand-type events.
- [ ] H0.3 Mock server: all REST calls and SSE, replay fixtures, accept chaos commands and answer with scripted events.
- [ ] H0.4 `npm run mock` and a README section for Lane B.

## H1. Engine (haunted-house tasks 1 to 8)
- [x] H1.1 Provider with idempotency keys and ledger.
- [x] H1.2 SDK: journal, `step()`, `effect()`, replay, reconcile.
- [x] H1.3 Pipeline of eight stages and five policy tiers.
- [x] H1.4 Chaos director, hook points, nested fault stack, real SIGKILL.
- [ ] H1.5 Runner, wave manager, event log (JSONL), score engine. (Partial: event log, score engine, grading and wave manager done; lane tiers, input layout and per-lane process start/kill/restart loop done; random chaos tick, boss schedule, provider /_fault posting and ledger repeat detection pending.)
- [ ] H1.6 Live server implementing the contract. Fixtures stay generated from storyboards (they are not regenerated from live runs). (Partial: REST and SSE surface, event ring buffer, lane views, validation and engine hook interface done; engine wiring to the runner, demo scripts, ledger, reports, postmortem and hardening pending.)
- [x] H1.7 Hero crash test: Rookie 2 charges, Phoenix 1.

## H2. Creatures as plugins
- [ ] H2.1 Plugin interface and loader.
- [ ] H2.2 Six core creatures: crash, timeout, 404, missing file, duplicate, power outage.
- [ ] H2.3 Remaining creatures and the three bosses.

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


## Skeleton Crew theme for Lane A
- [ ] S-A1. Express the five tiers as sets of resilience parts (`journal`, `idempotency`, `retry`, `breaker`, `offline_queue`). Adding a part changes behavior.
- [ ] S-A2. Emit `part_added` when a hardening spec lands and a policy gains a part.
- [ ] S-A3. Keep the creature display names (Reaper, Zombie, ...) in the creature catalog data, served by `/api/creatures`.


## Additions from the full spec pass (authoritative detail in `.kiro/specs/engine/`)

H0 is complete only when all of these are done:
- [ ] H0.5 `tools/make-fixtures.ts` generates the five fixtures from `contract/STORYBOARDS.md`.
- [ ] H0.6 `tools/validate-events.ts` checks the schema and every ordering rule in `contract/PROTOCOL.md`. Wired to `npm run validate:events` and CI.
- [ ] H0.7 Mock simulator implements `engine/acceptance.md` table A for every tier and fault.
- [ ] H0.8 `npm run test:contract` suite. Runs against the mock in H0 and also against live once H1.6 exists.
- [x] H0.9 Repo scaffolding per `docs/DEV-SETUP.md`: workspaces, TypeScript, Vitest, CI, `npm run demo`.

Engine detail tasks (map to engine/design.md sections):
- [ ] E1 Order generator and per-lane provider namespace (1, 2).
- [ ] E2 Provider with key semantics, ledger JSONL, `_fault` admin (2).
- [ ] E3 Journal JSONL with fsync, torn-line tolerance, replay (3).
- [ ] E4 SDK `step()` and `effect()` with the four crash points and parts instrumentation (3, 4).
- [ ] E5 Five bot files `apps/haunted-orders/src/bots/<tier>.ts` (4).
- [ ] E6 Fault catalog with deferral, nesting stack, restart delays (5).
- [ ] E7 Random mode and boss schedule (5).
- [ ] E8 Scoring engine as a pure function of events (7).
- [ ] E9 Grading, caps, coverage matrix, recovery stats, ramp knee detection (8).
- [ ] E10 Reviewer rules R1 to R8, postmortem, hardening spec writer (11).
- [ ] E11 All property tests P1 to P8 and acceptance table A as tests (acceptance.md).
- [ ] E12 Browser target interfaces: Journal, Provider, Clock, Process, and `window.__haunt` (13).
- [ ] E13 Demo scripts `hero` and `full` run on the real engine (PROTOCOL demo mode).
- [ ] E14 Inbox app per `.kiro/specs/inbox-app/design.md`.
- [ ] E15 `docs/DEVPOST-DRAFT.md`, blog post draft, social post draft.

## Authoritative H0 order and scope (supersedes the earlier H0 list)

Do in this order. Tell Lane B when step 6 merges.
1. **H0.9 Scaffolding:** workspaces, TypeScript, Vitest, esbuild, CI, `.gitignore`, `npm run demo`. Also create `packages/arena-ui/package.json` and a placeholder `dist/index.html` (the only time Lane A touches that folder; Lane B owns it afterwards).
2. **H0.1** `contract/events.schema.json` from `PROTOCOL.md` and `runtime.md` section 9.
3. **H0.6** `tools/validate-events.ts` (schema plus every ordering rule).
4. **H0.5** `tools/make-fixtures.ts` generating all fixtures in `STORYBOARDS.md` (including `full`, `loop` and the extra fixtures).
5. **H0.7** Mock server with the **outcome-template table** (`runtime.md` section 15), not an engine. This is the long pole. Ship calm, hero and the REST surface first, then the rest.
6. **H0.3, H0.4** Mock server REST and SSE complete, `npm run mock`, README for Lane B, `window.__haunt` stub, `/_mock/fault`.
7. **H0.8** Contract test suite against the mock.
H1 starts after step 6. Aim for steps 1 to 6 within one day, even if some extra fixtures follow.

Task numbering note: E1 to E15 are the detailed tasks inside H1 to H4. E1-E8 belong to H1, E6-E7 to H2, E9 to H3/H4, E10 to H4, E11 across all, E12 to H6.3, E13 to H5, E14 to H6.2, E15 to H5.
