# How Kiro built Kiroween Chaos

An evidence-only account of how Kiro was used to build Kiroween Chaos. Every claim points at a file in this repo. Where the repo cannot back a claim, it is marked **TODO (owner)**. The rubric-ordered companion is [`KIRO-WRITEUP.md`](KIRO-WRITEUP.md); the dated notes are [`KIRO-LOG.md`](KIRO-LOG.md).

## 1. Measured numbers

Counted on `main` of this repository on 2026-11-23. Git history here was imported as 50 commits (2026-11-20 to 2026-11-23); the original private repository's PR list is kept in `docs/PR-HISTORY.md`.

| Measure | Value | Source |
|---|---|---|
| Spec folders / files | 12 folders, 30 files | `find .kiro/specs -type f` |
| Task boxes in `tasks.md` files | 174 ticked, 61 open, across 10 files | `.kiro/specs/*/tasks.md` |
| Steering files | 4 (`product`, `tech`, `contract`, `art`) | `.kiro/steering/` |
| Hooks | 5 | `.kiro/hooks/` |
| Custom agents | 2 (`chaos-director`, `reviewer`) | `.kiro/agents/` |
| Commits in this repo | 50 (imported history), 2026-11-20 to 2026-11-23 | `git log` |
| Pull requests (original repo) | 256 listed, 248 merged | `docs/PR-HISTORY.md` |
| Branch prefixes used | `core/<task>`, `ui/<task>`, `contract/<task>` | `docs/SWIMLANES.md`, `.kiro/steering/contract.md` |
| Traceability | 69 tasks, 49 done, 47 with a PR (68%), 4 with a test link (6%); 73 requirements, 0 linked | `docs/TRACE.md` |

Caveats: task boxes lag merged work (for example `tournament-v3/tasks.md` has 1 ticked and 25 open boxes, although TV3-C11, C12 and C13 are described as landed in `docs/KIRO-LOG.md`). The 0% requirement coverage in `docs/TRACE.md` is a real gap: requirement IDs are not yet linked to PRs or tests by `// covers:` comments.

## 2. Specs to code

Specs were written before code (see `KIRO-LOG.md`, "2026-11-20: specs first"). Each row: spec folder, files, task IDs that appear in commit subjects.

| Spec folder (`.kiro/specs/`) | Files | Example task IDs and what they became |
|---|---|---|
| `haunted-house` | `requirements`, `design`, `tasks` | First draft of the product; superseded by the split below. All 21 boxes still open, so it is a draft, not a work list. |
| `engine` | `acceptance`, `design`, `runtime` | Acceptance table A is the oracle the sweep is tested against; reviewer rules R1 to R8 live in `design.md` section 11 and are implemented in `packages/haunt/src/reviewer`. |
| `harness` | `requirements`, `tasks` | `H0.x` to `H6.x`: provider with ledger, SDK, mock server, validator (63 ticked, 1 open). |
| `arena` | `requirements`, `design`, `tasks`, `ui-spec` | `UI-*` and `UI-ART*` PRs on `ui/` branches (38 ticked, 1 open). |
| `inbox-app` | `design` | Python Ticket Desk under `apps/haunted-inbox`. |
| `playtest-v2` | `requirements`, `design`, `tasks`, `ui` | `PT-C0e` (`window.__haunt` v1.1, #153), scoring v2, laps, reviews (26 ticked, 4 open). |
| `campaign` | `spec`, `tasks` | `CP-C1` to `CP-C4`, `CP-U1` to `CP-U3` done; `CP-C5`, `CP-U4`, `CP-U5` open (`docs/TRACE.md`). |
| `onboarding` | `spec`, `tasks` | `ON-C1`, `ON-U1` to `ON-U4`, `ON-D1`; `ON-D3` open. |
| `share` | `spec`, `tasks` | `SH-C4` (loop proof, #192, recorded fix only), Workflow Lab, badge, Action. |
| `tournament-v3` | `spec`, `tasks` | `TV3-C1` (11-step pipeline), `TV3-C7` (engine), `TV3-C11` (pattern miner, `c4d9055`), `TV3-C12` (fix spec writer and lint, `df0c353`), `TV3-C13` (improve loop, `c2b12f9`, follow-up `1f55fff`). |
| `packs` | `spec`, `tasks` | `PK-C1` to `PK-C7` and `PK-U1` to `PK-U3`; the Ticket Desk (PK-C3) runs live with 11 stages (`docs/DECISIONS.md` 2026-11-22). |
| `hardening-loop-w1` | `requirements`, `design`, `tasks` | Output of the reviewer, not hand-written; tasks `F1` to `F5`, all `[x]`. See section 5. |

Convention: PR titles carry the task ID (for example `TV3-C13: self-improving loop`, `SH-C4: real loop proof write-up, recorded-fix label (#192)`). `docs/SPEC-MAP.md` maps specs to areas; `docs/TRACE.md` is generated from specs, git log and tests.

## 3. Steering

`.kiro/steering/` holds 4 files, 3,897 bytes in total. Rules that visibly shaped the repo:

- `product.md`: "Everything the UI shows is driven by a contract event. No fake animation." and "Never add `.kiro/` to `.gitignore`."
- `tech.md`: Vitest 3.2.7 and fast-check 4.10.3 pinned, tests are a local gate and never run in CI, servers bind `127.0.0.1`.
- `contract.md`: the core/visuals seam is `contract/`; contract changes are their own labelled PR; a hardening spec is never applied automatically.
- `art.md`: art drawn in code, CC0 only for minor props, no AI-generated assets.

`KIRO-WRITEUP.md` notes that `tech`, `contract` and `art` were added late (SH-K5) and documented existing rules. Whether a steering rule changed a Kiro answer in a session is **TODO (owner)**; the repo has no transcript showing it.

## 4. Hooks

| File in `.kiro/hooks/` | Fires on | Action |
|---|---|---|
| `pbt-on-sdk-save.kiro.hook` | `fileEdited`: `packages/haunt/src/sdk/**/*.ts` | runs `npx vitest run packages/haunt/test/pbt-crash-point.test.ts` |
| `fixtures-on-contract-save.kiro.hook` | `fileEdited`: `contract/**`, `fixtures/**` | runs `npm run validate:events` |
| `trace-on-merge.kiro.hook` | `fileEdited`: `.kiro/specs/**/*.md`, test files under `packages/` and `apps/` | runs `npm run trace` (regenerates `docs/TRACE.md`) |
| `lint-hardening-spec.kiro.hook` | `fileEdited`: `.kiro/specs/hardening-*/*.md` | `askAgent`: run `haunt spec-lint` on that folder, fix the spec only, rerun |
| `reviewer-on-wave-end.kiro.hook` | `userTriggered` (manual) | `askAgent`: act as the reviewer on the newest `.haunt/runs/` run, write postmortem and hardening spec, optional `--llm` draft |

Note: `trace-on-merge` is named for merges but its trigger is a file save. How many times each hook caught a problem is **TODO (owner)**; the repo does not record hook firings.

## 5. Agents and the hardening loop

Agents in `.kiro/agents/`:

- `chaos-director` (added 2026-11-20, #44; tools `fs_read`, `fs_write`, `execute_bash`; `resources` load `product.md`, `engine/design.md`, `engine/acceptance.md` as context): picks faults, crash points and ramp level, runs `npm run live` or `npm run haunt`, reports the grade matrix. Write access limited to `.tmp/**` and `.haunt/**`; prompt says it never edits bot code.
- `reviewer` (same PR; tools `fs_read`, `fs_write` only; `allowedTools` is `fs_read`, so every write asks): reads a finished run, applies rules R1 to R8 (`.kiro/specs/engine/design.md` section 11), writes `postmortem.md` and `.kiro/specs/hardening-<run>/`. Write access limited by path to hardening specs, `.haunt/runs/**` and `.tmp/`. It has no path that reaches source code.

The loop, in order:

1. A wave runs and produces an event log.
2. The reviewer (agent, or `runReviewer` + `writeReview` in `packages/haunt/src/reviewer`) writes a fix spec. The tournament path uses the pattern miner and spec writer (TV3-C11, C12) instead.
3. `haunt spec-lint` checks the spec (hook `lint-hardening-spec`).
4. **A human or a developer agent turns the spec into a normal task and reviews it.** Nothing applies a hardening spec automatically (`.kiro/steering/contract.md`, `docs/DEV-SETUP.md`: "Nothing applies code").
5. The same plan reruns and the reports are compared.

### What the numbers are, and what they are not

- **Recorded loop proof (`docs/proof/live-fix.md`, `docs/proof/loop-proof.md`).** Crash-only plan, seed 7: wave 1 grade F with 5 repeated effects; the reviewer wrote `.kiro/specs/hardening-loop-w1/` with tasks `F1` to `F5`; wave 2 grade A with 5 repeats down to 0 and 0 lost orders. The fix, `apps/haunted-orders/src/bots/rookie.hardened.ts`, was **written ahead of time**. It was not produced by a Kiro session running the spec. `live-fix.md` says the claim allowed today is "fix recorded".
- **Improve loop sample (`docs/proof/sample-hardening-spec/improve-report.txt`).** One seeded tournament run: grade C to B, reliability 70 to 87, lost orders 9 to 2, repeated effects 9 to 8, "closed 5 of 9 patterns". The "fix" in that run is a **policy overlay** (a per-lane policy limited to the tier's parts, `docs/DECISIONS.md` 2026-11-21), plus patterns marked `spec`, which stay open until code is changed. It is a projection of what a fix would change in the simulation. It is not a code change made by Kiro.
- **No recorded live Kiro fix exists in the repo yet.** No transcript, diff or screen recording of a Kiro session applying a hardening spec is saved.

### Recorded live fix (TODO: needs a real Kiro session)

> **TODO (owner).** Run the steps in `docs/proof/live-fix.md` ("To make the fix live"): wave 1, open `.kiro/specs/hardening-<run-id>/` in Kiro, run its tasks against `apps/haunted-orders/src/bots/rookie.ts`, save transcript, `git diff` and screen recording under `docs/proof/`, run wave 2 and save both reports. Then replace this block with the run id, the Kiro surface used, the diff, and the before/after grades. Until then, do not describe any fix here as applied by Kiro.

## 6. Two lanes, contract first

`docs/SWIMLANES.md` defines the workflow:

| | Lane A: Core | Lane B: Visuals |
|---|---|---|
| Folders | `packages/core`, `packages/haunt`, `apps`, `tools` | `packages/arena-ui` |
| Branches | `core/<task>` | `ui/<task>` |
| Specs | `engine`, `harness`, `inbox-app` | `arena` |

- The only shared surface is `contract/` (schema, `PROTOCOL.md`, fixtures). Core shipped the mock server first so the UI was never blocked (`docs/SWIMLANES.md`, "Hand-off order").
- One PR per task, task ID in the title, never a commit to `main`. Contract PRs carry the `contract` label and need the other lane's approval (`.kiro/steering/contract.md`).
- Branch prefixes: `core/`, `ui/`, `contract/` (counts are not available: this repo has only `main`).
- The seam was tested mechanically: `npm run validate:events` (hook `fixtures-on-contract-save`) checks the live stream against the schema. The first live stream failed it with 500+ violations and a normalizer took it to 0 (PRs #64, #74; `KIRO-LOG.md`).

## 6a. Kiro IDE, CLI, Web and Crew: roles

What each surface did, from files in this repo. The repo has no session transcripts, so "used for" is limited to what a file proves.

| Surface | Role in this project | Evidence |
|---|---|---|
| Kiro IDE | Home of the spec workflow and hooks: `.kiro/specs/<area>/{requirements,design,tasks}.md`, `.kiro/steering/*.md`, `.kiro/hooks/*.kiro.hook` (`fileEdited`, `userTriggered`, `runCommand`, `askAgent`). A hardening spec is meant to be opened here and run as tasks. | `.kiro/` tree; `docs/proof/live-fix.md` ("To make the fix live") |
| Kiro CLI | The agent files in `.kiro/agents/*.json` use the Kiro agent format (`tools`, `allowedTools`, `toolsSettings.fs_write.allowedPaths`, `resources`). The reviewer's optional `--llm` pass calls the Kiro CLI when it is configured, and falls back to rules. | `.kiro/agents/`, hook `reviewer-on-wave-end` |
| Kiro Web | **TODO(owner):** no file in the repo records Kiro Web use. | none |
| Kiro Crew | Parallel branch-per-task work: one PR per task ID across two lanes (`core/`, `ui/`), with subagent PRs merged after local gates. Also the host for `kiro-crew-app/` (manifest checked against the Crew app manifest parser; a stdio client started the MCP server from it, `docs/proof/installed/`). Limits noted in `KIRO-WRITEUP.md` section 3: per-run time limit, one run lost to a gateway restart, "WIP: snapshot at rate limit (unverified)" commits. | `docs/PR-HISTORY.md`, `docs/SWIMLANES.md`, `docs/KIRO-LOG.md`, `git log` |

**TODO(owner):** a real Kiro IDE window capture (spec open, hook firing) and a Kiro Crew window capture (app installed, reviewer agent run). Until then no image in this repo may be described as a Kiro window.

## 7. Power and Crew app

- `kiro-power/`: `plugin.json`, `mcp.json`, `skills/stress-test-my-workflow/`.
- `kiro-crew-app/`: `app.json`, `agents/reviewer.json`, `skills/stress-test-my-workflow/`, a page that hosts the arena UI from 127.0.0.1.
- Both start the same stdio server, `packages/core/src/bin/haunt-mcp.ts`, with tools `haunt_define`, `haunt_sweep`, `haunt_ramp`, `haunt_report`, `haunt_specs`, `haunt_badge`.
- **Proven:** a stdio client started the server from the manifest command, ran `initialize` and `tools/list`, and got the tool list (`docs/proof/installed/mcp-handshake.json`, `docs/proof/installed/README.md`).
- **Not proven:** the Power imported into a Kiro IDE window, or the Crew app installed with `kirocrew app install ./kiro-crew-app`. No screenshot in the repo is a Kiro window. **TODO (owner):** install both and add captures.

## 7a. Spec-driven vs vibe coding

What the repo shows, by area:

| Mode | Where | Evidence |
|---|---|---|
| Spec first | `engine`, `harness`, `arena`: requirements, design and tasks existed before code. The first 14 commits are spec passes and "cold read" fixes. `harness/tasks.md` has 63 ticked and 1 open box; `arena` 38 and 1. | `docs/KIRO-LOG.md` ("2026-11-20: specs first"), `.kiro/specs/` |
| Spec from play-test notes | `playtest-v2`, `tournament-v3`, `packs`: written after the owner's play-tests, then built as `PT-*`, `TV3-*`, `PK-*` tasks. | `docs/KIRO-LOG.md`, `docs/DECISIONS.md` |
| Spec written by an agent | `hardening-loop-w1`: produced by the reviewer, 5 tasks, all ticked. | `.kiro/specs/hardening-loop-w1/`, `docs/proof/live-fix.md` |
| Unplanned fixes | Bugs found by tests or the validator and fixed in a PR without a spec: Phoenix sweep, journal reuse, 500+ validator violations, flaky tests (see section 8). | `docs/KIRO-LOG.md` |
| Drift | `haunted-house` (21 open boxes) was superseded; `tournament-v3/tasks.md` lags merged work; requirements have 0% PR or test links in `docs/TRACE.md`. | `.kiro/specs/`, `docs/TRACE.md` |

What the repo gives as a benefit of specs: PR titles carry task IDs, so `npm run trace` can link tasks to PRs (47 of 69 tasks, 68%). Acceptance table A in `engine/acceptance.md` served as the oracle that sweep tests were checked against, which is how the Retrier mismatch was caught (#78, #92).

What it does not give: a side-by-side build of one feature both ways, so no speed or defect-rate comparison is claimed. **TODO(owner):** pick one feature and record a vibe-coded attempt for comparison.

## 7b. Hooks as workflows

Five hooks, three kinds of trigger:

- **Guard on save (`runCommand`):** `pbt-on-sdk-save` and `fixtures-on-contract-save` run a test or `npm run validate:events` when SDK or contract files change. These guard the two seams that broke most: replay after a crash, and the core/visuals contract.
- **Bookkeeping on save (`runCommand`):** `trace-on-merge` runs `npm run trace` when a spec or test file changes, so `docs/TRACE.md` stays current. Its name says merge, its trigger is a file save.
- **Agent on save or demand (`askAgent`):** `lint-hardening-spec` has the agent run `spec-lint` on an edited hardening spec and fix the spec only; `reviewer-on-wave-end` (`userTriggered`) has the agent write the postmortem and hardening spec for the newest run. Together with the `reviewer` agent's path-limited `fs_write` and the rule that a spec is never auto-applied (`.kiro/steering/contract.md`), this is the loop in section 5.

Hook catch counts are not recorded: **TODO(owner).**

## 8. What Kiro did vs what a human decided

`docs/DECISIONS.md` records each ambiguity with its author. Rows tagged "Owner" or "Spec author" show who decided.

Human (owner) decisions:
- No tests in CI; local `npm test` is the merge gate (`.kiro/steering/tech.md`, `KIRO-LOG.md`).
- Scoring: a cancelled order costs -300, halt -400, downtime -2 per second capped at -300 per order ("Owner wants a big loss for a totally failed order"; "Owner: downtime is negative").
- Reviews as a Yelp-style rating with a 5/5, 6/10, 8/15 tracker ("Owner asked").
- Account stage comes before the order; packs get their own stage lists ("Owner: account must come before the order").
- Zero-issue runs are forbidden; a floor rule injects a gremlin ("Owner: something should always be happening").
- The Casebook, not the champion, is the true result ("Owner: the lessons are the winner").
- Apps: orders and delivery, inbox plus ticket managing; streaming is a Lab demo only ("Owner: which apps?").
- Wrong-order as a player decision ("Owner idea").
- Playtest notes became the `playtest-v2` and `tournament-v3` specs (`KIRO-LOG.md`).

Kiro (agent) decisions, logged in `docs/DECISIONS.md` under the lane that made them:
- The simulator is a pure lane planner checked against an answer table, not canned sequences (2026-11-20).
- Stage durations for the inbox, the 11-step order ledger kinds and durations, world-event windows (2026-11-20 to 2026-11-22).
- How the Python inbox became the Ticket Desk with in-process fakes whose faults fire before any provider call (2026-11-22).
- Lessons are a policy overlay, anything beyond becomes a fix spec ("Spec author").

Where Kiro was wrong and a human or a test caught it (`KIRO-LOG.md`, `KIRO-WRITEUP.md` section 11):
- First Phoenix sweep had 6 failed cells; root cause was a lost shipment id after restart (#59).
- Journals reused across waves (#50).
- Live stream with 500+ validator violations (#64, #74).
- A design example said -340 where the code gives -300 (#197).
- The first loop proof graded A for the wrong reason; ledger repeats were not attached to the report. Re-recorded after scoring v2 (#196).
- The property test (`packages/haunt/test/pbt-crash-point.test.ts`, fast-check, hook `pbt-on-sdk-save`) found a Phoenix crash at `mid_stage` of `updates` that replays to `failed` while effect counts stay right. At the time of `KIRO-LOG.md` it was documented and not fixed.

Limits of this attribution: `DECISIONS.md` rows say who decided, but the repo has no session transcripts, so the split between "Kiro proposed, owner accepted" and "owner dictated" is only as precise as those rows.

## 9. TODO placeholders for the owner

1. Recorded live fix (section 5): a real Kiro session applying a hardening spec, with transcript, diff and reports.
2. Which Kiro surface (IDE, CLI, Web, Crew) built which lane or task, and any Kiro Web use (section 6a), plus window captures.
3. Power import into the Kiro IDE and Crew app install, with screenshots (section 7).
4. A steering rule that visibly changed a Kiro answer (section 3).
5. Hook catch counts (section 4).
