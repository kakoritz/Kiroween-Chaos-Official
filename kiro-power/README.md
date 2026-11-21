# Haunt Kiro Power

Packaging of the Haunt MCP server as a Kiro Power. Format source: https://kiro.dev/docs/powers/create/ (`plugin.json`, `mcp.json`, `skills/<name>/SKILL.md`).

Contents:
- `plugin.json`: manifest and activation keywords.
- `mcp.json`: stdio server `haunt` (tools `haunt_define`, `haunt_sweep`, `haunt_ramp`, `haunt_report`).
- `skills/stress-test-my-workflow/SKILL.md`: the workflow the agent follows.

Use:
1. In a checkout of this repository, run `npm install` once.
2. Kiro: Powers panel, Add Custom Power, Import power from a folder, pick `kiro-power/`.
3. The server command is relative (`tools/run-ts.mjs`), so Kiro must start it with the repository root as working directory.

Servers bind 127.0.0.1 only. Nothing here is published or installed. The install check is task H6.9.
