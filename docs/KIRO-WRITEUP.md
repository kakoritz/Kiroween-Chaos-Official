# Kiro write-up (SH-K2)

How Kiro was used to build Kiroween Chaos (Kiroween-Chaos), in the order of the hackathon rubric. Facts come from the repo, `docs/KIRO-LOG.md`, `docs/KIRO-LOG-ARCHIVE.md` (the old per-task notes), `.kiro/`, and the git and PR history. Lines marked **Owner** can only come from the person who drove the sessions. Nothing here is invented.

## Measured numbers (2026-11-23, `main`)

| Measure | Value | How it was measured |
|---|---|---|
| Spec folders and files | 12 folders, 30 files in `.kiro/specs/` | `find .kiro/specs -type f` |
| Task boxes | 174 ticked, 61 open across 10 `tasks.md` files | count of `[x]` and `[ ]` (boxes lag some merged TV3 work) |
| Tests | 1,434 tests in 157 files | `npx vitest run`; one run gave 1,432 passed, 1 failed (worker RPC timeout while the suite ran under load), 1 todo. Which test failed was not checked |
| Pull requests (original repo) | 256 listed, 248 merged | `docs/PR-HISTORY.md` |
| Commits in this repo | 50 (imported history), 2026-11-20 to 2026-11-23 | `git log` |
| Hooks, agents, steering files | 5, 2, 4 | `.kiro/hooks`, `.kiro/agents`, `.kiro/steering` |
| MCP tools | 6: `haunt_define`, `haunt_sweep`, `haunt_ramp`, `haunt_report`, `haunt_specs`, `haunt_badge` | handshake in `docs/proof/installed/mcp-handshake.json` |

## 1. Kiro IDE

Best at: spec-driven work in `.kiro/specs/` (requirements, design, tasks per area) and agent hooks that fire on file save.
Weak at: long multi-file tasks drifted from the task text unless the task named the exact file and acceptance row.
Hooks and steering are the IDE-side features the repo actually contains (`.kiro/hooks/*.kiro.hook`, `.kiro/steering/*.md`). **TODO(owner):** a real Kiro IDE window capture and one or two IDE moments with the tasks done there.

## 2. Kiro CLI

Best at: repeatable runs. `haunt sweep`, `haunt ramp`, `haunt badge` and `haunt spec-lint` are plain CLIs, so the same command works from a terminal, a hook, an agent or a CI step. The reviewer has an optional `--llm` pass that uses the Kiro CLI when configured and falls back to the rule-based reviewer.
The agent files in `.kiro/agents/` use the Kiro agent format, so the same agents load from the CLI. **TODO(owner):** state where the CLI was used for build work.

## 3. Web and Kiro Crew

Best at: parallel lanes of work (core, arena UI, campaign, share, tournament) as separate branches, one PR per task, merged after local gates (typecheck, `npm test`, `ui:build`, `validate:events`).
Weak at: long runs hit the per-run time limit and had to be relaunched; one run was lost to a gateway restart with only a partial result saved. Two flaky tests under load needed fixes afterwards (PRs #175 and #203).
Kiro Web: **TODO(owner)**, no file in the repo records its use. **TODO(owner):** a Kiro Crew window capture (see section 10). The summary of roles per surface is in `HOW-KIRO-BUILT-THIS.md` section 6a.

## 4. Custom agents

- `chaos-director` runs sweeps and never edits bots. It loads `product.md`, `engine/design.md` and `engine/acceptance.md` as `resources`, and can write only under `.tmp/` and `.haunt/`.
- `reviewer` (tools `fs_read`, `fs_write`; only `fs_read` is pre-approved, so every write asks) reads a run log and writes `postmortem.md` plus a hardening spec under `.kiro/specs/hardening-<run>/`. Write access is limited by path to hardening specs, `.haunt/runs/` and `.tmp/`; it has no code-edit path.

Measured benefit: in the loop proof the reviewer's hardening spec for wave 1 listed findings F1 to F5 and the hardened Rookie resolved all five (`docs/proof/loop-proof.md`). The fix file is **recorded**, not applied live by Kiro. Since then the pattern miner and spec writer (TV3-C11, C12) produce the spec; a sample is in `docs/proof/sample-hardening-spec/`.

## 5. Hooks

| Hook | Trigger | What it gave us |
|---|---|---|
| `pbt-on-sdk-save` | save in `packages/haunt/src/sdk/` | runs the crash-point property test on every SDK edit |
| `fixtures-on-contract-save` | save in `contract/` or `fixtures/` | runs `npm run validate:events` so schema and fixture drift shows at save |
| `trace-on-merge` | save of a spec or test file | regenerates `docs/TRACE.md` |
| `lint-hardening-spec` | save of a hardening spec file | asks the agent to run `haunt spec-lint` and fix the spec only |
| `reviewer-on-wave-end` | manual | asks the reviewer agent for a postmortem and hardening spec |

The five hooks form three workflows: checks on save (`pbt-on-sdk-save`, `fixtures-on-contract-save`), bookkeeping on save (`trace-on-merge`), and agent steps (`lint-hardening-spec`, `reviewer-on-wave-end`). Details in `HOW-KIRO-BUILT-THIS.md` section 7b.

Measured benefit: the property test and the event validator are the two checks that found real bugs (sections 9 and 11). **Owner:** add a count of times each hook caught something.

## 6. Spec-driven development vs vibe coding

What the repo shows: 16 spec folders, 250 ticked tasks, and every PR title names the task ID it implements (for example `TV3-C7: tournament engine`), so behaviour traces to a requirement. `docs/TRACE.md` is generated from the specs and the git log.
Drift is also on record: `haunted-house` (21 open boxes) was superseded, `tournament-v3/tasks.md` lags merged work, and requirement IDs have 0% PR or test links in `docs/TRACE.md`. Several bugs (section 11) were fixed in unplanned PRs without a spec. The table by area is in `HOW-KIRO-BUILT-THIS.md` section 7a.
What it does not show: a side-by-side build of one feature both ways. **TODO(owner):** pick one feature, describe a vibe-coded version, and fill in tasks, tests and defects for both. Until then this section makes no comparison claim.

## 7. Steering

Four files in `.kiro/steering/`:

- `product.md`: "Everything the UI shows is driven by a contract event. No fake animation." and "No real money, no real keys, no external network calls." The mock server and the browser build were built around the first rule; every server binds 127.0.0.1 because of the second.
- `tech.md`: stack, pinned dependencies, and the rule that tests run locally and never in CI.
- `contract.md`: the core and visuals seam, labelled contract PRs, one PR per task.
- `art.md`: code-drawn art, CC0 only for minor props, no AI-generated assets.

`tech.md`, `contract.md` and `art.md` were added late (SH-K5), so they documented existing rules rather than changing earlier behaviour. **Owner:** if a steering rule changed a Kiro answer in a session, add it here.

## 8. MCP

`haunt-mcp` (`packages/haunt/src/mcp`) is a stdio MCP server with the five tools above. A stdio client started it from the Power and Crew manifests and listed the tools (`docs/proof/installed/`). The intended use is a Kiro agent running a sweep on a new workflow, reading the matrix and patching the code in one conversation. That scene (SH-K4) is **not recorded yet**.

## 9. Property-based testing

`packages/haunt/test/pbt-crash-point.test.ts` uses fast-check 4.10.3 to kill the bot at every hook call (60 runs). Effect counts for Phoenix stay at 1 each. It surfaced a real bug: a Phoenix crash at `mid_stage` of the `updates` stage (hook call 20, seed 7) replays to result `failed` instead of `done` while effect counts stay correct. The test carries a "Known bug" comment and asserts counts only. As of this branch the bug is documented and **not fixed**. **Owner:** paste a fresh shrunk counterexample if wanted.

## 10. Powers

The Power in `kiro-power/` and the Crew app in `kiro-crew-app/` start the same MCP server; the handshake is proved by a script. **Not done:** importing the Power into the Kiro IDE and installing the Crew app (`kirocrew app install`). No screenshot in the repo is a Kiro IDE or Kiro Crew window, and none may be described as one.

## 11. What Kiro got wrong

- **Wrong sweep outcomes first time.** The first Phoenix sweep had 6 FAILED cells where the acceptance file says zero. After a restart the pipeline lost the journaled shipment id, so tracking polled an empty id and got a 404. Fixed at the root (PR #59).
- **Stale reused state.** A second wave on the same server ran no lanes because wave 1 journals were reused. Fixed with a folder per wave and a provider reset (PR #50).
- **Event fields missing.** The first live stream failed the validator with over 500 violations. A normalizer took it to 0 (PRs #64, #74).
- **Overstated proof.** Early live waves graded A because ledger repeats were not attached to the report. The saved loop proof then showed C, not A, because one Phoenix order was lost in both waves. This is why SH-C4 asks for a real proof, and why the F to A recording is labelled "recorded fix".
- **A wrong number in a design doc.** A playtest-v2 example said -340 where the scoring code gives -300 (PR #197).
- **Reported work that was not done.** At least one run summary described a merge that had not happened because the command waited on an approval prompt. State was checked in git afterwards.
- **Flaky tests under load.** The rookie end-to-end bot test and the haunt adapters test failed under load and needed fixes (PRs #175, #203). The full suite still showed one timeout failure on the last run in this write-up.
- **Log style.** The per-task log became PR bookkeeping. It is now `docs/KIRO-LOG-ARCHIVE.md`, and `docs/KIRO-LOG.md` holds the notes.

## 12. Five moments worth telling

1. A bot crashes right after charging, restarts, and charges again. Rookie 2 charges, Phoenix 1.
2. The property test finds a crash at `mid_stage` of `updates` that ordinary tests missed.
3. The first live stream fails the validator with 500+ violations, then 0 after one normalizer.
4. The first loop proof said A, the evidence said C, and the claim was corrected.
5. A game round ends in a lint-checked fix spec instead of a score.
