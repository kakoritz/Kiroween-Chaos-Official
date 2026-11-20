# Haunt (Kiroween-Chaos)

**Chaos engineering for automation and AI agents, played as a game.** Haunt hits a workflow with chaos monkeys (crashes, timeouts, outages, duplicates, missing files) and gives you a graded stress test report. Five bots race through an order pipeline in the Arena while you throw monkeys at them.

**Hero moment:** a bot is killed right after charging a customer. The naive bot charges again. The protected bot finds its own charge and finishes. Same crash, side by side.

Kiroween 2026. Category: **Skeleton Crew** (one reusable skeleton, two apps). Also entering Best Kiro Crew App.

## Read first

- [docs/WINNING.md](docs/WINNING.md): rules, rubric, checklist, timeline
- [docs/SWIMLANES.md](docs/SWIMLANES.md) and [AGENTS.md](AGENTS.md): who builds what
- [contract/CONTRACT.md](contract/CONTRACT.md): the seam between lanes
- [docs/DEMO-SCRIPT.md](docs/DEMO-SCRIPT.md): the 3-minute video

## Specs

| Lane | Spec |
|---|---|
| A Core | [haunted-house](.kiro/specs/haunted-house/), [harness](.kiro/specs/harness/) |
| B Visuals | [arena](.kiro/specs/arena/) |

## Layout (target)

```
packages/haunt/          the skeleton: engine, SDK, CLI, reports
packages/core/           server, mock server, contract implementation
packages/arena-ui/       the arena (Lane B)
apps/haunted-orders/     app 1, Node
apps/haunted-inbox/      app 2, Python
contract/                events schema, fixtures
.kiro/                   specs, steering, hooks, agents (never ignored)
```

## Status

Spec complete. Build not started. First task: H0 (contract schema, fixtures, mock server).

## License

MIT
