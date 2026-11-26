// haunt-mcp: a minimal Model Context Protocol server over stdio (newline-delimited JSON-RPC 2.0).
// Tools: haunt_define (validate a haunt.yaml), haunt_blocks (the block library and each block's card), haunt_chain (test a chain of blocks or a manifest and name the block that broke it),
// haunt_lab (model-based what-if of any haunt.yaml), haunt_sweep, haunt_ramp (run the CLI in a checkout), haunt_report, haunt_specs, haunt_badge.
// haunt_define, haunt_blocks, haunt_chain and haunt_lab are pure: they need no repository checkout, so the bundled Crew app server (kiro-crew-app/server/haunt-mcp.mjs) runs them alone.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { loadHauntConfig } from '../config';
import { writeBadgeFiles, writeImproveFiles } from '../share';
import { qualifies, costOf } from '../miner/patterns';
import { FilePatternStore } from '../miner/pattern-store';
import { lintSpecDir, listSpecs, writeFixSpec } from '../miner/specs';
import { BLOCKS } from '../blocks/library';
import { CARD_TIERS, allBlockCards, chainChecks, chainReport, runBlock, type CardTier } from '../blocks/cards';
import { parseHauntConfig, type HauntConfig } from '../config/haunt-config';
import { configToLab } from '../lab/model';
import { labRun } from '../lab/engine';
import { PACK_TIERS } from '../packs/pack';

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
  { name: 'haunt_blocks', description: 'List the 22 reusable blocks (id, role, what it is for). With a tier, also run each block alone against every fault that fits its role and return its card (attacks tried, survived, repeats, failed faults). Model-based.', inputSchema: { type: 'object', properties: { tier: { type: 'string', enum: TIERS, description: 'Add alone-cards at this tier' }, block: str('string', 'Only this block id') } } },
  { name: 'haunt_chain', description: 'Test a chain: give block ids in order (blocks) or a haunt.yaml (config). Returns the grade, reliability, which stage and block caused which share of the failures, and warnings a chain can have although its blocks passed alone. Model-based.', inputSchema: { type: 'object', properties: { blocks: { type: 'array', items: { type: 'string' }, description: 'Block ids in order, for example ["read_request","charge","notify"]' }, config: str('string', 'Path to a haunt.yaml (stages may use `use: <block>`)'), tier: { type: 'string', enum: TIERS, description: 'Tier to test with (default rookie)' }, seed: str('number', 'Seed') } } },
  { name: 'haunt_lab', description: 'Model-based what-if of any haunt.yaml: grade, the failing cells, findings and the parts to add. Needs no running bot.', inputSchema: { type: 'object', properties: { config: str('string', 'Path to haunt.yaml'), tier: { type: 'string', enum: TIERS, description: 'Protections to assume (default rookie)' }, seed: str('number', 'Seed') }, required: ['config'] } },
  { name: 'haunt_sweep', description: 'Run a graded fault sweep (one creature fault per stage) and return the matrix and grade.', inputSchema: { type: 'object', properties: runProps } },
  { name: 'haunt_ramp', description: 'Run a load ramp and return the knee, break point and grade.', inputSchema: { type: 'object', properties: runProps } },
  { name: 'haunt_report', description: 'Read a saved sweep or ramp report JSON (latest in .haunt if no path is given).', inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['sweep', 'ramp'] }, path: str('string', 'Report file path') } } },
  { name: 'haunt_specs', description: 'Fix specs of the pattern miner: list the qualifying patterns and hardening folders, write .kiro/specs/hardening-<run> for the patterns still new, or lint a spec folder (evidence, patch, test, no rewrite).', inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'write', 'lint'], description: 'list (default), write or lint' }, run: str('string', 'Run id for write'), dir: str('string', 'Spec folder for lint') } } },
  { name: 'haunt_badge', description: 'Write the grade badge and scorecard (SVG and HTML) for a saved run into a local folder.', inputSchema: { type: 'object', properties: { run: str('string', 'Report path or run name under .haunt/sweeps'), out: str('string', 'Output folder (default .)'), improve: str('string', 'Improve report JSON: write the closed n of m before and after card instead') }, required: [] } },
];

const text = (t: string, isError = false): Json => ({ content: [{ type: 'text', text: t }], isError });

function runCli(opts: McpOptions, sub: 'sweep' | 'ramp', a: Json): Promise<Json> {
  if (!opts.cliEntry && !existsSync(join(opts.root, 'tools', 'run-ts.mjs'))) {
    return Promise.resolve(text(`${sub} needs a Kiroween Chaos checkout: set HAUNT_ROOT to its folder (git clone https://github.com/kakoritz/Kiroween-Chaos-Official.git, then npm ci). haunt_define, haunt_blocks, haunt_chain and haunt_lab work without it.`, true));
  }
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

const tierOf = (v: unknown): CardTier => (CARD_TIERS.includes(v as CardTier) ? (v as CardTier) : 'rookie');
const seedOf = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 1);

function configFromArgs(opts: McpOptions, a: Json): { ok: true; config: HauntConfig } | { ok: false; error: string } {
  if (Array.isArray(a.blocks)) {
    const ids = a.blocks.map(String);
    const bad = ids.filter((id) => !BLOCKS.some((b) => b.id === id));
    if (ids.length === 0 || bad.length > 0) return { ok: false, error: ids.length === 0 ? 'blocks: give at least one block id' : `unknown block(s): ${bad.join(', ')} (call haunt_blocks for the list)` };
    const yaml = ['name: chain', 'start: node bot.js', 'truth: http://127.0.0.1:7071', 'stages:', ...ids.map((id) => `  - { use: ${id} }`)].join('\n');
    const r = parseHauntConfig(yaml);
    return r.ok ? { ok: true, config: r.config } : { ok: false, error: r.errors.join('; ') };
  }
  if (typeof a.config === 'string' && a.config) {
    const path = resolve(opts.root, a.config);
    if (!existsSync(path)) return { ok: false, error: `config not found: ${path}` };
    const r = loadHauntConfig(path);
    return r.ok ? { ok: true, config: r.config } : { ok: false, error: r.errors.join('; ') };
  }
  return { ok: false, error: 'give blocks (a list of block ids) or config (a haunt.yaml path)' };
}

export async function callTool(opts: McpOptions, name: string, a: Json): Promise<Json> {
  if (name === 'haunt_blocks') {
    const list = BLOCKS.filter((b) => a.block === undefined || b.id === a.block);
    if (list.length === 0) return text(`unknown block: ${String(a.block)}`, true);
    const base = list.map((b) => ({ id: b.id, label: b.label, role: b.role, about: b.about, effects: b.effects.map((e) => e.kind) }));
    if (a.tier === undefined) return text(JSON.stringify({ blocks: base }));
    const tier = tierOf(a.tier);
    const cards = a.block !== undefined ? [await runBlock(String(a.block), tier, seedOf(a.seed))] : (await allBlockCards(seedOf(a.seed))).filter((c) => c.tier === tier);
    return text(JSON.stringify({ tier, modelBased: true, blocks: base, cards }));
  }
  if (name === 'haunt_chain') {
    const c = configFromArgs(opts, a);
    if (!c.ok) return text(c.error, true);
    const tier = tierOf(a.tier);
    const report = await chainReport(c.config, tier, seedOf(a.seed));
    const cards = (await Promise.all(c.config.stages.filter((s) => s.block).map((s) => runBlock(s.block!, tier, seedOf(a.seed))))).filter((x) => x !== null);
    return text(JSON.stringify({ ...report, warnings: chainChecks(c.config, cards) }));
  }
  if (name === 'haunt_lab') {
    const c = configFromArgs(opts, a);
    if (!c.ok) return text(c.error, true);
    const tier = tierOf(a.tier);
    const rep = await labRun({ ...configToLab(c.config), parts: { ...PACK_TIERS[tier] }, seed: seedOf(a.seed) });
    const bad = rep.cells.filter((x) => x.outcome !== 'pass' && x.outcome !== 'recovered_late');
    return text(JSON.stringify({ modelBased: true, name: rep.name, tier, grade: rep.grade, reliability: rep.reliability, gradeWithSuggestions: rep.gradeWithSuggestions, failingCells: bad.slice(0, 30).map((x) => ({ stage: x.stage, fault: x.fault, outcome: x.outcome })), findings: rep.findings.slice(0, 10), suggestions: rep.suggestions.slice(0, 10) }));
  }
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
  if (name === 'haunt_specs') {
    const action = String(a.action ?? 'list');
    const specsDir = join(opts.root, '.kiro', 'specs');
    const store = new FilePatternStore(join(opts.root, '.haunt', 'patterns.json'));
    if (action === 'list') {
      const patterns = store.list().filter(qualifies).sort((x, y) => costOf(y) - costOf(x)).map((p) => ({ id: p.id, signature: p.signature, status: p.status, count: p.count, downtimeMsTotal: p.downtimeMsTotal, lostOrders: p.lostOrders, repeats: p.repeats }));
      return text(JSON.stringify({ patterns, specs: listSpecs(specsDir) }));
    }
    if (action === 'lint') {
      if (typeof a.dir !== 'string' || !a.dir) return text('dir required', true);
      const dir = resolve(opts.root, a.dir);
      if (!existsSync(dir)) return text(`not found: ${dir}`, true);
      const r = lintSpecDir(dir);
      return text(JSON.stringify(r), !r.ok);
    }
    if (action === 'write') {
      if (typeof a.run !== 'string' || !a.run) return text('run required', true);
      const todo = store.list().filter((p) => qualifies(p) && p.status === 'new');
      if (!todo.length) return text('no qualifying pattern is waiting for a spec', true);
      try {
        const w = writeFixSpec(specsDir, { runId: a.run, patterns: todo });
        store.setStatuses(w.included.map((p) => p.id), 'suggested');
        return text(JSON.stringify({ dir: w.dir, patterns: w.included.map((p) => p.id), refused: w.refused.map((r) => r.pattern.signature), lint: w.lint }), !w.lint.ok);
      } catch (e) { return text(String(e instanceof Error ? e.message : e), true); }
    }
    return text(`unknown action: ${action}`, true);
  }
  if (name === 'haunt_badge') {
    if (typeof a.improve === 'string' && a.improve) {
      const ri = writeImproveFiles(opts.root, a.improve, String(a.out ?? '.'));
      return 'error' in ri ? text(ri.error, true) : text(JSON.stringify(ri));
    }
    if (typeof a.run !== 'string' || !a.run) return text('run or improve required', true);
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
    case 'initialize': return reply({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'haunt-mcp', title: 'Kiroween Chaos', version: '0.1.0' } });
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
