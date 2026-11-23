# Dev setup and repo conventions

## Quick start

Needs Node 20 or newer (Python 3.12 for the Ticket Desk, standard library only).

```
git clone https://github.com/kakoritz/Kiroween-Chaos.git
cd Kiroween-Chaos
npm ci
npm run demo
```

Work on a **local disk**, not a network share: `npm ci` needs symlinks and many small files, and the live server writes JSONL under `.haunt/`. Several sessions can work side by side in separate clones or `git worktree`s, each on its own ports (below).

Ports: the live server uses 7070 and the provider 7071. If something else holds them, set `HAUNT_PORT` and `HAUNT_PROVIDER_PORT` (for example `17070` and `17071`). `npm run demo -- --check` and `npm run validate:live` pick free ports themselves.

The CLI is `npm run haunt -- <command>`. There is no `haunt` binary and `npx haunt` does not exist.

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
| `npm run build:bots` | esbuild bundles `dist/bots/<tier>.js` (Rookie to Phoenix, the campaign Crew, the hero demo bundles). Needed once before the live server or `npm run e2e`: the live lanes spawn these bundles |
| `npm run e2e` | End-to-end smoke (`tools/e2e.mjs`): starts the live server on private ports (default 7171 and 7172, `HAUNT_PORT` and `HAUNT_PROVIDER_PORT` override), plays the hero demo wave, campaign night 1, a tournament at speed 4 pressing Next between rounds, the improve loop and an app switch to the inbox, then checks invariants on the event stream and prints a pass/fail table. About 6 to 10 minutes. Hardening specs the run writes under `.kiro/specs/` are removed afterwards (never applied). `-- --quick` skips the improve loop. Exit code 1 on any failure; the event stream is kept in `.tmp/e2e/events.jsonl` |
| `npm run demo` | Builds if needed, starts the server (live if available, else mock) and opens the arena in demo mode. `npm run demo -- --check` starts, verifies and exits (used by fresh-clone) |
| `npm test` | All unit and property tests |
| `npm run test:contract` | Contract suite against the running server (mock and live) |
| `npm run validate:events` | Fixtures against `events.schema.json` and the ordering rules |
| `npm run validate:live` | Starts the live server on free ports, plays the hero demo, a wave, a campaign night and an inbox wave at speed 4, and checks the whole event stream against the contract rules. About 2.5 minutes, prints violations by rule, exit 1 on any. `-- --keep-log` keeps the stream in `.tmp/validate-live/events.jsonl` |
| `npm run build:hosted` | Arena build plus `dist/hosted` (static, about 4 MB, recorded runs included) |
| `npm run serve:hosted [port]` | Serves `dist/hosted` on `127.0.0.1` (default 8080; add `--base=/Kiroween-Chaos/` to test a sub path) |
| `npm run check:hosted` | Headless Chrome check of the hosted build, screenshots to `docs/proof/hosted` |
| `npm run verify` | typecheck, vitest, build:bots, ui:build and `demo --check` in one command; `-- --quick` skips the demo check. Reruns failed test files alone and says `flake` if they pass. The script is in PR #253; once merged it is in every clone |
| `npm run haunt -- <cmd>` | The CLI: `sweep`, `ramp`, `stack`, `soak`, `boss`, `compare`, `badge`, `improve`, `spec-lint`, `monkey`, `stop`. A default `sweep` takes more than 5 minutes (about 5 with `--orders 1 --speed 16`). `ramp --tier phoenix --orders 4 --steps 1,2 --speed 16 --no-gate` takes about 12 s. `improve` needs a running live server (`--url`) and takes more than 8 minutes until the deterministic version merges |
| `npm run haunt -- monkey --mode observe\|staging\|prod-guarded [--dry-run] [--config file.yaml]` | The guarded production monkey. `--dry-run` prints the plan. `prod-guarded` needs `--config` with a schedule window and allowlist. `npm run haunt -- stop --port N` is the kill switch. See `docs/PRODUCTION-MODE.md` |
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
npm run verify                 # the five checks below in one command (PR #253), reruns flaky files alone
# or by hand:
npx tsc --noEmit
npx vitest run                 # a worker timeout under load is a known flake, rerun that file alone
npm run build:bots
npm run ui:build
npm run demo -- --check
npm run validate:live          # optional, about 2.5 minutes, must print 0 violations
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

## Kiro artifacts that must stay in the repo

`.kiro/specs/` (all lanes), `.kiro/steering/` (product, tech, contract rules), `.kiro/hooks/` (5 hooks: validate fixtures on contract save, lint hardening specs, property test on SDK save, reviewer at wave end, trace on merge), `.kiro/agents/` (`chaos-director`, `reviewer`), `docs/KIRO-LOG.md`. `.kiro/` is never gitignored.

## Runtime folders

`./.haunt/runs/<run-id>/` holds events, reports and hardening specs (git-ignored). Journals and per-lane scratch live in `os.tmpdir()/haunt/<run-id>/`. See `.kiro/specs/engine/runtime.md` section 10.
