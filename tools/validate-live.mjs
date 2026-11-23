// npm run validate:live: start the live server on free ports, play one sweep at speed 4 (hero demo, a standard wave, a campaign night, an inbox wave),
// run the contract validator over the whole event stream, print the violations by rule. Exit 1 on any violation. Stops only the server it started.
// Flags: --keep-log (also leave the stream at .tmp/validate-live/events.jsonl, always kept on violations). Env: HAUNT_PORT / HAUNT_PROVIDER_PORT to pin ports.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { client } from './lib/haunt-client.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res, rej) => { const s = createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const PORT = process.env.HAUNT_PORT || String(await freePort());
let PROVIDER = process.env.HAUNT_PROVIDER_PORT || String(await freePort());
if (PROVIDER === PORT) PROVIDER = String(await freePort());
const base = `http://127.0.0.1:${PORT}`;
const specsDir = resolve(root, '.kiro/specs');
const specsBefore = new Set(existsSync(specsDir) ? readdirSync(specsDir) : []);
const dropNewSpecs = () => { if (existsSync(specsDir)) for (const d of readdirSync(specsDir)) if (d.startsWith('hardening-') && !specsBefore.has(d)) rmSync(resolve(specsDir, d), { recursive: true, force: true }); };

const server = spawn(process.execPath, [resolve(root, 'tools/run-ts.mjs'), resolve(root, 'packages/core/src/bin/live.ts')], {
  cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, HAUNT_PORT: PORT, HAUNT_PROVIDER_PORT: PROVIDER },
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });
let exited = null;
server.on('exit', (c) => { exited = c ?? 1; });
const stopServer = () => { try { if (exited === null) server.kill(); } catch { /* gone */ } };
process.on('SIGINT', () => { stopServer(); process.exit(130); });

let c;
let events = [];
let failure = null;
try {
  for (let i = 0; ; i++) {
    if (exited !== null) throw new Error(`server exited (${exited}) before answering\n${serverLog}`);
    if (i > 300) throw new Error('server did not answer /api/health');
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* not up */ }
    await sleep(100);
  }
  c = client(base);
  await sleep(400);
  const post = async (p, b) => { const r = await c.post(p, b); if (r.status !== 200) throw new Error(`POST ${p} -> ${r.status} ${JSON.stringify(r.json)}`); return r.json; };
  const endOf = (wave) => c.waitFor((e) => e.type === 'wave_end' && e.wave === wave, 240_000);
  await post('/api/demo/start', { script: 'hero', speed: 4 });
  await endOf((await c.waitFor((e) => e.type === 'wave_start', 10_000)).wave);
  await sleep(500);
  await endOf((await post('/api/wave/start', { speed: 4, seed: 3 })).wave);
  await sleep(500);
  await endOf((await post('/api/wave/start', { campaign: { night: 1, parts: ['journal', 'idempotency'] }, speed: 4 })).wave);
  await sleep(500);
  await post('/api/app', { app: 'inbox' });
  await endOf((await post('/api/wave/start', { orders: 4, lanes: 3, speed: 4, seed: 5 })).wave);
  await sleep(300);
  events = c.events.slice();
} catch (e) {
  failure = e instanceof Error ? e.message.split('\n')[0] : String(e);
} finally {
  try { c?.close(); } catch { /* ignore */ }
  stopServer();
  dropNewSpecs();
}

if (failure) { console.error(`validate:live: run failed: ${failure}`); process.exit(2); }

const logDir = resolve(root, '.tmp/validate-live');
mkdirSync(logDir, { recursive: true });
const logPath = resolve(logDir, 'events.jsonl');
writeFileSync(logPath, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
const out = await new Promise((done) => {
  const p = spawn(process.execPath, [resolve(root, 'tools/run-ts.mjs'), resolve(root, 'tools/validate-events.ts'), '--json', logPath], { cwd: root, windowsHide: true });
  let s = ''; p.stdout.on('data', (d) => { s += d; }); p.stderr.on('data', (d) => { s += d; });
  p.on('exit', (code) => done({ code, s }));
});
const jsonLine = out.s.split('\n').find((l) => l.startsWith('{"violations"'));
const violations = jsonLine ? JSON.parse(jsonLine).violations : [];
const byRule = new Map();
for (const v of violations) { const r = byRule.get(v.rule) ?? { n: 0, first: v }; r.n++; byRule.set(v.rule, r); }
console.log(`validate:live: ${events.length} events on ports ${PORT}/${PROVIDER}`);
if (byRule.size === 0 && out.code === 0) { console.log('validate:live: 0 violations'); process.exit(0); }
console.log('rule   count  first');
for (const [rule, r] of [...byRule].sort((a, b) => b[1].n - a[1].n)) console.log(`${rule.padEnd(6)} ${String(r.n).padStart(5)}  seq ${r.first.seq} ${r.first.type}: ${r.first.message.slice(0, 110)}`);
console.log(`validate:live: ${violations.length} violation(s); stream kept at ${logPath}`);
if (violations.length === 0) console.log(out.s);
process.exit(1);
