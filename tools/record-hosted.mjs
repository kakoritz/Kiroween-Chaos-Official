// Records the real runs the hosted demo replays: starts the live server on a spare port, plays a 4-round tournament
// (pressing Next at each round) and one improve loop, and saves the event streams to site/recorded/*.json.
// Run once by hand (`node tools/record-hosted.mjs`); the committed JSON is what `npm run build:hosted` ships.
// Needs `npm run build:bots`. Binds 127.0.0.1 only; makes no external call.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = process.env.HAUNT_PORT || '7391';
const base = `http://127.0.0.1:${port}`;
const outDir = resolve(root, 'site/recorded');
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (p) => (await fetch(base + p)).json();
const post = async (p, b = {}) => { const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return r.json().catch(() => ({})); };

const child = spawn(process.execPath, [resolve(root, 'tools/run-ts.mjs'), resolve(root, 'packages/core/src/bin/live.ts')], {
  cwd: root, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true,
  env: { ...process.env, HAUNT_PORT: port, HAUNT_PROVIDER_PORT: String(Number(port) + 1) },
});
const stop = () => { if (!child.killed) child.kill(); };
process.on('exit', stop);
for (let i = 0; ; i++) {
  try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* not up */ }
  if (i > 150) { stop(); throw new Error('live server did not start'); }
  await sleep(200);
}

let events = [];
const ac = new AbortController();
(async () => {
  const res = await fetch(base + '/api/events', { signal: ac.signal });
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
      if (data) { try { events.push(JSON.parse(data)); } catch { /* ignore */ } }
    }
  }
})().catch(() => {});

const waitFor = async (pred, ms, what) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const hit = events.find(pred); if (hit) return hit; await sleep(250); }
  throw new Error('timeout waiting for ' + what);
};
// Keeps the file small: drops seq (the page assigns its own) and keeps every 4th stage_progress per lane, order and stage (the bar still fills).
const clean = (evs) => {
  const n = new Map();
  return evs.filter((e) => e.type !== 'hello').filter((e) => {
    if (e.type !== 'stage_progress') return true;
    const k = e.lane + '|' + e.order + '|' + e.stage;
    const c = (n.get(k) ?? 0) + 1; n.set(k, c);
    return c % 4 === 1 || (e.detail?.pct ?? 0) >= 100;
  }).map(({ seq, ...e }) => e);
};

// 1. Tournament, 4 rounds at speed 4.
await sleep(500);
const started = await post('/api/tournament/start', { speed: 4, rounds: undefined, seed: 7, resetLessons: true });
console.log('tournament start', JSON.stringify(started));
let seen = 0;
for (;;) {
  await waitFor((e, ) => (e.type === 'awaiting_next' || e.type === 'tournament_end') && events.indexOf(e) >= seen, 240_000, 'round end');
  const last = events.slice(seen).find((e) => e.type === 'awaiting_next' || e.type === 'tournament_end');
  seen = events.indexOf(last) + 1;
  console.log('round done:', last.type, events.length, 'events');
  if (last.type === 'tournament_end') break;
  await sleep(300);
  await post('/api/next');
}
await sleep(500);
const tourEvents = clean(events);
writeFileSync(resolve(outDir, 'campaign.json'), JSON.stringify(await get('/api/campaign')));
const snap = {
  tournament: await get('/api/tournament'),
  casebook: await get('/api/casebook'),
  patterns: await get('/api/patterns'),
  lessons: {},
};
for (let l = 1; l <= 5; l++) snap.lessons[l] = await get('/api/lessons/' + l).catch(() => null);
writeFileSync(resolve(outDir, 'tournament.json'), JSON.stringify({ recorded: true, kind: 'tournament', at: new Date().toISOString(), events: tourEvents, ...snap }));
console.log('tournament.json', tourEvents.length, 'events');

// 2. Improve loop.
events = [];
const imp = await post('/api/improve', { speed: 4, pace: 'normal' });
console.log('improve start', JSON.stringify(imp));
const phases = [];
const t0 = Date.now();
let state;
for (let i = 0; i < 1200; i++) {
  state = await get('/api/improve');
  if (!phases.length || phases.at(-1).state.phase !== state.phase) phases.push({ atMs: Date.now() - t0, state: JSON.parse(JSON.stringify(state)) });
  if (state.phase === 'done' || state.phase === 'error') break;
  await sleep(500);
}
await sleep(500);
const patterns = await get('/api/patterns');
writeFileSync(resolve(outDir, 'improve.json'), JSON.stringify({ recorded: true, kind: 'improve', at: new Date().toISOString(), events: clean(events), phases, final: state, patterns, tournament: await get('/api/tournament').catch(() => null) }));
console.log('improve.json', events.length, 'events, phases', phases.map((p) => p.state.phase).join(','));
ac.abort();
stop();
process.exit(0);


