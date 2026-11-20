# Swim lanes

Two sessions work in parallel. They meet only at `contract/`.

| | Lane A: Core | Lane B: Visuals |
|---|---|---|
| Owner | Session 1 (this one) | Session 2 (the second session session) |
| Folder | `packages/core/`, `packages/haunt/`, `apps/`, `tools/` | `packages/arena-ui/` |
| Builds | Chaos engine, SDK, bots, provider, journal, scoring, reviewer, stress-test reports, CLI, server | Race arena, sprites, creatures, stage inspector, rank board, report viewer, sound, demo mode |
| Specs | `.kiro/specs/haunted-house/`, `.kiro/specs/harness/` | `.kiro/specs/arena/` |
| Branch prefix | `core/` | `ui/` |
| May edit | Its own folders and `contract/` (with a contract PR) | Its own folders and `contract/` (with a contract PR) |
| Must not edit | `packages/arena-ui/` (except creating the empty workspace stub in task H0.9) | `packages/core/`, `packages/haunt/`, `apps/`, `tools/` |

## The seam: `contract/`

Everything the UI needs is in [contract/CONTRACT.md](../contract/CONTRACT.md): the event schema, the REST calls, the SSE stream, and recorded fixtures.

Rules:
1. The UI reads events and sends chaos commands. It never touches bots, journals or the ledger directly.
2. Core never imports UI code. Core serves the UI folder as static files and nothing more.
3. A change to `contract/` goes in its own PR, labelled `contract`, and needs the other lane's approval before merge.
4. Contract changes are additive. A removal or rename bumps `contractVersion` and needs both lanes to agree.
5. Core ships the mock server (`npm run mock`) in its first task, so Lane B is never blocked. It replays `contract/fixtures/*.jsonl` and accepts chaos commands.

## Hand-off order

1. Core publishes `contract/` v1, fixtures and the mock server. (Task H0, first.)
2. Visuals builds the full arena against the mock server.
3. Core builds the real engine behind the same contract.
4. Swap: the UI points at the real server by changing one URL. No UI change should be needed. If one is, the contract was wrong, so fix the contract.

## Git rules

- Work on a branch with your lane prefix. One PR per task. Never commit to `main` directly.
- Questions for the other lane go in the PR, or as an issue labelled `lane-question`.
- `main` always runs `npm run demo` (mock mode counts until the real engine lands).

## Ownership of files at the root

README, `docs/`, CI and `contract/` are shared. Edit through a PR the other lane can see.

## Working copies and merging (see docs/DEV-SETUP.md)

- Each session works in its **own local clone** (not the NAS) and pushes to GitHub.
- Non-contract PRs: the author merges after tests are green.
- Contract PRs (anything in `contract/`): label `contract`, and the other lane approves in a PR comment before merge.
- If a lane is blocked on the other, open an issue labelled `lane-question`, state exactly what is missing, and keep working on something else.
- Handoff guides: `docs/HANDOFF-CORE.md` and `docs/HANDOFF-VISUALS.md`.
