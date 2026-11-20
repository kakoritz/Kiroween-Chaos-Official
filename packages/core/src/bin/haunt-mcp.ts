// `node tools/run-ts.mjs packages/core/src/bin/haunt-mcp.ts` starts the haunt MCP server on stdio.
import { serveStdio } from '../../../haunt/src/mcp';

await serveStdio({ root: process.cwd() });
