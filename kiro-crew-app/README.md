# Kiroween Chaos as a Kiro Crew app

Chaos Monkey for AI agents, played as a haunted house. Kiroween Chaos crashes and curses your bots, grades how they survive, and shows the exact fix. One engine, two apps: Node and Python.

Manifest (`app.json`), reviewer agent, skill `stress-test-my-workflow`, MCP server (`packages/core/src/bin/haunt-mcp.ts`, tools `haunt_define`, `haunt_sweep`, `haunt_ramp`, `haunt_report`) and a page that hosts the arena UI from 127.0.0.1.

Nothing here installs or enables itself. To try it, the user runs `kirocrew app install ./kiro-crew-app`, then enables it. A directory install is third-party, so Kiro Crew asks for trust first. The MCP command is relative to the repo root.
