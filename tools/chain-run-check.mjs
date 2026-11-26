// Run in the arena, end to end on a real live server, then the phone view (needs `npm run ui:build`, `npm run build:bots`). Binds 127.0.0.1 only.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const chrome = [process.env.CHROME, '/usr/bin/google-chrome', '/usr/bin/chromium', ...['1255', '1228'].map((v) => `${process.env.HOME}/.cache/ms-playwright/chromium-${v}/chrome-linux64/chrome`), 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find((p) => p && existsSync(p));
if (!chrome) { console.error('Chrome not found (set CHROME)'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Run in the arena, end to end on a real live server, then the phone view. node tools/chain-run-check.mjs (needs `npm run ui:build` and `npm run build:bots`; 127.0.0.1 only).
const PORT = 17781, PROVIDER = 17782, base = `http://127.0.0.1:${PORT}`, cPort = 19900 + Math.floor(Math.random() * 90);
const server = spawn(process.execPath, [resolve(root, 'tools/run-ts.mjs'), resolve(root, 'packages/core/src/bin/live.ts')], { cwd: root, stdio: 'ignore', env: { ...process.env, HAUNT_PORT: String(PORT), HAUNT_PROVIDER_PORT: String(PROVIDER) } });
const prof = mkdtempSync(join(tmpdir(), 'haunt-chainrun-'));
const proc = spawn(chrome, [...(process.env.CHROME_NO_SANDBOX || process.getuid?.() !== 0 ? ['--no-sandbox'] : []), '--headless=new', '--disable-gpu', `--remote-debugging-port=${cPort}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + String(detail).slice(0, 200) : ''}`); };
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* starting */ } await sleep(250); }
  await sleep(2000);
  const tabs = await (await fetch(`http://127.0.0.1:${cPort}/json`)).json();
  const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = {}; const errors = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) pend[d.id](d.result); if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails?.exception?.description ?? 'error'); };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.value;
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: `${base}/chain.html` }); await sleep(3500);
  await ev(`document.querySelector('button[aria-label="Load example: Support ticket"]').click()`); await sleep(1500);
  await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Run in the arena').click()`);
  await sleep(4000);
  check('Run in the arena opens the arena page', /index\.html/.test(await ev(`location.pathname`)), await ev(`location.href`));
  const st = await (await fetch(base + '/api/state')).json();
  check('the server switched to the chain with its own stages', st.app === 'support-ticket' && st.stages.map((s) => s.id).join() === 'read_message,decide,file_ticket,notify,wait_for_callback,confirm', `${st.app}: ${st.stages?.map((s) => s.id).join()}`);
  await fetch(base + '/api/wave/start', { method: 'POST', body: JSON.stringify({ speed: 4 }) });
  await sleep(6000);
  const seen = await ev(`document.body.innerText.includes('Read message') || document.body.innerText.toLowerCase().includes('read message')`);
  check('the arena shows the chain stages', seen === true);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 2, mobile: true });
  await send('Page.reload'); await sleep(5000);
  const cards = await ev(`document.querySelectorAll('.lc').length`);
  check('phone width: lane cards show under the small canvas', cards >= 1, `${cards} cards`);
  check('phone width: no sideways scroll', (await ev(`document.documentElement.scrollWidth <= window.innerWidth + 2`)) === true, await ev(`document.documentElement.scrollWidth + ' vs ' + window.innerWidth`));
  check('page errors', errors.length === 0, errors.join(' | '));
} catch (e) { failed++; console.log('FAIL  check crashed', e); } finally {
  proc.kill(); server.kill(); setTimeout(() => { try { rmSync(prof, { recursive: true, force: true }); } catch { /* locked */ } }, 800);
}
console.log(failed ? `chain run check FAILED (${failed})` : 'chain run check ok');
process.exit(failed ? 1 : 0);
