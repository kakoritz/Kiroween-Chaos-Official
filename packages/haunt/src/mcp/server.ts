// haunt-mcp: a minimal Model Context Protocol server over stdio (newline-delimited JSON-RPC 2.0).
// Tools: haunt_define (validate a haunt.yaml), haunt_sweep, haunt_ramp (run the CLI), haunt_report (read a saved report).
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { loadHauntConfig } from '../config';
import { writeBadgeFiles } from '../share';

export interface McpOptions { root: string; cliEntry?: string; runTimeoutMs?: number }
type Json = Record<string, unknown>;
interface Tool { name: string; description: string; inputSchema: Json }

const str = (type: string, description: string): Json => ({ type, description });
const TIERS = ['rookie', 'retrier', 'journaler', 'reconciler', 'phoenix'];
const runProps: Json = {
  tier: { type: 'string', enum: TIERS, description: 'Bot tier to run' },
  seed: str('number', 'Seed'), orders: str('number', 'Orders per cell'), speed: str('number', 'Speed multiplier'),
  config: str('string', 'Path to haunt.yaml'), bot: str('string', 'Path to a built bot'),
};

export const TOOLS: Tool[] = [
  { name: 'haunt_define', description: 'Load and validate a haunt.yaml and return its stages and targets.', inputSchema: { type: 'object', properties: { config: str('string', 'Path to haunt.yaml (default apps/haunted-orders/haunt.yaml)') } } },
  { name: 'haunt_sweep', description: 'Run a graded fault sweep (one creature fault per stage) and return the matrix and grade.', inputSchema: { type: 'object', properties: runProps } },
  { name: 'haunt_ramp', description: 'Run a load ramp and return the knee, break point and grade.', inputSchema: { type: 'object', properties: runProps } },
  { name: 'haunt_report', description: 'Read a saved sweep or ramp report JSON (latest in .haunt if no path is given).', inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['sweep', 'ramp'] }, path: str('string', 'Report file path') } } },
  { name: 'haunt_badge', description: 'Write the grade badge and scorecard (SVG and HTML) for a saved run into a local folder.', inputSchema: { type: 'object', properties: { run: str('string', 'Report path or run name under .haunt/sweeps'), out: str('string', 'Output folder (default .)') }, required: ['run'] } },
];

const text = (t: string, isError = false): Json => ({ content: [{ type: 'text', text: t }], isError });

function runCli(opts: McpOptions, sub: 'sweep' | 'ramp', a: Json): Promise<Json> {
  const entry = opts.cliEntry ?? join(opts.root, 'packages', 'core', 'src', 'bin', 'haunt.ts');
  const args = [join(opts.root, 'tools', 'run-ts.mjs'), entry, sub];
  for (const k of ['tier', 'seed', 'orders', 'speed', 'config', 'bot']) if (a[k] !== undefined) args.push(`--${k}`, String(a[k]));
  return new Promise((done) => {
    const child = spawn(process.execPath, args, { cwd: opts.root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    const timer = setTimeout(() => { child.kill(); }, opts.runTimeoutMs ?? 600_000);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', () => undefined);
    child.on('close', (code) => { clearTimeout(timer); done(text(out.trim() || `exit ${code}`, code !== 0)); });
    child.on('error', (e) => { clearTimeout(timer); done(text(String(e), true)); });
  });
}

function latestReport(root: string, kind: string): string | undefined {
  const dir = join(root, '.haunt', kind === 'ramp' ? 'ramps' : 'sweeps');
  if (!existsSync(dir)) return undefined;
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  return files.length ? join(dir, files[files.length - 1]!) : undefined;
}

export async function callTool(opts: McpOptions, name: string, a: Json): Promise<Json> {
  if (name === 'haunt_define') {
    const path = resolve(opts.root, String(a.config ?? join('apps', 'haunted-orders', 'haunt.yaml')));
    if (!existsSync(path)) return text(`config not found: ${path}`, true);
    const r = loadHauntConfig(path);
    if (!r.ok) return text(JSON.stringify({ ok: false, errors: r.errors }), true);
    return text(JSON.stringify({ ok: true, config: r.config }));
  }
  if (name === 'haunt_sweep' || name === 'haunt_ramp') return runCli(opts, name === 'haunt_sweep' ? 'sweep' : 'ramp', a);
  if (name === 'haunt_report') {
    const kind = a.kind === 'ramp' ? 'ramp' : 'sweep';
    const path = a.path ? resolve(opts.root, String(a.path)) : latestReport(opts.root, kind);
    if (!path || !existsSync(path)) return text('no report found', true);
    try { return text(JSON.stringify(JSON.parse(readFileSync(path, 'utf8')))); } catch (e) { return text(`unreadable report: ${String(e)}`, true); }
  }
  if (name === 'haunt_badge') {
    if (typeof a.run !== 'string' || !a.run) return text('run required', true);
    const r = writeBadgeFiles(opts.root, a.run, String(a.out ?? '.'));
    return 'error' in r ? text(r.error, true) : text(JSON.stringify(r));
  }
  return text(`unknown tool: ${name}`, true);
}

export async function handle(opts: McpOptions, msg: Json): Promise<Json | undefined> {
  const id = msg.id as string | number | undefined;
  const reply = (result: Json): Json => ({ jsonrpc: '2.0', id, result });
  const fail = (code: number, message: string): Json => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (id === undefined) return undefined; // notifications get no reply
  switch (msg.method) {
    case 'initialize': return reply({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'haunt-mcp', version: '0.1.0' } });
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: TOOLS });
    case 'tools/call': {
      const p = (msg.params ?? {}) as Json;
      if (typeof p.name !== 'string') return fail(-32602, 'name required');
      if (!TOOLS.some((t) => t.name === p.name)) return fail(-32602, `unknown tool: ${p.name}`);
      return reply(await callTool(opts, p.name, (p.arguments ?? {}) as Json));
    }
    default: return fail(-32601, `method not found: ${String(msg.method)}`);
  }
}

export function serveStdio(opts: McpOptions, input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): Promise<void> {
  const rl = createInterface({ input });
  const pending: Promise<void>[] = [];
  rl.on('line', (line) => {
    if (!line.trim()) return;
    pending.push((async () => {
      let msg: Json;
      try { msg = JSON.parse(line) as Json; } catch { output.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })}\n`); return; }
      const res = await handle(opts, msg);
      if (res) output.write(`${JSON.stringify(res)}\n`);
    })());
  });
  return new Promise((done) => rl.on('close', () => { void Promise.all(pending).then(() => done()); }));
}
