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
| CI | GitHub Actions: install, typecheck, validate fixtures, build. **No tests in CI** (owner decision, see `docs/KIRO-LOG.md`). Unit tests run locally. |

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
    haunted-inbox/             App 2 (Python): bot/, haunt.yaml (uses the shared provider; inputs generated into the run folder)
  tools/                       make-fixtures.ts, validate-events.ts, e2e.mjs, fresh-clone.mjs, build and demo scripts
  package.json                 workspaces
```

## npm scripts (root)

| Script | Does |
|---|---|
| `npm run mock` | Mock server on 7070 (fixtures plus simulator) |
| `npm run live` | Live server on 7070 (real engine) and the fake provider on 7071. `HAUNT_PORT` and `HAUNT_PROVIDER_PORT` move both, so a second server can run beside the first |
| `npm run ui:dev` | Vite dev server on 5173, API at 7070 |
| `npm run ui:build` | Builds `packages/arena-ui/dist` |
| `npm run build:bots` | esbuild bundles `dist/bots/<tier>.js` (Rookie to Phoenix, the campaign Crew, the hero demo bundles) |
| `npm run build:bots` | (listed above) Needed once before the live server or `npm run e2e`: the live lanes spawn `dist/bots/<tier>.js` |
| `npm run e2e` | End-to-end smoke (`tools/e2e.mjs`): starts the live server on private ports (default 7171 and 7172, `HAUNT_PORT` and `HAUNT_PROVIDER_PORT` override), plays the hero demo wave, campaign night 1, a 4-round tournament at speed 4 pressing Next, the improve loop and an app switch to the inbox, then checks invariants on the event stream and prints a pass/fail table. About 6 to 10 minutes. `-- --quick` skips the improve loop. Exit code 1 on any failure; the event stream is kept in `.tmp/e2e/events.jsonl` |
| `npm run demo` | Builds if needed, starts the server (live if available, else mock) and opens the arena in demo mode. `npm run demo -- --check` starts, verifies and exits (used by fresh-clone) |
| `npm test` | All unit and property tests |
| `npm run test:contract` | Contract suite against the running server (mock and live) |
| `npm run validate:events` | Fixtures against `events.schema.json` and the ordering rules |
| `npm run haunt -- <cmd>` | The CLI (`sweep`, `ramp`, `report`, ...) |
| `npm run fresh-clone` | Runs `tools/fresh-clone-test`: clones to a temp folder, installs, runs `npm run demo -- --check`, must pass in under 3 min |

## The product today, in one page

- **Orders app (Node):** an 11-stage pipeline: account, create, submit, payment, confirmation, receive, process, updates, ship, transit, handoff. Stage lists are data (contract V1_2 section 1); the arena reads them from `hello` and `GET /api/state`.
- **Five parts:** Lantern (retry, R), Spellbook (journal, J), Seal (idempotency, I), Shield (breaker, B), Coffin Stash (offline queue, Q). The five tiers, Rookie to Phoenix, wear more of them each; the campaign Crew wears whichever the player chose (`HAUNT_PARTS`).
- **Intensity dial:** 1 to 11 (`POST /api/intensity`), with an optional auto-ramp. 11 is THROW EVERYTHING. A lane with no issue by the middle of a round gets a gremlin, so no lane has a quiet round.
- **Tournament:** `POST /api/tournament/start` plays rounds of 5, 4, 3, 2 lanes; `POST /api/next` starts the next round; the weakest lane falls and stays as a corpse. Lessons carry over, the Casebook lists every edge case, and curses (`POST /api/curse`) follow one endpoint of one lane.
- **Patterns, fix specs, improve loop:** every round is mined into `.haunt/patterns.json`; `POST /api/specs` writes a hardening spec; `POST /api/improve` runs the plan, applies the cheap fixes as policy overlays, reruns the same seed and compares. Nothing applies code.
- **Inbox app (Python):** `POST /api/app {"app": "inbox"}` swaps the arena to the Ticket Desk flow (`apps/haunted-inbox/haunt.yaml`) with the same skeleton and the same ledger.
- **Campaign (Haunted Nights):** `GET /api/campaign`, `POST /api/wave/start {"campaign": {"night": N, "parts": [...]}}`, seven nights with medals, a gear shop and a sandbox. Data in `packages/core/campaign/`. The Casebook of the night comes back on `GET /api/casebook` after the wave.

## Checking everything before a PR

```
npx tsc --noEmit
npx vitest run                 # about 1,500 tests; a worker timeout under load is a known flake, rerun that file alone
npm run build:bots
npm run ui:build
HAUNT_PROVIDER_PORT=7172 npm run demo -- --check
npm run e2e                    # optional, 6 to 10 minutes, starts its own server on 7171 and 7172
```

## Branches, PRs, merging

- Branch `core/<task-id>-<slug>` (Lane A) or `ui/<task-id>-<slug>` (Lane B). One PR per task. Task id in the title.
- `main` changes only by pull request. No direct commits.
- Non-contract PRs: the author merges after the local gate is green (typecheck, `npm test`, `npm run validate:events`). CI does not run tests.
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

`.kiro/specs/` (all lanes), `.kiro/steering/` (product, tech, contract rules), `.kiro/hooks/` (5 hooks: validate fixtures on contract save, lint hardening specs, property test on SDK save, reviewer at wave end, trace on merge), `.kiro/agents/` (`chaos-director`, `reviewer`), `docs/KIRO-LOG.md`. See `docs/WINNING.md` for what each must show.

## Runtime folders

`./.haunt/runs/<run-id>/` holds events, reports and hardening specs (git-ignored). Journals and per-lane scratch live in `os.tmpdir()/haunt/<run-id>/`. See `.kiro/specs/engine/runtime.md` section 10.
