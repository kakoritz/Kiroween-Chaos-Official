# MCP scene (SH-K4)

A 60 to 90 second screen capture of an agent using the Haunt MCP server: it defines a workflow, sweeps it, reads the report, writes a fix spec and makes a badge. Every step below uses the real tools in `packages/haunt/src/mcp/server.ts`. Nothing here needs a network; the server and the apps it runs bind to 127.0.0.1.

Honesty rule for the capture: show the tool calls and the answers as they come. If the capture is made outside Kiro (a plain MCP client or a terminal), say so on screen. Only call it "in Kiro" when the window is Kiro IDE or Kiro Crew with the Power or the Crew app installed (see `docs/proof/installed/README.md`).

## Setup (before recording)

1. `npm ci && npm run build:bots`
2. Start the server the way the Power does: `node tools/run-ts.mjs packages/core/src/bin/haunt-mcp.ts` (the client starts it; do not run it by hand for the capture). `kiro-power/mcp.json` and `kiro-crew-app/app.json` carry the same command.
3. Clean slate: `rm -rf .haunt` so the first report is the one on screen.
4. Terminal font 16 pt or larger, window 1280 x 720, dark theme.
5. Rehearse once. A sweep takes about a minute at speed 4; keep `orders` at 2 and the speed at 4 so it fits.

## Script

| # | Time | On screen | Say (one line) | Tool call |
|---|---|---|---|---|
| 1 | 0:00 | Client with the Haunt tool list showing six tools | "Haunt is an MCP server with six tools." | `tools/list`: `haunt_define`, `haunt_sweep`, `haunt_ramp`, `haunt_report`, `haunt_specs`, `haunt_badge` |
| 2 | 0:08 | Prompt: "Check my order workflow definition." | "First it validates my haunt.yaml." | `haunt_define {}` returns `ok: true`, 11 stages, the targets |
| 3 | 0:18 | Prompt: "Sweep it with the rookie bot." | "One creature fault per stage, run for real." | `haunt_sweep {tier: "rookie", orders: 2, speed: 4}` returns the matrix and grade (expect a low grade: the Rookie has no parts) |
| 4 | 0:45 | Prompt: "Show me the report." | "The report is saved, and the agent reads it back." | `haunt_report {kind: "sweep"}` returns the saved JSON with grade and findings |
| 5 | 0:58 | Prompt: "Which patterns keep costing me, and write the fix spec." | "The miner ranks recurring problems and writes a spec, it never edits code." | `haunt_specs {action: "list"}`, then `haunt_specs {action: "write", run: "scene"}`, then `haunt_specs {action: "lint", dir: ".kiro/specs/hardening-scene"}` |
| 6 | 1:15 | Prompt: "Make me a badge." | "A grade badge and a scorecard, as local files." | `haunt_badge {run: "sweep-rookie-seed1"}` writes the SVG and HTML files into the current folder |
| 7 | 1:25 | The badge SVG open next to the terminal | "That is the run, in one picture." | none |

Notes for step 5: `list` shows only patterns that qualify (seen often enough, enough downtime). A fresh sweep may list none; in that case run the improve loop first (`npm run haunt -- improve --deterministic` fills the pattern store in a scratch folder only, so use `npm run live` and `npm run haunt -- improve` to fill `.haunt/patterns.json`), or show `list` returning an empty list and then `lint` on `docs/proof/sample-hardening-spec`. Delete the generated `.kiro/specs/hardening-scene` folder after the capture; never apply a hardening spec automatically.

## Fallback if the sweep is slow

Run step 3 off camera, then in the capture start at step 4. Say that the sweep was run before. The saved file is `.haunt/sweeps/sweep-rookie-seed1.json`.

## Checks after the capture

- The tool names on screen match `docs/proof/installed/mcp-handshake.json`.
- No path, token or machine name from outside the repo is visible.
- Nothing on screen says Haunt runs in Kiro unless it does.
