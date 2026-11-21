# Haunt (Kiroween-Chaos)

**Chaos engineering for automation and AI agents, played as a game.** Haunt hits a workflow with chaos creatures (crashes, timeouts, outages, duplicates, missing files) and gives you a graded stress test report. Five bots race through an order pipeline while you throw creatures at them.

**Hero moment:** a bot is killed right after charging a customer. The naive bot charges again. The protected bot finds its own charge and finishes. Same crash, side by side.

Kiroween 2026. Category: **Skeleton Crew**: one lean skeleton (the Haunt harness), two apps built on it. Also entering Best Kiro Crew App.

## Quick start

Requires Node 20 or newer. Python 3.12 (standard library only) is needed for the inbox app.

```
npm install
npm run typecheck
npm test
npm run build:bots
npm run haunt -- sweep --tier phoenix --orders 1 --speed 8
```

`npm test` runs all unit and property tests locally (about 15 seconds). The sweep runs one creature fault per pipeline stage against a built bot, prints the coverage matrix and a grade, and writes a JSON report to `.haunt/sweeps/`.

| Command | Does |
|---|---|
| `npm run build:bots` | Bundles the six bots (rookie, retrier, journaler, reconciler, phoenix, rookie.hardened) into `dist/bots/` |
| `npm run haunt -- sweep [--tier T] [--seed N] [--orders N] [--speed N]` | Graded sweep of one bot tier. Tiers: rookie, retrier, journaler, reconciler, phoenix |
| `npm run haunt -- ramp [--tier T]` | Ramp run that raises chaos until the bot breaks |
| `npm run live` | Live server on `127.0.0.1:7070` with the provider on `127.0.0.1:7071`. Add `-- --loop` to run the hardened Rookie from wave 2 |
| `npm run typecheck` | Strict TypeScript check |
| `npm test` | Vitest suite |

Servers bind to `127.0.0.1` only. Stop them with Ctrl+C.

## Not built yet

These scripts exist but report "not implemented" or are blocked: `npm run mock` (mock server, H0.7), `npm run validate:events` (H0.6), and `npm run ui:build` (arena UI, Lane B).

## How Kiro built this

Kiro drove the whole build from specs, not chat.

- **Specs** in [.kiro/specs/](.kiro/specs/) (engine, harness, inbox-app, haunted-house, arena). Each has requirements, design, tasks and an acceptance file that works as the answer key.
- **Steering** in [.kiro/steering/](.kiro/steering/) keeps every session on the same product rules.
- **Hooks** in [.kiro/hooks/](.kiro/hooks/) regenerate fixtures when the contract changes, run property tests when the SDK is saved, and run the reviewer at the end of a wave.
- **Agents** in [.kiro/agents/](.kiro/agents/): a chaos director that picks creatures and a reviewer that writes the fix spec after a failed wave.
- **Two lanes** (core and visuals) work in parallel against one contract, [contract/CONTRACT.md](contract/CONTRACT.md). Each task is one branch and one pull request, logged in [docs/KIRO-LOG.md](docs/KIRO-LOG.md).

## Layout

```
packages/haunt/          the skeleton: engine, SDK, CLI, reports
packages/core/           server, provider, contract implementation
packages/arena-ui/       the arena (Lane B)
apps/haunted-orders/     app 1, Node
apps/haunted-inbox/      app 2, Python
contract/                events schema, fixtures
.kiro/                   specs, steering, hooks, agents
```

## Mock server (for Lane B)

`npm run mock` starts the mock on `http://127.0.0.1:7070` (set `PORT` to change it). It needs no engine and no network.

- REST: every call of `contract/PROTOCOL.md` (state, wave start and stop, speed, chaos, chaos mode, demo, app, creatures, lane stage and log and orders, ledger, waves, reports, postmortem, hardening, compare). Errors are `{error:{code,message}}` with the codes from the protocol.
- SSE: `GET /api/events?since=<seq>`. First message is `hello`. `since` is exclusive. A `: ping` comment goes out every 15 s. `410 gone` when `since` is older than the last 5000 events. With no wave started, the first connection replays `calm`.
- Demo: `POST /api/demo/start {script}` accepts `hero`, `full`, `loop` or any fixture name (`calm`, `parked`, `boss-power`, `inbox`, ...).
- Waves: `POST /api/wave/start` scales a no-fault plan by `orders`, `lanes`, `tiers`, `pace` and `speed`. `POST /api/chaos` injects one fault on a running lane and answers with the outcome from `packages/core/mock/outcomes.json`. A boss fault sends `boss_warning`, then `boss_start`, one `chaos` per lane, and `boss_end`.
- Test hooks: `POST /_mock/reset`, and `POST /_mock/fault {kind: "drop_sse" | "gone" | "slow" | "version" | "unreachable"}` for transport error handling (`version` makes `hello` and health report one contract version higher, `unreachable` drops every `/api` request; `POST /_mock/reset` clears both).
- In-page transport: `packages/core/inpage-stub.js` defines `window.__haunt` with every function listed in PROTOCOL.md (`getState()`, `startWave(opts)`, `subscribe(fn, {since})`, ...). It forwards to the mock, so run `npm run mock` first. Set `window.__HAUNT_BASE__` before loading it to change the address. Errors reject with `{code, message}`.
- Not in the mock yet: random chaos mode (the mode is stored but nothing fires on its own), serving `packages/arena-ui/dist/`.

## Docs

- [docs/DEV-SETUP.md](docs/DEV-SETUP.md): setup and conventions
- [docs/SPEC-MAP.md](docs/SPEC-MAP.md): which document wins
- [docs/OPEN-ITEMS.md](docs/OPEN-ITEMS.md): decisions and what needs a human
- [docs/HANDOFF-CORE.md](docs/HANDOFF-CORE.md) and [docs/HANDOFF-VISUALS.md](docs/HANDOFF-VISUALS.md)
- [docs/WINNING.md](docs/WINNING.md), [docs/SWIMLANES.md](docs/SWIMLANES.md), [AGENTS.md](AGENTS.md), [docs/DEMO-SCRIPT.md](docs/DEMO-SCRIPT.md)

## License

MIT
