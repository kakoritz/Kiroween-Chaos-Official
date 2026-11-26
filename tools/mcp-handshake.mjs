// node tools/mcp-handshake.mjs [--write]   Starts haunt-mcp from the Power manifest command, runs initialize and tools/list over stdio and
// prints the result in the shape of docs/proof/installed/mcp-handshake.json. With --write it replaces that file.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(root, 'kiro-power/mcp.json'), 'utf8'));
const app = JSON.parse(readFileSync(resolve(root, 'kiro-crew-app/app.json'), 'utf8'));
const server = Object.values(manifest.mcpServers ?? {})[0];
const appServer = (app.mcp ?? app.mcpServers ?? {})[Object.keys(app.mcp ?? app.mcpServers ?? {})[0]];

/** Starts the Crew app's own server command from an empty folder (no checkout around it) and lists its tools. */
async function appTools() {
  const dir = mkdtempSync(resolve(tmpdir(), 'crew-app-'));
  const c = spawn(appServer.command === 'node' ? process.execPath : appServer.command, appServer.args.map((a) => resolve(root, 'kiro-crew-app', a)), { cwd: dir, stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, HAUNT_ROOT: '' } });
  const it = createInterface({ input: c.stdout })[Symbol.asyncIterator]();
  try {
    c.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`);
    await it.next();
    c.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
    return JSON.parse((await it.next()).value).result.tools.map((t) => t.name);
  } finally { c.kill(); }
}

const child = spawn(process.execPath, [resolve(root, 'tools/run-ts.mjs'), resolve(root, 'packages/core/src/bin/haunt-mcp.ts')], { cwd: root, stdio: ['pipe', 'pipe', 'ignore'] });
const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
const call = async (msg) => { child.stdin.write(`${JSON.stringify(msg)}\n`); return JSON.parse((await lines.next()).value); };
try {
  const init = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const list = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const out = {
    server: { name: init.result.serverInfo.name, version: init.result.serverInfo.version },
    protocolVersion: init.result.protocolVersion,
    tools: list.result.tools.map((t) => t.name),
    crewAppRunsAlone: true,
    crewAppToolsMatchServer: JSON.stringify(await appTools()) === JSON.stringify(list.result.tools.map((t) => t.name)),
  };
  const text = `${JSON.stringify(out, null, 2)}\n`;
  if (process.argv.includes('--write')) writeFileSync(resolve(root, 'docs/proof/installed/mcp-handshake.json'), text);
  process.stdout.write(text);
} finally {
  child.kill();
}
