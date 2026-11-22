# Tech steering

- Stack: TypeScript (strict) on Node 20 or newer, npm workspaces (`packages/*`, `apps/*`). The inbox app is Python 3.12, standard library only.
- Tests: Vitest 3.2.7 and fast-check 4.10.3. Tests run locally (`npm test`) and are the merge gate. CI is manual only and never runs tests (owner decision, see `docs/KIRO-LOG.md`). Do not add a test step to a workflow.
- Before a PR: `npm run typecheck`, `npm test`, `npm run validate:events`, `npm run ui:build`.
- Run TypeScript through `tools/run-ts.mjs`; do not add a second runner.
- Dependencies are pinned exactly in `package.json`. Do not add a dependency without a reason written in the PR.
- Servers bind `127.0.0.1` only. No real keys, no external network calls. The LLM reviewer pass is off unless the owner sets a key.
- Property tests use fast-check and check effect counts from the provider ledger, not from the bot.
- Scratch files go in `.tmp/` (git-ignored). Do not commit `.haunt/` run output except files copied into `docs/proof/`.
