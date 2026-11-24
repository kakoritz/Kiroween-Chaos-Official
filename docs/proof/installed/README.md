# Install proof (SH-K3)

What was verified on 2026-11-21, locally, with no network:

- `kiro-power/mcp.json` and `kiro-crew-app/app.json` start the same server (`node tools/run-ts.mjs packages/core/src/bin/haunt-mcp.ts`). A stdio client started it from the manifest command, ran `initialize` and `tools/list`, and got server `haunt-mcp` 0.1.0 with tools `haunt_define`, `haunt_sweep`, `haunt_ramp`, `haunt_report`, `haunt_specs`, `haunt_badge`. Result: `mcp-handshake.json` (refreshed 2026-11-23 with `node tools/mcp-handshake.mjs --write`; `tools/mcp-handshake.test.ts` fails if it drifts from the server).
- Screenshots (headless Edge, `file://` pages, no servers):
  - `packages/arena-ui/docs/screens/share-power-handshake.png`: the handshake result.
  - `packages/arena-ui/docs/screens/share-crew-app-page.png`: the Crew app page as shipped (it shows its "start the arena UI" note until the local arena runs).

## Not done (needs the owner)

The Power was not imported into the Kiro IDE, and the Crew app was not installed with `kirocrew app install ./kiro-crew-app`. Both change the user's own Kiro and Kiro Crew setup, and the Crew install asks for a trust prompt. No screenshot here is a Kiro IDE or Kiro Crew window, and none should be described as one.

To finish: import `kiro-power/` through Powers, Add Custom Power; run `kirocrew app install ./kiro-crew-app` and enable it; capture the two screens and the 20 s clips into this folder.
