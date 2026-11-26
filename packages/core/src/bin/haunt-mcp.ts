// `node tools/run-ts.mjs packages/core/src/bin/haunt-mcp.ts` starts the haunt MCP server on stdio.
import { serveStdio } from '../../../haunt/src/mcp';

// HAUNT_ROOT points at a Kiroween Chaos checkout for haunt_sweep and haunt_ramp; the other tools need no checkout.
await serveStdio({ root: process.env.HAUNT_ROOT ?? process.cwd() });
