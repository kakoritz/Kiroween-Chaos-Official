// Deep probe of a registered app on the live engine: a tournament with Next between rounds, then checks of the stream, the creatures,
// the Casebook and the contract. Usage: node tools/probe-app.mjs <app-id> [seed]   (private ports 17751/17752; run by hand, not part of verify)
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { client } from './lib/haunt-client.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appId = process.argv[2];
const seed = Number(process.argv[3] ?? 7);
if (!appId) { console.error('usage: node tools/probe-app.mjs <app-id> [seed]'); process.exit(2); }
// A tournament makes the pattern miner write hardening specs under .kiro/specs. They are probe output, never applied: remove the ones this run made.
const specsDir = resolve(root, '.kiro/specs');
const specsBefore = new Set(existsSync(specsDir) ? readdirSync(specsDir) : []);
const dropNewSpecs = () => { if (existsSync(specsDir)) for (const d of readdirSync(specsDir)) if (d.startsWith('hardening-') && !specsBefore.has(d)) rmSync(resolve(specsDir, d), { recursive: true, force: true }); };
const PORT = process.env.HAUNT_PORT || '17751', PROVIDER = process.env.HAUNT_PROVIDER_PORT || '17752';
const base = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, [resolve(root, 'tools/run-ts.mjs'), resolve(root, 'packages/core/src/bin/live.ts')], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HAUNT_PORT: PORT, HAUNT_PROVIDER_PORT: PROVIDER } });
let log = ''; server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; });
const rows = [];
const check = (name, ok, detail = '') => { rows.push({ name, ok: !!ok, detail: String(detail) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + String(detail).slice(0, 220) : ''}`); };
let c;
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* starting */ } await sleep(250); }
  c = client(base);
  await sleep(500);
  await c.post('/api/intensity', { level: 3 });
  const sw = await c.post('/api/app', { app: appId });
  check(`${appId}: app switch`, sw.status === 200, JSON.stringify(sw.json));
  const st = (await c.get('/api/state')).json;
  const stageIds = st.stages.map((s) => s.id);
  check(`${appId}: state lists ${stageIds.length} stages`, st.app === appId && stageIds.length > 0, stageIds.join());
  const start = c.events.length;
  const t0 = Date.now();
  const ts = await c.post('/api/tournament/start', { seed, speed: 4, resetLessons: true });
  check(`${appId}: tournament starts`, ts.status === 200, JSON.stringify(ts.json).slice(0, 120));
  let rounds = 0;
  for (;;) {
    const seen = c.events.slice(start);
    if (seen.some((e) => e.type === 'tournament_end')) break;
    const aw = seen.filter((e) => e.type === 'awaiting_next').length;
    if (aw > rounds) { rounds = aw; await c.post('/api/next'); } else await sleep(300);
    if (Date.now() - t0 > 420000) { check(`${appId}: tournament finished`, false, `stuck after ${rounds} rounds`); throw new Error('stuck'); }
  }
  const evs = c.events.slice(start);
  const ends = evs.filter((e) => e.type === 'round_end');
  check(`${appId}: rounds played and ended`, ends.length >= 2 && ends.length === evs.filter((e) => e.type === 'round_start').length, `${ends.length} rounds`);
  const champion = evs.find((e) => e.type === 'tournament_end');
  check(`${appId}: champion named`, champion?.detail?.champion !== undefined, JSON.stringify(champion?.detail?.champion));
  const stagesSeen = new Set(evs.filter((e) => e.stage).map((e) => e.stage));
  const foreign = [...stagesSeen].filter((s) => !stageIds.includes(s));
  check(`${appId}: only its own stage ids in events`, foreign.length === 0, foreign.join() || [...stagesSeen].length + ' stages');
  const chaos = evs.filter((e) => e.type === 'chaos' && e.detail?.source !== 'boss');
  const perLane = new Map();
  for (const e of chaos) { const k = e.lane; (perLane.get(k) ?? perLane.set(k, new Set()).get(k)).add(e.detail?.creature); }
  check(`${appId}: creatures attack on its stages`, chaos.length > 10, `${chaos.length} chaos events, kinds per lane ${[...perLane.values()].map((s) => s.size).join(',')}`);
  const chaosStages = chaos.map((e) => e.stage).filter(Boolean);
  check(`${appId}: no chaos event on a stage it does not have`, chaosStages.every((s) => stageIds.includes(s)), [...new Set(chaosStages)].join());
  console.log(`      creature names seen: ${[...new Set(chaos.map((e) => e.detail?.creatureName).filter(Boolean))].join(', ') || '(none)'}`);
  const tn = (await c.get('/api/tournament')).json;
  const cb = tn.casebook ?? tn.tournament?.casebook;
  const cases = cb?.cases ?? cb ?? [];
  check(`${appId}: Casebook has entries`, Array.isArray(cases) && cases.length > 0, `${cases.length} cases`);
  const caseStages = (Array.isArray(cases) ? cases : []).map((x) => x.stage).filter(Boolean);
  check(`${appId}: Casebook stages are the app's own`, caseStages.every((s) => stageIds.includes(s)), [...new Set(caseStages)].join());
  mkdirSync(resolve(root, '.tmp/probe'), { recursive: true });
  const f = resolve(root, `.tmp/probe/${appId}-tournament.jsonl`);
  const hello = c.events.find((e) => e.type === 'hello');
  // A tournament stream ends with spec_written after the last wave_end; the contract wants a stream to end at wave_end, so cut there.
  const lastEnd = evs.map((e) => e.type).lastIndexOf('wave_end');
  writeFileSync(f, [{ ...hello, app: appId, stages: st.stages }, ...evs.slice(0, lastEnd + 1)].map((e) => JSON.stringify(e)).join('\n') + '\n');
  const v = await new Promise((done) => { const p = spawn(process.execPath, [resolve(root, 'tools/run-ts.mjs'), resolve(root, 'tools/validate-events.ts'), f], { cwd: root }); let o = ''; p.stdout.on('data', (d) => { o += d; }); p.stderr.on('data', (d) => { o += d; }); p.on('exit', (code) => done({ code, o })); });
  check(`${appId}: contract validator over the tournament (${evs.length} events)`, v.code === 0, v.code === 0 ? 'no violations' : v.o.split('\n').slice(0, 5).join(' | '));
} catch (e) { if (!/stuck/.test(String(e))) console.log('probe error:', e); } finally {
  c?.close?.(); server.kill(); setTimeout(dropNewSpecs, 500);
}
const bad = rows.filter((r) => !r.ok);
console.log(`${rows.length - bad.length} of ${rows.length} checks passed`);
if (bad.length) { console.log('server log tail:\n' + log.split('\n').slice(-12).join('\n')); process.exit(1); }
