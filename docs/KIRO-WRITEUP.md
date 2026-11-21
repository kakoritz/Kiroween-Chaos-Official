# Kiro write-up

How Kiro was used to build Haunt (Kiroween-Chaos), in the order of the hackathon rubric. Facts come from `docs/KIRO-LOG.md`, `.kiro/`, and the git history. Where a number or judgement can only come from the owner, the line says **Owner:** and is left open. Nothing here is invented.

## 1. Kiro IDE

Best at: spec-driven work in `.kiro/specs/` (requirements, design, tasks per area: engine, arena, campaign, onboarding, playtest-v2, share), and agent hooks that fire on file save.
Weak at: long multi-file tasks drifted from the task text unless the task named the exact file and acceptance row.
**Owner:** add one or two moments from the IDE and which tasks were done here.

## 2. Kiro CLI

Best at: scripted, repeatable runs. `haunt sweep`, `haunt ramp` and `haunt badge` are plain CLIs, so the same commands work from a terminal, a hook, an agent or a CI step. The reviewer has an optional `--llm` pass that uses the Kiro CLI when it is configured and falls back to the rule-based reviewer when it is not.
**Owner:** state where the CLI was used for build work.

## 3. Web and Kiro Crew

Best at: running several lanes of work in parallel (core engine, arena UI, campaign, share features) as separate branches with one PR per task, merged only after the local gates passed (typecheck, `npm test`, `ui:build`, `validate:events`).
Weak at: long runs hit the per-run time limit and had to be relaunched; one run was lost to a gateway restart with only a partial result saved.
**Owner:** confirm wording and add the Crew app screenshot reference (SH-K3).

## 4. Custom agents

- `chaos-director` runs sweeps and never edits bots.
- `reviewer` reads a run log and writes `postmortem.md` plus a hardening spec under `.kiro/specs/hardening-<run>/`. Its write access is limited by path to hardening specs, `.haunt/runs/` and `.tmp/`, and it has read-only tools otherwise. It never changes source. Its output is handed to a developer agent.

Benefit that was measured: the loop proof. The reviewer's hardening spec for wave 1 listed findings F1 to F5, and the hardened Rookie in wave 2 resolved all five (see `docs/proof/loop-proof.md`). The fix in that proof is labelled **recorded**, not live.

## 5. Hooks

| Hook | Trigger | What it gave us |
|---|---|---|
| `pbt-on-sdk-save` | save in `packages/haunt/src/sdk/` | runs the crash-point property test on every SDK edit, so a regression in replay shows up at save time |
| `fixtures-on-contract-save` | save in `contract/` or `fixtures/` | runs `npm run validate:events`, so a schema or fixture mismatch is caught before a PR |
| `reviewer-on-wave-end` | manual trigger | asks the reviewer agent for a postmortem and hardening spec after a wave |

Measured benefit: the property test and the validator are the two checks that found real bugs (sections 8 and 11). **Owner:** add a count of times each hook caught something if you have it.

## 6. Spec-driven development vs vibe coding

What the repo shows: 144 task boxes ticked and 52 open across the spec folders, 84 test files in `packages/haunt/test` and `packages/core/test` combined, and every PR names the task ID it implements, so any line of behaviour traces back to a requirement.
What it does not show: a side-by-side build of one feature both ways. **Owner:** pick one feature, build or describe the vibe-coded version, and fill in tasks, tests and defects for both. Until then this section makes no comparison claim.

## 7. Steering

`.kiro/steering/product.md` is the only steering file today. Rules in it that changed behaviour:

- "Everything the UI shows is driven by a contract event. No fake animation." The mock server and the in-page mock are built around the event stream.
- "No real money, no real keys, no external network calls." Every server binds 127.0.0.1 only.
- "Keep the hero demo working at all times." Fix `npm run demo` first.
- "Keep `docs/KIRO-LOG.md` current."

`tech.md`, `contract.md` and `art.md` are planned in the share spec and not added yet.

## 8. MCP

`haunt-mcp` (`packages/haunt/src/mcp`) is a stdio MCP server with `haunt_define`, `haunt_sweep`, `haunt_ramp`, `haunt_report` and `haunt_badge`. It made one thing possible that the CLI alone did not: a Kiro agent can run a sweep on a new workflow, read the matrix and patch the code in one conversation. The scripted version of that scene is SH-K4.

## 9. Property-based testing

`packages/haunt/test/pbt-crash-point.test.ts` uses fast-check 4.10.3 to kill the bot at every hook call. Effect counts for Phoenix stayed at 1 each. It found a real bug: a Phoenix crash at `mid_stage` of the `updates` stage (hook call 20, seed 7) replayed to result `failed` instead of `done`, while effect counts were still correct. The log notes it was not fixed in that PR and the result was not asserted. **Owner:** paste the shrunk counterexample from a fresh run and say whether it was fixed since.

## 10. Powers

**Owner / SH-K3:** the Kiro Power is not yet installed and shown working. Nothing is claimed here until it is.

## 11. What Kiro got wrong

From the log, in plain words:

- **Wrong sweep outcomes first time.** The Phoenix sweep had 6 FAILED cells where the acceptance doc says zero. Root cause: after a restart the pipeline lost the journaled shipment id, so tracking polled an empty id and got a 404. Fixed at the root (H3.2).
- **Stale reused state.** A second wave on the same server ran no lanes, because wave 1 journals were reused. Fixed by giving each wave its own folder and a provider reset.
- **Event detail fields missing.** The first live stream failed the validator with over 500 violations. Fixed in a normalizer (`normalize.ts`) and revalidated at 0 violations.
- **Overstated proof.** Early live waves graded A because ledger repeats were not attached to the report yet. The saved loop proof then showed wave 2 at C, not A, because one Phoenix order was lost in both waves. This is why SH-C4 requires a real, verified proof.
- **A wrong number in a design doc.** The playtest-v2 worked example said -340 where the scoring code gives -300. Fixed against `reviewReward`.
- **Reported work that was not done.** At least one run summary described a merge that had not happened, because the command waited on an approval prompt. State was checked in git afterwards.
- **Log style.** `docs/KIRO-LOG.md` drifted into PR bookkeeping. The candid digest at the top of that file replaces it for readers.

## 12. Five moments for the Devpost text

1. A bot crashes right after charging, restarts, and charges again. Rookie 2 charges, Phoenix 1.
2. The property test finds a crash at `mid_stage` that ordinary tests missed.
3. The first live stream fails the validator with 500+ violations, then 0 after one normalizer.
4. Wave 1 grades F; the reviewer's hardening spec resolves F1 to F5; wave 2 improves.
5. The proof was found to overstate its result (C, not A) and the claim was corrected.
