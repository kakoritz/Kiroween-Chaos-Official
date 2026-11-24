# Chaos Haunt Kiro Power

Chaos engineering for AI agents and automation, played as a haunted house.

Packaging of the Chaos Haunt MCP server as a Kiro Power. Format source: https://kiro.dev/docs/powers/create/ (`plugin.json`, `mcp.json`, `skills/<name>/SKILL.md`).

Contents:
- `plugin.json`: manifest and activation keywords.
- `mcp.json`: stdio server `haunt` (tools `haunt_define`, `haunt_sweep`, `haunt_ramp`, `haunt_report`).
- `skills/stress-test-my-workflow/SKILL.md`: the workflow the agent follows.

Use:
1. In a checkout of this repository, run `npm install` once.
2. Kiro: Powers panel, Add Custom Power, Import power from a folder, pick `kiro-power/`.
3. The server command is relative (`tools/run-ts.mjs`), so Kiro must start it with the repository root as working directory.

Servers bind 127.0.0.1 only. Nothing here is published or installed. The manifest command was verified with a local stdio handshake (`docs/proof/installed/`). The import into the Kiro IDE itself is still to be done by the owner.
