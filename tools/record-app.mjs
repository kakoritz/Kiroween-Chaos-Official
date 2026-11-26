// Records a real 4-round tournament of one registered app for the hosted page: node tools/record-app.mjs <app-id> [seed]
// Writes site/recorded/tournament-<app-id>.json (same shape as tournament.json plus `app`). Needs `npm run build:bots`; private ports 17761/17762; 127.0.0.1 only.
// The tournament makes the pattern miner write hardening specs under .kiro/specs: they are probe output, so the new ones are removed.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { client } from './lib/haunt-client.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appId = process.argv[2], seed = Number(process.argv[3] ?? 7);
if (!appId) { console.error('usage: node tools/record-app.mjs <app-id> [seed]'); process.exit(2); }
const specsDir = resolve(root, '.kiro/specs');
const before = new Set(existsSync(specsDir) ? readdirSync(specsDir) : []);
const dropSpecs = () => { if (existsSync(specsDir)) for (const d of readdirSync(specsDir)) if (d.startsWith('hardening-') && !before.has(d)) rmSync(resolve(specsDir, d), { recursive: true, force: true }); };
const PORT = process.env.HAUNT_PORT || '17761', PROVIDER = process.env.HAUNT_PROVIDER_PORT || '17762';
const base = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, [resolve(root, 'tools/run-ts.mjs'), resolve(root, 'packages/core/src/bin/live.ts')], { cwd: root, stdio: 'ignore', env: { ...process.env, HAUNT_PORT: PORT, HAUNT_PROVIDER_PORT: PROVIDER } });
let c;
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* starting */ } await sleep(250); }
  c = client(base);
  await sleep(500);
  await c.post('/api/intensity', { level: 3 });
  const sw = await c.post('/api/app', { app: appId });
  if (sw.status !== 200) throw new Error(`cannot select ${appId}: ${JSON.stringify(sw.json)}`);
  const start = c.events.length, t0 = Date.now();
  await c.post('/api/tournament/start', { seed, speed: 4, resetLessons: true });
  let rounds = 0;
  for (;;) {
    const seen = c.events.slice(start);
    if (seen.some((e) => e.type === 'tournament_end')) break;
    const aw = seen.filter((e) => e.type === 'awaiting_next').length;
    if (aw > rounds) { rounds = aw; console.log('round', rounds, 'done'); await c.post('/api/next'); } else await sleep(300);
    if (Date.now() - t0 > 600000) throw new Error('tournament did not finish in 10 minutes');
  }
  await sleep(500);
  const n = new Map();
  const events = c.events.slice(start).filter((e) => e.type !== 'hello').filter((e) => {
    if (e.type !== 'stage_progress') return true;
    const k = e.lane + '|' + e.order + '|' + e.stage, k2 = (n.get(k) ?? 0) + 1; n.set(k, k2);
    return k2 % 4 === 1 || (e.detail?.pct ?? 0) >= 100;
  }).map(({ seq, ...e }) => e);
  const get = async (p) => (await c.get(p)).json;
  const snap = { tournament: await get('/api/tournament'), casebook: await get('/api/casebook'), patterns: await get('/api/patterns'), lessons: {} };
  for (let l = 1; l <= 5; l++) snap.lessons[l] = await get('/api/lessons/' + l).catch(() => null);
  mkdirSync(resolve(root, 'site/recorded'), { recursive: true });
  const out = resolve(root, `site/recorded/tournament-${appId}.json`);
  writeFileSync(out, JSON.stringify({ recorded: true, kind: 'tournament', app: appId, at: new Date().toISOString(), events, ...snap }));
  console.log(`wrote ${out}: ${events.length} events, ${rounds + 1} rounds`);
} finally { c?.close?.(); server.kill(); dropSpecs(); }
process.exit(0);
