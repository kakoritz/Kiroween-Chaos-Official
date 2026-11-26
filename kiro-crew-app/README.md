# Kiroween Chaos for Kiro Crew

Chaos engineering for AI agents, as a Kiro Crew app. Describe a workflow from reusable blocks, test each block alone, test the chain, and see **which block broke it**. Then hand the result to a reviewer agent that writes a fix spec. It never edits your code.

The full game has three apps built in (Orders, Ticket Desk, Stream) and takes any app from a config file. Published on its own at [kakoritz/kiroween-chaos-crew](https://github.com/kakoritz/kiroween-chaos-crew). Part of [Kiroween Chaos](https://github.com/kakoritz/Kiroween-Chaos-Official), a Kiroween 2026 entry (Skeleton Crew). This app was made during the hackathon period and runs **on its own**: one bundled server, no checkout, no `npm install`.

## What you get

| Part | What it does |
|---|---|
| MCP server `haunt` (`server/haunt-mcp.mjs`) | `haunt_blocks`, `haunt_chain`, `haunt_lab`, `haunt_define`, `haunt_report`, `haunt_specs`, `haunt_badge`, and `haunt_sweep` and `haunt_ramp` (real runs, need a checkout) |
| Skill `build-and-test-a-chain` | Pick blocks, test each alone at a tier, test the chain, read the blame table and the warnings |
| Skill `stress-test-my-workflow` | Grade a `haunt.yaml`, find the failing stage, hand it to the reviewer |
| Agent `reviewer` | Reads a result, writes a postmortem and `.kiro/specs/hardening-<run>/`. It can write only to those paths |
| Page `/apps/haunt` | The Chain Wizard, a static page: add blocks, order them, edit the `haunt.yaml`, press Test chain |

Results from `haunt_blocks`, `haunt_chain`, `haunt_lab` and the page are **model-based what-ifs**: the same rules as the full game applied to the protections a tier has. They do not run your code. They say so.

## Install

```bash
kirocrew app install ./kiro-crew-app     # asks you to trust the folder (it is third-party code)
kirocrew app enable haunt
```

Run those yourself in your own terminal. Nothing installs or enables itself, and the network permission is off.

## Try it

Ask Kiro Crew:

> Build a chain for a coffee shop (read the order, take payment, brew, tell the customer), test each block alone, test the chain, and tell me which block is the weak one.

Or call the tools directly:

```json
{ "name": "haunt_chain", "arguments": { "blocks": ["read_request", "charge", "wait_for_callback", "notify"], "tier": "rookie" } }
```

Result: a grade, a table of which stage and block caused which share of the failures, and warnings such as "`wait_for_callback` waits right after the effect in `charge`; a crash while waiting must not redo that effect".

## Real runs

`haunt_sweep` and `haunt_ramp` run bots against a fake provider and need the full project. Clone it, run `npm ci`, and set `HAUNT_ROOT` to that folder. Without it they say so and stop.

## Layout

```
app.json
LICENSE
server/haunt-mcp.mjs        the MCP server, one file (built from the main repo: npm run build:crew-app)
agents/reviewer.json
skills/build-and-test-a-chain/SKILL.md
skills/stress-test-my-workflow/SKILL.md
page/                        the Chain Wizard (static)
WRITEUP.md
```

## License

MIT, see [LICENSE](LICENSE).
