# Kiroween Chaos Kiro Power

Chaos engineering for AI agents, played as a haunted house. Kiroween Chaos crashes and curses your bots, grades how they survive, and shows the exact fix. One engine, three apps: Node and Python.

Packaging of the Kiroween Chaos MCP server as a Kiro Power. Format source: https://kiro.dev/docs/powers/create/ (`plugin.json`, `mcp.json`, `skills/<name>/SKILL.md`).

Contents:
- `plugin.json`: manifest and activation keywords.
- `mcp.json`: stdio server `haunt`. Tools: `haunt_define`, `haunt_blocks`, `haunt_chain`, `haunt_lab`, `haunt_sweep`, `haunt_ramp`, `haunt_report`, `haunt_specs`, `haunt_badge`. The read-only ones (`haunt_define`, `haunt_blocks`, `haunt_chain`, `haunt_lab`, `haunt_report`) are auto-approved; the two that start local mock servers ask first.
- `skills/stress-test-my-workflow/SKILL.md`: grade a `haunt.yaml`, find the failing stage, hand it to a reviewer.
- `skills/build-and-test-a-chain/SKILL.md`: pick blocks, test each alone, test the chain, read which block broke it.

The model-based tools (`haunt_blocks`, `haunt_chain`, `haunt_lab`) need only this repository. For a self-contained copy that runs with no checkout, see the Crew app: https://github.com/kakoritz/kiroween-chaos-crew.

Use:
1. In a checkout of this repository, run `npm install` once.
2. Kiro: Powers panel, Add Custom Power, Import power from a folder, pick `kiro-power/`.
3. The server command is relative (`tools/run-ts.mjs`), so Kiro must start it with the repository root as working directory.

Servers bind 127.0.0.1 only. Nothing here is published or installed. The manifest command was verified with a local stdio handshake (`docs/proof/installed/`). The import into the Kiro IDE itself is still to be done by the owner.
