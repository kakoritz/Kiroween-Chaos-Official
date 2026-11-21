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

## Docs

- [docs/DEV-SETUP.md](docs/DEV-SETUP.md): setup and conventions
- [docs/SPEC-MAP.md](docs/SPEC-MAP.md): which document wins
- [docs/OPEN-ITEMS.md](docs/OPEN-ITEMS.md): decisions and what needs a human
- [docs/HANDOFF-CORE.md](docs/HANDOFF-CORE.md) and [docs/HANDOFF-VISUALS.md](docs/HANDOFF-VISUALS.md)
- [docs/WINNING.md](docs/WINNING.md), [docs/SWIMLANES.md](docs/SWIMLANES.md), [AGENTS.md](AGENTS.md), [docs/DEMO-SCRIPT.md](docs/DEMO-SCRIPT.md)

## License

MIT
