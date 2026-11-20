# Dev setup and repo conventions

## Where to work (important)

The repo lives on a Synology NAS (`<local path, not the repo>`). **Do not build there.** `npm install` on the NAS breaks (no symlinks, slow). Each session works in its **own local clone** and pushes to GitHub. The NAS copy is a convenience and is only updated with `git pull`.

```
git clone https://github.com/kakoritz/Kiroween-Chaos.git C:\dev\Kiroween-Chaos-core      # Lane A
git clone https://github.com/kakoritz/Kiroween-Chaos.git C:\dev\Kiroween-Chaos-ui        # Lane B
```

(Any local, non-network path is fine.) The NAS copy trips git's "dubious ownership" check. Use `git -c safe.directory='*' ...` there, or just avoid it.

## Stack (decided, do not relitigate)

| Item | Choice |
|---|---|
| Node | 20 LTS |
| Language | TypeScript, strict mode |
| Package manager | npm workspaces |
| Tests | Vitest, `fast-check` for properties |
| Server | Node `http` plus a tiny router. No heavy framework. |
| Bundler | esbuild (bots and the browser worker bundle). `ajv` allowed as a dev dependency for schema validation. |
| Storage | JSONL files. **No SQLite, no native dependencies.** |
| UI build | Vite, vanilla TypeScript, Canvas 2D. A UI framework is allowed if Lane B wants one, but the bundle must be static and offline. |
| Python (App 2) | 3.12, standard library only |
| Lint and format | ESLint and Prettier defaults |
| CI | GitHub Actions: install, typecheck, test, validate fixtures, build UI |

## Layout

```
/
  .kiro/                       specs, steering, hooks, agents  (never gitignored)
  contract/                    CONTRACT.md, PROTOCOL.md, STORYBOARDS.md, events.schema.json, fixtures/
  docs/                        WINNING, SWIMLANES, DEV-SETUP, DEMO-SCRIPT, HANDOFF-*, KIRO-LOG, proof/
  packages/
    haunt/                     the skeleton: engine, SDK, parts, chaos director, reviewer, report, CLI
    core/                      HTTP server, mock server, provider, in-page transport
    arena-ui/                  the arena (Lane B)
  apps/
    haunted-orders/            App 1 (Node): src/bots/<tier>.ts, haunt.yaml (input orders are generated into the run folder)
    haunted-inbox/             App 2 (Python): bot/, helpdesk/, haunt.yaml, inbox/
  tools/                       make-fixtures.ts, validate-events.ts, fresh-clone-test
  package.json                 workspaces
```

## npm scripts (root)

| Script | Does |
|---|---|
| `npm run mock` | Mock server on 7070 (fixtures plus simulator) |
| `npm run live` | Live server on 7070 (real engine) |
| `npm run ui:dev` | Vite dev server on 5173, API at 7070 |
| `npm run ui:build` | Builds `packages/arena-ui/dist` |
| `npm run build:bots` | esbuild bundles `dist/bots/<tier>.js` |
| `npm run demo` | Builds if needed, starts the server (live if available, else mock) and opens the arena in demo mode. `npm run demo -- --check` starts, verifies and exits (used by fresh-clone) |
| `npm test` | All unit and property tests |
| `npm run test:contract` | Contract suite against the running server (mock and live) |
| `npm run validate:events` | Fixtures against `events.schema.json` and the ordering rules |
| `npm run haunt -- <cmd>` | The CLI (`sweep`, `ramp`, `report`, ...) |
| `npm run fresh-clone` | Runs `tools/fresh-clone-test`: clones to a temp folder, installs, runs `npm run demo -- --check`, must pass in under 3 min |

## Branches, PRs, merging

- Branch `core/<task-id>-<slug>` (Lane A) or `ui/<task-id>-<slug>` (Lane B). One PR per task. Task id in the title.
- `main` changes only by pull request. No direct commits.
- Non-contract PRs: the author merges after tests are green.
- Contract PRs (anything in `contract/`): label `contract`, and the **other lane's session approves in a PR comment** before merge.
- Rebase on `main` before opening a PR. Squash merge.
- Commit author: `kakoritz`. Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Do not use the name of any employer or company in this repo, docs, or commits. This is a personal project.

## Test policy

- Unit and property tests run freely.
- **Browser end to end tests:** one smoke spec only (the arena loads and a Chaos press shows a creature). Never run the full browser suite repeatedly. It loads the machine and slows the other session. Run it once before a PR that changes UI wiring, and in CI.
- Determinism: any test that depends on time uses the fake `Clock`.

## Secrets and network

No secrets exist. No real payment, no real keys. All servers bind `127.0.0.1`. The reviewer's optional LLM pass reads `ANTHROPIC_API_KEY` from the environment if present and is off otherwise. Never commit keys.

## Kiro artifacts that must exist by Dec 2

`.kiro/specs/` (all lanes), `.kiro/steering/` (product, tech, contract rules), `.kiro/hooks/` (3 hooks), `.kiro/agents/` (`chaos-director`, `reviewer`), `docs/KIRO-LOG.md`. See `docs/WINNING.md` for what each must show.

## Runtime folders

`./.haunt/runs/<run-id>/` holds events, reports and hardening specs (git-ignored). Journals and per-lane scratch live in `os.tmpdir()/haunt/<run-id>/`. See `.kiro/specs/engine/runtime.md` section 10.
