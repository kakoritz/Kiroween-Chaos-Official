// `haunt monkey` and `haunt stop` (PK-C4, PK-C5). Library functions so the bin stays a thin wrapper. Node only.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { startFaultProxy } from '../adapters/proxy';
import { buildMonkeyConfig, defaultConfig, MONKEY_MODES, parseMonkeyConfig, type MonkeyConfig, type MonkeyMode } from './config';
import { startControlServer, requestStop } from './control';
import { httpProbe, jsonlAudit, startDemoTarget } from './demo';
import { evaluatePlan, Monkey, runBlockers, type MonkeyReport } from './monkey';
import { PatternStore } from '../miner/patterns';
import { monkeyRoundRunner } from './host';
import { checkWatch, Watch, WATCH_ROUND_MS } from './watch';

const flag = (argv: string[], name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[i + 1] : undefined;
};

export const CONTROL_FILE = '.haunt/monkey.control.json';

export const MONKEY_USAGE = 'usage: haunt monkey --mode observe|staging|prod-guarded [--config file.yaml] [--dry-run] [--upstream URL] [--probe-path /api/items] [--audit file.jsonl] [--who name] [--control-port N]\n       haunt stop [--port N]\n       haunt watch --mode observe|staging|prod-guarded [--speed 1..100] [--rounds N] [--round-ms N] [--config file.yaml] [--upstream URL] [--probe-path /api/items]\n                   [--patterns .haunt/patterns.json] [--specs .kiro/specs] [--report .haunt/watch-report.json] [--control-port N]';

export function loadMonkeyConfig(argv: string[]): { ok: true; config: MonkeyConfig } | { ok: false; errors: string[] } {
  const mode = flag(argv, '--mode') as MonkeyMode | undefined;
  if (mode && !MONKEY_MODES.includes(mode)) return { ok: false, errors: [`--mode: one of ${MONKEY_MODES.join(' | ')}`] };
  const file = flag(argv, '--config');
  if (file) {
    if (!existsSync(file)) return { ok: false, errors: [`config not found: ${file}`] };
    return parseMonkeyConfig(readFileSync(file, 'utf8'), mode);
  }
  if (!mode) return { ok: false, errors: ['--mode is required'] };
  // No file: mode defaults. prod-guarded has no default schedule, so it must come from a file.
  if (mode === 'prod-guarded') return { ok: false, errors: ['prod-guarded needs --config with a schedule window and an allowlist'] };
  return buildMonkeyConfig(defaultConfig(mode) as unknown as Record<string, unknown>, mode);
}

export function renderDryRun(c: MonkeyConfig, at = Date.now()): string {
  const out = [`mode: ${c.mode}  (dry run: nothing is injected)`];
  for (const b of runBlockers(c, at)) out.push(`BLOCKED: ${b}`);
  const items = evaluatePlan(c);
  if (!items.length) out.push('plan is empty');
  for (const i of items) {
    out.push(`${i.decision.toUpperCase().padEnd(6)} ${i.fault} on ${i.endpoint}: ${i.reason}`);
    if (i.rule) out.push(`       rule ${JSON.stringify(i.rule)}`);
  }
  return out.join('\n');
}

export async function monkeyCommand(argv: string[], log: (s: string) => void = console.log): Promise<number> {
  const loaded = loadMonkeyConfig(argv);
  if (!loaded.ok) { for (const e of loaded.errors) log(`error: ${e}`); log(MONKEY_USAGE); return 2; }
  const config = loaded.config;
  if (argv.includes('--dry-run')) { log(renderDryRun(config)); return runBlockers(config, Date.now()).length ? 2 : 0; }

  const demo = flag(argv, '--upstream') ? undefined : await startDemoTarget();
  const upstream = flag(argv, '--upstream') ?? demo!.url;
  const proxy = await startFaultProxy({ upstream });
  const auditFile = resolve(flag(argv, '--audit') ?? '.haunt/monkey-audit.jsonl');
  const probePath = flag(argv, '--probe-path') ?? config.allow.endpoints[0] ?? '/';
  const monkey = new Monkey({
    config, target: proxy, probe: httpProbe(`${proxy.url}${probePath}`, config.syntheticHeader),
    audit: jsonlAudit(auditFile), who: flag(argv, '--who') ?? process.env.USERNAME ?? process.env.USER ?? 'haunt-monkey',
  });
  const control = await startControlServer(monkey, Number(flag(argv, '--control-port') ?? 0));
  mkdirSync(dirname(resolve(CONTROL_FILE)), { recursive: true });
  writeFileSync(resolve(CONTROL_FILE), JSON.stringify({ port: control.port, pid: process.pid }));
  log(`monkey ${config.mode}: proxy ${proxy.url} -> ${upstream}; control ${control.url} (haunt stop); audit ${auditFile}`);
  const onSig = (): void => { monkey.stop('kill switch: signal'); };
  process.once('SIGINT', onSig); process.once('SIGTERM', onSig);
  let report: MonkeyReport;
  try { report = await monkey.start(); } finally {
    process.off('SIGINT', onSig); process.off('SIGTERM', onSig);
    await control.close(); await proxy.close(); await demo?.close();
    rmSync(resolve(CONTROL_FILE), { force: true });
  }
  log(`${report.status.toUpperCase()}: ${report.reason}`);
  log(`injections ${report.injections}, samples ${report.samples}, success_rate ${report.successRate.toFixed(3)}, p95 ${Math.round(report.p95Ms)} ms`);
  return report.status === 'refused' ? 2 : report.status === 'aborted' || report.status === 'dead_man' ? 1 : 0;
}

/** `haunt watch`: non-stop chaos at 1x to 100x (1x only in prod-guarded). Patterns go to the store, qualifying ones become fix specs. SIGINT stops cleanly. */
export async function watchCommand(argv: string[], log: (s: string) => void = console.log): Promise<number> {
  const loaded = loadMonkeyConfig(argv);
  if (!loaded.ok) { for (const e of loaded.errors) log(`error: ${e}`); log(MONKEY_USAGE); return 2; }
  const config = loaded.config;
  const speed = Number(flag(argv, '--speed') ?? 1);
  const bad = checkWatch(config.mode, speed);
  if (bad) { log(`error: ${bad}`); return 2; }
  const rounds = flag(argv, '--rounds');
  if (rounds !== undefined && !(Number(rounds) >= 1)) { log('error: --rounds must be a positive number'); return 2; }
  if (argv.includes('--dry-run')) { log(renderDryRun(config)); log(`watch: speed ${speed}x`); return runBlockers(config, Date.now()).length ? 2 : 0; }

  const demo = flag(argv, '--upstream') ? undefined : await startDemoTarget();
  const upstream = flag(argv, '--upstream') ?? demo!.url;
  const proxy = await startFaultProxy({ upstream });
  const auditFile = resolve(flag(argv, '--audit') ?? '.haunt/monkey-audit.jsonl');
  const probePath = flag(argv, '--probe-path') ?? config.allow.endpoints[0] ?? '/';
  // A round is short: the config's duration cap is trimmed to 10 s so the watch keeps cycling.
  const base = { ...config, blast: { ...config.blast, maxDurationMs: Math.min(config.blast.maxDurationMs, 10_000) } };
  const watch = new Watch({
    mode: config.mode, speed, store: new PatternStore(resolve(flag(argv, '--patterns') ?? '.haunt/patterns.json')),
    specsDir: resolve(flag(argv, '--specs') ?? '.kiro/specs'), reportFile: resolve(flag(argv, '--report') ?? '.haunt/watch-report.json'),
    roundMs: Number(flag(argv, '--round-ms') ?? WATCH_ROUND_MS), ...(rounds !== undefined ? { maxRounds: Number(rounds) } : {}), log,
    round: monkeyRoundRunner({ base, target: proxy, probe: httpProbe(`${proxy.url}${probePath}`, config.syntheticHeader), probePath, audit: jsonlAudit(auditFile), who: flag(argv, '--who') ?? process.env.USERNAME ?? process.env.USER ?? 'haunt-watch' }),
  });
  const control = await startControlServer(watch, Number(flag(argv, '--control-port') ?? 0));
  mkdirSync(dirname(resolve(CONTROL_FILE)), { recursive: true });
  writeFileSync(resolve(CONTROL_FILE), JSON.stringify({ port: control.port, pid: process.pid }));
  log(`watch ${config.mode} ${speed}x: proxy ${proxy.url} -> ${upstream}; control ${control.url} (haunt stop); Ctrl+C to stop`);
  const onSig = (): void => { watch.stop('signal'); };
  process.once('SIGINT', onSig); process.once('SIGTERM', onSig);
  let report;
  try { report = await watch.start(); } finally {
    process.off('SIGINT', onSig); process.off('SIGTERM', onSig);
    await control.close(); await proxy.close(); await demo?.close();
    rmSync(resolve(CONTROL_FILE), { force: true });
  }
  log(`watch ended (${report.stopReason}): ${report.rounds} rounds, ${report.injections} injections, ${report.patterns.qualifying} of ${report.patterns.total} patterns qualify, ${report.specs.length} spec${report.specs.length === 1 ? '' : 's'} written`);
  return 0;
}

export async function stopCommand(argv: string[], log: (s: string) => void = console.log): Promise<number> {
  let port = Number(flag(argv, '--port') ?? 0);
  if (!port && existsSync(resolve(CONTROL_FILE))) port = (JSON.parse(readFileSync(resolve(CONTROL_FILE), 'utf8')) as { port: number }).port;
  if (!port) { log('error: no running monkey found (pass --port)'); return 2; }
  const r = await requestStop(port);
  log(r.ok ? `stopped in ${r.ms} ms` : `error: could not reach the monkey on port ${port}`);
  return r.ok ? 0 : 1;
}
