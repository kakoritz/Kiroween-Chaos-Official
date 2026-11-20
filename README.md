# Kiroween-Chaos

**Haunt**: chaos engineering for automation workflows, with a score. Plug in any process, define it, and Haunt hits it with chaos monkeys (crashes, timeouts, outages, duplicates, missing files) and gives you a graded stress test report. The **Arena** is the game view: five bots race through an order pipeline while you throw monkeys at them.

**Hero demo:** an order bot crashes right after charging a customer. It restarts and finishes the order. The customer is charged once. A naive bot with the same crash charges twice.

Hackathon: Kiroween. Category: Resurrection.

## Two lanes

Read [docs/SWIMLANES.md](docs/SWIMLANES.md) and [AGENTS.md](AGENTS.md) first.

| Lane | Folder | Spec |
|---|---|---|
| A Core | `packages/core`, `packages/haunt`, `packages/bots` | [haunted-house](.kiro/specs/haunted-house/), [harness](.kiro/specs/harness/) |
| B Visuals | `packages/arena-ui` | [arena](.kiro/specs/arena/) |
| Seam | `contract/` | [CONTRACT.md](contract/CONTRACT.md) |

## Status

Specs written. Build not started. First task: H0, contract schema, fixtures and mock server, so the visuals lane can start.
