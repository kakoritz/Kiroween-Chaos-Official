// `npm run haunt -- sweep [--tier rookie] [--seed 1] [--orders 2] [--speed 4] [--config path] [--bot path] [--feed "cmd {dir} {count}"] [--out dir]`
// Runs one creature fault per stage against a built bot (npm run build:bots) and a local provider on 127.0.0.1,
// prints the coverage matrix and the grade, and writes a deterministic report JSON.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { loadHauntConfig } from '../../../haunt/src/config';
import { CORE_CREATURES, EXTRA_CREATURES } from '../../../haunt/src/creatures';
import { planSweep, renderMatrix, runSweep, sweepReportJson, createLiveCellRunner, type RunCell } from '../../../haunt/src/sweep';
import { createLiveRampRunner, runRamp } from '../../../haunt/src/ramp';
import { createLiveStackRunner, planStack, renderStackCurve, runStack, stackReportJson } from '../../../haunt/src/stack';
import { createLiveSoakRunner, renderSoak, runSoak, soakReportJson } from '../../../haunt/src/soak';
import { bossReportJson, createLiveBossRunner, planBoss, renderBoss, runBoss } from '../../../haunt/src/boss';
import { compareReportJson, compareReports, renderCompare } from '../../../haunt/src/compare';
import { ciExitCode, bossTargets, rampTargets, renderTargetLines, soakTargets, stackTargets, sweepTargets } from '../../../haunt/src/report/ci';
import { parseCommandLine } from '../../../haunt/src/adapters';
import { writeBadgeFiles, writeImproveFiles } from '../../../haunt/src/share';
import { startProvider } from '../provider/server';
import { lintSpecDir, renderLint } from '../../../haunt/src/miner/specs';
import { monkeyCommand, stopCommand, watchCommand } from '../../../haunt/src/monkey/cli';
import { initCommand, packCommand } from '../../../haunt/src/packs/cli';
import { reportCommand } from '../../../haunt/src/report/cli';
import { serveCommand } from './serve';

const argv = process.argv.slice(2);
const cmd = argv[0];
const gate = (results: Parameters<typeof ciExitCode>[0]): number => {
  console.log(renderTargetLines(results));
  return argv.includes('--no-gate') ? 0 : ciExitCode(results);
};
const opt = (name: string, def?: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : def;
};

async function sweep(): Promise<number> {
  const tier = opt('tier', 'phoenix')!;
  const seed = Number(opt('seed', '1'));
  const orders = Number(opt('orders', '2'));
  const speed = Number(opt('speed', '4'));
  if (![seed, orders, speed].every((n) => Number.isFinite(n) && n > 0)) { console.error('seed, orders and speed must be positive numbers'); return 2; }
  const min = (opt('min-grade') ?? '').toUpperCase();
  if (min && !/^[ABCD]$/.test(min)) { console.error('--min-grade must be A, B, C or D'); return 2; }
  const root = process.cwd();
  const configPath = resolve(opt('config', join(root, 'apps', 'haunted-orders', 'haunt.yaml'))!);
  const bot = resolve(opt('bot', join(root, 'dist', 'bots', `${tier}.js`))!);
  const outDir = resolve(opt('out', join(root, '.haunt', 'sweeps'))!);
  const loaded = loadHauntConfig(configPath);
  if (!loaded.ok) { console.error(`config errors:\n${loaded.errors.join('\n')}`); return 2; }
  const creatures = [...CORE_CREATURES, ...EXTRA_CREATURES];
  const ownApp = loaded.config.adapter.includes('process') && opt('bot') === undefined;
  const plan = planSweep(loaded.config, creatures, { catalogStages: !ownApp });

  // A haunt.yaml with `adapter: process` and no --bot runs its own `start` line (any language, H3.8).
  let target: { command: string; args: string[] } = { command: process.execPath, args: [bot] };
  let seedInput: ((dir: string, count: number) => void) | undefined;
  if (ownApp) {
    const [command, ...args] = parseCommandLine(loaded.config.start);
    const appDir = dirname(configPath);
    target = { command, args: args.map((a) => (existsSync(join(appDir, a)) ? join(appDir, a) : a)) };
    const feed = opt('feed');
    if (feed) {
      const line = parseCommandLine(feed).map((a) => (existsSync(join(appDir, a)) ? join(appDir, a) : a));
      seedInput = (dir, count) => {
        const [fc, ...fa] = line.map((a) => a.replace('{dir}', dir).replace('{count}', String(count)));
        execFileSync(fc, fa, { stdio: 'ignore' });
      };
    }
  }

  const prov = await startProvider({ port: 0 });
  const runDir = join(root, '.haunt', 'sweep-run', `${tier}-${process.pid}`);
  try {
    const live = createLiveCellRunner({
      ...target, runDir, tier, orders, speed, cellTimeoutMs: Number(opt('cell-timeout', '30000')),
      app: loaded.config.name, seedInput,
      recoverMs: loaded.config.targets.recoverMs,
      creatures,
      provider: {
        url: prov.url,
        reset: () => prov.provider.reset(),
        ledger: (lane) => prov.provider.ledger(lane),
        post: async (body) => { prov.provider.addFault(body); },
      },
    });
    const runCell: RunCell = async (cell, s) => {
      const r = await live(cell, s);
      console.error(`${cell.stage}/${cell.column ?? cell.creature}: ${typeof r === 'string' ? r : r.outcome}`);
      return r;
    };
    const report = await runSweep(plan, runCell, seed);
    console.log(renderMatrix(report.matrix));
    console.log(`grade ${report.grade} (reliability ${report.reliability}), seed ${seed}, tier ${tier}`);
    mkdirSync(outDir, { recursive: true });
    const file = join(outDir, `sweep-${tier}-seed${seed}.json`);
    writeFileSync(file, sweepReportJson(report));
    console.log(`report ${file}`);
    const code = gate(sweepTargets(loaded.config.targets, report));
    // --min-grade A|B|C|D: the real-bot check of docs/GITHUB-ACTION.md. Exit 1 when the grade of this run is lower.
    if (min) {
      if ('FDCBA'.indexOf(String(report.grade).charAt(0)) < 'FDCBA'.indexOf(min)) { console.error(`grade ${report.grade} is below the minimum ${min}`); return argv.includes('--no-gate') ? code : 1; }
    }
    return code;
  } finally {
    await prov.close();
    rmSync(runDir, { recursive: true, force: true });
  }
}

async function ramp(): Promise<number> {
  const tier = opt('tier', 'phoenix')!;
  const seed = Number(opt('seed', '1'));
  const orders = Number(opt('orders', '12'));
  const speed = Number(opt('speed', '4'));
  const steps = opt('steps', '1,2,4,8')!.split(',').map(Number);
  if (![seed, orders, speed, ...steps].every((n) => Number.isFinite(n) && n > 0)) { console.error('seed, orders, speed and steps must be positive numbers'); return 2; }
  const root = process.cwd();
  const configPath = resolve(opt('config', join(root, 'apps', 'haunted-orders', 'haunt.yaml'))!);
  const bot = resolve(opt('bot', join(root, 'dist', 'bots', `${tier}.js`))!);
  const outDir = resolve(opt('out', join(root, '.haunt', 'ramps'))!);
  const loaded = loadHauntConfig(configPath);
  if (!loaded.ok) { console.error(`config errors:\n${loaded.errors.join('\n')}`); return 2; }

  const prov = await startProvider({ port: 0 });
  const runDir = join(root, '.haunt', 'ramp-run', `${tier}-${process.pid}`);
  try {
    const run = createLiveRampRunner({
      command: process.execPath, args: [bot], runDir,
      env: { HAUNT_TIER: tier, HAUNT_PROVIDER: prov.url, HAUNT_SPEED: String(speed), HAUNT_APP: 'haunted-orders' },
    });
    const report = await runRamp(async (c, n, s) => {
      prov.provider.reset();
      const r = await run(c, n, s);
      console.error(`concurrency ${c}: ${r.latenciesMs.length}/${n} done, ${r.failed} failed, ${Math.round(r.durationMs)} ms`);
      return r;
    }, { steps, ordersPerStep: orders, seed, target: loaded.config.targets.concurrency });
    console.log('concurrency  orders/min  p50ms  p95ms  errors');
    for (const s of report.steps) console.log(`${String(s.concurrency).padStart(11)}  ${String(s.throughputPerMin).padStart(10)}  ${String(Math.round(s.p50)).padStart(5)}  ${String(Math.round(s.p95)).padStart(5)}  ${(s.errorRate * 100).toFixed(0)}%`);
    console.log(`knee ${report.knee ?? 'none'}, break ${report.breakPoint ?? 'none'}, grade ${report.grade}, target ${report.target}, seed ${seed}, tier ${tier}`);
    mkdirSync(outDir, { recursive: true });
    const file = join(outDir, `ramp-${tier}-seed${seed}.json`);
    writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`report ${file}`);
    return gate(rampTargets(loaded.config.targets, report));
  } finally {
    await prov.close();
    rmSync(runDir, { recursive: true, force: true });
  }
}

async function stack(): Promise<number> {
  const tier = opt('tier', 'phoenix')!;
  const seed = Number(opt('seed', '1'));
  const speed = Number(opt('speed', '8'));
  const maxDepth = Number(opt('max-depth', '5'));
  const orders = Number(opt('orders', '1'));
  if (![seed, speed, maxDepth, orders].every((n) => Number.isFinite(n) && n > 0)) { console.error('seed, speed, orders and max-depth must be positive numbers'); return 2; }
  const root = process.cwd();
  const configPath = resolve(opt('config', join(root, 'apps', 'haunted-orders', 'haunt.yaml'))!);
  const bot = resolve(opt('bot', join(root, 'dist', 'bots', `${tier}.js`))!);
  const outDir = resolve(opt('out', join(root, '.haunt', 'stacks'))!);
  const loaded = loadHauntConfig(configPath);
  if (!loaded.ok) { console.error(`config errors:\n${loaded.errors.join('\n')}`); return 2; }
  const stageFilter = opt('stages');
  const stages = loaded.config.stages.map((s) => s.id).filter((id) => !stageFilter || stageFilter.split(',').includes(id));
  const crash = CORE_CREATURES.find((c) => c.id === 'reaper');
  if (!crash) { console.error('reaper creature missing'); return 2; }

  const prov = await startProvider({ port: 0 });
  const runDir = join(root, '.haunt', 'stack-run', `${tier}-${process.pid}`);
  try {
    const live = createLiveStackRunner({
      command: process.execPath, args: [bot], runDir, tier, orders, speed, cellTimeoutMs: Number(opt('cell-timeout', '30000')),
      recoverMs: loaded.config.targets.recoverMs, crash,
      provider: {
        url: prov.url,
        reset: () => prov.provider.reset(),
        ledger: (lane) => prov.provider.ledger(lane),
        post: async (body) => { prov.provider.addFault(body); },
      },
    });
    const report = await runStack(planStack(stages, maxDepth), async (s, d, sd) => {
      const r = await live(s, d, sd);
      console.error(`${s} depth ${d}: ${typeof r === 'string' ? r : r.outcome}`);
      return r;
    }, seed);
    console.log(renderStackCurve(report));
    console.log(`weakest stage survives depth ${report.weakest} of ${report.maxDepth}, seed ${seed}, tier ${tier}`);
    mkdirSync(outDir, { recursive: true });
    const file = join(outDir, `stack-${tier}-seed${seed}.json`);
    writeFileSync(file, stackReportJson(report));
    console.log(`report ${file}`);
    return gate(stackTargets(loaded.config.targets, report));
  } finally {
    await prov.close();
    rmSync(runDir, { recursive: true, force: true });
  }
}

async function soak(): Promise<number> {
  const tier = opt('tier', 'phoenix')!;
  const seed = Number(opt('seed', '1'));
  const speed = Number(opt('speed', '8'));
  const minutes = Number(opt('minutes', '5'));
  const frequency = Number(opt('frequency', '0.3'));
  const orders = Number(opt('orders', '2'));
  if (![seed, speed, minutes, orders].every((n) => Number.isFinite(n) && n > 0) || !Number.isFinite(frequency) || frequency < 0 || frequency > 1) { console.error('seed, speed, minutes and orders must be positive numbers and frequency 0..1'); return 2; }
  const root = process.cwd();
  const configPath = resolve(opt('config', join(root, 'apps', 'haunted-orders', 'haunt.yaml'))!);
  const bot = resolve(opt('bot', join(root, 'dist', 'bots', `${tier}.js`))!);
  const outDir = resolve(opt('out', join(root, '.haunt', 'soaks'))!);
  const loaded = loadHauntConfig(configPath);
  if (!loaded.ok) { console.error(`config errors:\n${loaded.errors.join('\n')}`); return 2; }
  const creatures = [...CORE_CREATURES, ...EXTRA_CREATURES];
  const plan = planSweep(loaded.config, creatures, { catalogStages: true });

  const prov = await startProvider({ port: 0 });
  const runDir = join(root, '.haunt', 'soak-run', `${tier}-${process.pid}`);
  try {
    const live = createLiveSoakRunner({
      command: process.execPath, args: [bot], runDir, tier, orders, speed, cellTimeoutMs: Number(opt('cell-timeout', '30000')),
      recoverMs: loaded.config.targets.recoverMs, creatures,
      provider: {
        url: prov.url,
        reset: () => prov.provider.reset(),
        ledger: (lane) => prov.provider.ledger(lane),
        post: async (body) => { prov.provider.addFault(body); },
      },
    });
    const report = await runSoak(live, { durationMs: minutes * 60000, frequency, seed, ordersPerSegment: orders, cells: plan.cells });
    console.log(renderSoak(report));
    mkdirSync(outDir, { recursive: true });
    const file = join(outDir, `soak-${tier}-seed${seed}.json`);
    writeFileSync(file, soakReportJson(report));
    console.log(`report ${file}`);
    return gate(soakTargets(loaded.config.targets, report));
  } finally {
    await prov.close();
    rmSync(runDir, { recursive: true, force: true });
  }
}
async function boss(): Promise<number> {
  const tier = opt('tier', 'phoenix')!;
  const seed = Number(opt('seed', '1'));
  const orders = Number(opt('orders', '2'));
  const speed = Number(opt('speed', '8'));
  if (![seed, orders, speed].every((n) => Number.isFinite(n) && n > 0)) { console.error('seed, orders and speed must be positive numbers'); return 2; }
  const only = opt('boss');
  let plan: ReturnType<typeof planBoss>;
  try { plan = planBoss(only ? [only] : undefined); } catch (e) { console.error(e instanceof Error ? e.message : String(e)); return 2; }
  const root = process.cwd();
  const configPath = resolve(opt('config', join(root, 'apps', 'haunted-orders', 'haunt.yaml'))!);
  const bot = resolve(opt('bot', join(root, 'dist', 'bots', `${tier}.js`))!);
  const outDir = resolve(opt('out', join(root, '.haunt', 'bosses'))!);
  const loaded = loadHauntConfig(configPath);
  if (!loaded.ok) { console.error(`config errors:\n${loaded.errors.join('\n')}`); return 2; }
  const creatures = [...CORE_CREATURES, ...EXTRA_CREATURES];

  const prov = await startProvider({ port: 0 });
  const runDir = join(root, '.haunt', 'boss-run', `${tier}-${process.pid}`);
  try {
    const live = createLiveBossRunner({
      command: process.execPath, args: [bot], runDir, tier, orders, speed, cellTimeoutMs: Number(opt('cell-timeout', '30000')),
      recoverMs: loaded.config.targets.recoverMs, creatures,
      provider: {
        url: prov.url,
        reset: () => prov.provider.reset(),
        ledger: (lane) => prov.provider.ledger(lane),
        post: async (body) => { prov.provider.addFault(body); },
      },
    });
    const report = await runBoss(plan, live, seed);
    console.log(renderBoss(report));
    mkdirSync(outDir, { recursive: true });
    const file = join(outDir, `boss-${tier}-seed${seed}.json`);
    writeFileSync(file, bossReportJson(report));
    console.log(`report ${file}`);
    return gate(bossTargets(loaded.config.targets, report));
  } finally {
    await prov.close();
    rmSync(runDir, { recursive: true, force: true });
  }
}

/** A run is a report file path, or a name under .haunt/sweeps (with or without .json). */
function findRun(id: string): string | null {
  const root = process.cwd();
  for (const p of [resolve(id), join(root, '.haunt', 'sweeps', id), join(root, '.haunt', 'sweeps', `${id}.json`)]) {
    if (existsSync(p) && p.endsWith('.json')) return p;
  }
  return null;
}

function compare(): number {
  const [a, b] = [argv[1], argv[2]];
  if (!a || !b || a.startsWith('--') || b.startsWith('--')) { console.error('usage: npm run haunt -- compare <runA> <runB> [--out file]'); return 2; }
  const fa = findRun(a);
  const fb = findRun(b);
  if (!fa || !fb) { console.error(`run not found: ${!fa ? a : b}`); return 2; }
  const report = compareReports(JSON.parse(readFileSync(fa, 'utf8')), JSON.parse(readFileSync(fb, 'utf8')));
  console.log(renderCompare(report));
  const out = opt('out');
  if (out) { mkdirSync(resolve(out, '..'), { recursive: true }); writeFileSync(resolve(out), compareReportJson(report)); console.log(`report ${resolve(out)}`); }
  return argv.includes('--no-gate') ? 0 : report.verdict === 'regressed' ? 1 : 0;
}
/** `haunt report <run> [--format html|md|json] [--out file]`: a saved run as json, markdown or html. */
function report(): number {
  const id = argv[1];
  if (!id || id.startsWith('--')) { console.error('usage: npm run haunt -- report <run-id|report.json> [--format html|md|json] [--out file]'); return 2; }
  const r = reportCommand(process.cwd(), id, opt('format', 'md')!);
  if ('error' in r) { console.error(r.error); return 2; }
  const out = opt('out');
  if (out) { mkdirSync(resolve(out, '..'), { recursive: true }); writeFileSync(resolve(out), r.text); console.log(`wrote ${resolve(out)}`); } else process.stdout.write(r.text);
  return 0;
}
function badge(): number {
  const imp = opt('improve');
  if (imp) {
    const r = writeImproveFiles(process.cwd(), imp, opt('out', '.')!);
    if ('error' in r) { console.error(r.error); return 2; }
    for (const p of r.files) console.log(`wrote ${p}`);
    return 0;
  }
  const id = argv[1];
  if (!id || id.startsWith('--')) { console.error('usage: npm run haunt -- badge <run-id|report.json> [--out dir] | badge --improve <improve-report.json> [--out dir]'); return 2; }
  const r = writeBadgeFiles(process.cwd(), id, opt('out', '.')!);
  if ('error' in r) { console.error(r.error); return 2; }
  for (const p of r.files) console.log(`wrote ${p}`);
  return 0;
}
/** `haunt spec-lint <dir>`: exit 1 when a requirement lacks evidence, a patch or a test, or a task says rewrite. */
function specLint(): number {
  const dir = argv[1];
  if (!dir || dir.startsWith('--')) { console.error('usage: npm run haunt -- spec-lint <.kiro/specs/hardening-run>'); return 2; }
  const path = resolve(dir);
  if (!existsSync(path)) { console.error(`not found: ${path}`); return 2; }
  const r = lintSpecDir(path);
  console.log(renderLint(r, dir));
  return r.ok ? 0 : 1;
}
/**
 * `haunt improve [--url http://127.0.0.1:7070] [--seed N] [--rounds '[{"lanes":5,"orders":4,"intensity":3}]'] [--speed N] [--pace slow]`:
 * asks a running live server (`npm run live`) to run, mine, apply the cheap patterns as policy overlay, write a spec for the rest, rerun the same plan
 * and seed, and compare. `--deterministic` runs it in process in virtual time instead (same seed, same grades). `--json` prints the report as JSON. Prints the report ("closed n of m patterns"). Nothing is applied to code.
 */
async function improveCmd(): Promise<number> {
  let sim: { close(): Promise<void>; url: string } | undefined;
  if (argv.includes('--deterministic')) {
    // Virtual time, in process, a scratch lessons folder: the same seed always gives the same before and after (see sim/engine.ts).
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { LiveServer } = await import('../live/server');
    const { createSimEngine } = await import('../sim/engine');
    const dir = mkdtempSync(join(tmpdir(), 'haunt-improve-'));
    const lessonsDir = join(dir, 'lessons');
    const srv = new LiveServer({ engine: createSimEngine({ policyDir: lessonsDir }), staticDir: '/nonexistent', lessonsDir, patternsFile: join(dir, 'patterns.json'), runDir: dir, specsDir: join(dir, 'specs') });
    const { url } = await srv.listen(0);
    sim = { url, close: () => srv.close() };
    console.log(`deterministic run, scratch folder ${dir}`);
  }
  try { return await improveRun(sim?.url ?? (opt('url', 'http://127.0.0.1:7070') as string).replace(/[/]$/, ''), argv.includes('--json')); } finally { await sim?.close(); }
}
async function improveRun(base: string, asJson: boolean): Promise<number> {
  const body: Record<string, unknown> = {};
  if (opt('seed')) body.seed = Number(opt('seed'));
  if (opt('speed')) body.speed = Number(opt('speed'));
  if (opt('pace')) body.pace = opt('pace');
  if (opt('rounds')) { try { body.rounds = JSON.parse(opt('rounds')!); } catch { console.error('--rounds must be JSON'); return 2; } }
  const started = await fetch(`${base}/api/improve`, { method: 'POST', body: JSON.stringify(body) }).catch(() => undefined);
  if (!started) { console.error(`no server at ${base} (start one with npm run live)`); return 2; }
  const first = await started.json() as { error?: { message?: string } };
  if (!started.ok) { console.error(first.error?.message ?? `HTTP ${started.status}`); return 2; }
  console.log(`improve started on ${base}`);
  let last = '';
  const deadline = Date.now() + Number(opt('timeout-min', '60')) * 60_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const j = await (await fetch(`${base}/api/improve`)).json() as { phase: string; error?: string; report?: { text: string; closed: number; of: number } };
    if (j.phase !== last) { last = j.phase; console.log(`phase: ${j.phase}`); }
    if (j.phase === 'error') { console.error(j.error ?? 'improve failed'); return 1; }
    if (j.phase === 'done' && j.report) { console.log(asJson ? JSON.stringify(j.report) : j.report.text); return 0; }
  }
  console.error('timed out');
  return 1;
}
if (cmd === 'badge') {
  process.exitCode = badge();
} else if (cmd === 'improve') {
  process.exitCode = await improveCmd();
} else if (cmd === 'spec-lint') {
  process.exitCode = specLint();
} else if (cmd === 'sweep') {
  process.exitCode = await sweep();
} else if (cmd === 'stack') {
  process.exitCode = await stack();
} else if (cmd === 'soak') {
  process.exitCode = await soak();
} else if (cmd === 'boss') {
  process.exitCode = await boss();
} else if (cmd === 'compare') {
  process.exitCode = compare();
} else if (cmd === 'monkey') {
  process.exitCode = await monkeyCommand(argv.slice(1));
} else if (cmd === 'validate') {
  const file = resolve(argv[1] && !argv[1].startsWith('--') ? argv[1] : 'haunt.yaml');
  const v = loadHauntConfig(file);
  if (v.ok) console.log(`${file}: valid (${v.config.stages.length} stages)`);
  else console.error([`${file}: invalid`, ...v.errors.map((e) => `  ${e}`)].join('\n'));
  process.exitCode = v.ok ? 0 : 1;
} else if (cmd === 'watch') {
  process.exitCode = await watchCommand(argv.slice(1));
} else if (cmd === 'pack') {
  process.exitCode = await packCommand(argv.slice(1));
} else if (cmd === 'init') {
  process.exitCode = initCommand(argv.slice(1));
} else if (cmd === 'stop') {
  process.exitCode = await stopCommand(argv.slice(1));
} else if (cmd === 'ramp') {
  process.exitCode = await ramp();
} else if (cmd === 'report') {
  process.exitCode = report();
} else if (cmd === 'serve') {
  process.exitCode = await serveCommand(argv.slice(1), process.cwd());
} else {
  console.log(`usage: npm run haunt -- ramp|sweep|stack|soak|boss [--boss lich|banshee_queen|horseman] [--tier rookie|retrier|journaler|reconciler|phoenix] [--seed N] [--orders N] [--speed N] [--config path] [--bot path] [--out dir] [--no-gate] [--min-grade A|B|C|D]`);
  console.log('       npm run haunt -- compare <runA> <runB> [--out file]');
  console.log('       npm run haunt -- report <run-id|report.json> [--format html|md|json] [--out file]');
  console.log('       npm run haunt -- serve [--port 7070] [--mode live|mock]  (127.0.0.1 only)');
  console.log('       npm run haunt -- badge <run-id|report.json> [--out dir] | --improve <improve-report.json>');
  console.log('       npm run haunt -- spec-lint <.kiro/specs/hardening-run>');
  console.log('       npm run haunt -- monkey --mode observe|staging|prod-guarded [--config file] [--dry-run] | stop  (see docs/PRODUCTION-MODE.md)');
  console.log('       npm run haunt -- watch --mode observe|staging|prod-guarded [--speed 1..100] [--rounds N] [--config file]  (non-stop chaos; Ctrl+C stops)');
  console.log('       npm run haunt -- validate [haunt.yaml]');
  console.log('       npm run haunt -- pack new <id> | list | check <id>;  npm run haunt -- init [--pack id]  (see docs/PACKS.md)');
  console.log('       npm run haunt -- improve [--url http://127.0.0.1:7070] [--seed N] [--rounds JSON] [--speed N] [--pace slow]');
  process.exitCode = cmd ? 2 : 0;
}
