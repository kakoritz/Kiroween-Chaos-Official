# Kiro log

Dated notes on what Kiro did and decided while building Haunt. Newest last.

## 2026-11-20

- **CI policy override (owner decision, the owner).** No unit tests run in CI/CD for now. GitHub Actions does install, typecheck, `validate:events` and build only. Local `npm test` is the merge gate. Where `docs/DEV-SETUP.md`, `docs/SWIMLANES.md`, the task files or the acceptance doc say CI runs tests, that text is overridden by this entry. Never add `npm test`, vitest, `test:contract` or any test step to a workflow later.
- H0.9: scaffolding added (npm workspaces, strict TypeScript, Vitest, esbuild runner `tools/run-ts.mjs`, CI without tests, `.tmp/` ignored). `package.json` declares `engines.node >=20`; the dev machine runs Node 26, so only Node 20 compatible APIs are used. Vitest is pinned to 3.2.7 because Vitest 5 needs Node 22 or newer.
- H0.9: `packages/arena-ui/package.json` and `dist/index.html` are stubs, the one time Lane A touches that folder. `dist/` is git-ignored, so the stub is added with `git add -f`.
