# Handoff: Lane A, Core

Paste the starter prompt at the bottom into the session. Everything else here is what that session should read.

## Your job

Build the engine and the Haunt harness: pipeline, provider, journal, SDK, tiers, chaos director, scoring, server, mock server, reports, reviewer, CLI, the two apps, the browser target, and the Kiro packaging. You do **not** build any UI. Lane B builds the arena against `contract/`.

## Read in this order (about 25 minutes)

1. `docs/WINNING.md` (why, rules, deadline)
2. `docs/SWIMLANES.md` (what you may touch) and `AGENTS.md`
3. `contract/CONTRACT.md`, `contract/PROTOCOL.md`, `contract/STORYBOARDS.md`
4. `.kiro/specs/engine/design.md` (the rules) and `.kiro/specs/engine/acceptance.md` (the answer key)
5. `.kiro/specs/harness/requirements.md` and `tasks.md` (your task list)
6. `.kiro/specs/inbox-app/design.md`
7. `docs/DEV-SETUP.md`

`.kiro/specs/haunted-house/` is the older first draft. `docs/SPEC-MAP.md` says which parts are superseded.

## Order of work

1. **H0 first, within 1 day.** Contract schema, fixtures generated from the storyboards, mock server with the acceptance-table simulator, `npm run mock`. Lane B is blocked until this lands. Tell Lane B when it merges (PR comment or issue labelled `lane-question`).
2. H1: provider, journal, SDK, five bot files, chaos director, runner, scoring, live server. Hero crash passing (A2).
3. H2: creature plugins, then the three bosses.
4. H3: `haunt.yaml`, sweep, stack, ramp, then the rest.
5. H4: report, grading, reviewer, hardening spec.
6. H6: browser target, Python app, MCP, agents, hooks, Power, Crew app, loop proof, KIRO-LOG.

Use the cut line in `.kiro/specs/harness/tasks.md`. At the end of Nov 29 anything unfinished and not on the "never cut" list is cut.

## Rules

- Follow `acceptance.md` exactly. If you believe it is wrong, open a PR that changes it and say why. Do not silently diverge.
- Never edit `packages/arena-ui/`.
- Contract changes: own PR, label `contract`, Lane B approves.
- Keep `docs/KIRO-LOG.md` current: one dated line per notable thing Kiro did well or badly.
- Use Kiro features as you go (specs per task, hooks, steering, MCP, property tests). The judges score this, and "insufficient Kiro use" is a disqualification.
- Report progress by ticking checkboxes in the tasks file and by PR titles. If blocked on a decision, add it to `docs/OPEN-ITEMS.md` and keep going with the stated default.

## Starter prompt

> You are Lane A (Core) on Kiroween-Chaos, a hackathon project with a hard deadline of Dec 4 2026 5pm EST. Clone https://github.com/kakoritz/Kiroween-Chaos to a local folder (not the NAS), then read `docs/HANDOFF-CORE.md` and follow its reading order. Start with task H0 in `.kiro/specs/harness/tasks.md`. Another session (Lane B) builds the UI against `contract/` and is waiting on your mock server, so ship H0 first and tell them when it merges. Work on branches `core/<task>`, one PR per task, never touch `packages/arena-ui/`. Follow `.kiro/specs/engine/acceptance.md` as the answer key. Keep `docs/KIRO-LOG.md` updated. Ask me only about things in `docs/OPEN-ITEMS.md` marked "needs the owner".
