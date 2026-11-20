# Agent rules

Two sessions work on this repo. Read `docs/SWIMLANES.md` before touching anything.

- **Lane A, Core:** `packages/core`, `packages/haunt`, `apps/`, `tools/`. Specs: `.kiro/specs/haunted-house/`, `.kiro/specs/harness/`.
- **Lane B, Visuals:** `packages/arena-ui`. Spec: `.kiro/specs/arena/`.
- The seam is `contract/CONTRACT.md`. Build against the mock server first.
- Never edit the other lane's folders. Never commit to `main`.
- Branch `core/<task>` or `ui/<task>`. One PR per task. Name the task id in the PR title.
- Contract changes go in their own PR with the `contract` label and need the other lane's approval.
- Never apply a hardening spec automatically. It becomes a normal task.
- No real money, keys or external network calls. Sound and graphics are generated in code.
