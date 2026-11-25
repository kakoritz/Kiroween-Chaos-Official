// Headless Chrome check of the built hosted demo (npm run build:hosted first):
//   node tools/hosted-check.mjs [--shots=docs/proof/hosted] [--base=/Kiroween-Chaos/]
// Serves dist/hosted over http (like Pages), loads it, and fails unless a populated arena shows within 10 s
// (lanes with orders in the in-page engine state, a canvas, the hosted banner). Then it starts the recorded tournament
// and checks a round card or a fallen lane appears. Also samples frames of a full demo pass: no creature-free stretch over 5 s. Writes screenshots when --shots is given.
// Chrome: CHROME env or the usual install paths (CHROME_NO_SANDBOX=1 adds --no-sandbox for hosts without user namespaces). Binds 127.0.0.1 only.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const shots = args.find((a) => a.startsWith('--shots='))?.slice(8);
let base = args.find((a) => a.startsWith('--base='))?.slice(7) ?? '/';
if (!base.endsWith('/')) base += '/';
const chrome = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => p && existsSync(p));
if (!chrome) { console.error('Chrome not found (set CHROME)'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sPort = 18080 + Math.floor(Math.random() * 500);
const cPort = 19300 + Math.floor(Math.random() * 500);

const server = spawn(process.execPath, [resolve(root, 'tools/serve-hosted.mjs'), String(sPort), `--base=${base}`], { stdio: 'ignore', windowsHide: true });
const prof = mkdtempSync(join(tmpdir(), 'haunt-hosted-'));
const proc = spawn(chrome, [...(process.env.CHROME_NO_SANDBOX ? ['--no-sandbox'] : []), '--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${cPort}`, '--window-size=1600,900', `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
const cleanup = () => { try { proc.kill(); } catch { /* gone */ } try { server.kill(); } catch { /* gone */ } setTimeout(() => { try { rmSync(prof, { recursive: true, force: true }); } catch { /* locked */ } }, 800); };
let failed = false;
const fail = (m) => { failed = true; console.error('FAIL: ' + m); };

try {
  let tabs;
  for (let i = 0; i < 50; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${cPort}/json`)).json(); break; } catch { await sleep(200); } }
  const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0;
  const pend = {};
  const errors = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pend[d.id]) pend[d.id](d.result ?? d.error);
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails?.exception?.description ?? d.params.exceptionDetails?.text);
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value;
  const shot = async (name) => {
    if (!shots) return;
    mkdirSync(resolve(root, shots), { recursive: true });
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(resolve(root, shots, name), Buffer.from(r.data, 'base64'));
    console.log('screenshot', name);
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  const t0 = Date.now();
  await send('Page.navigate', { url: `http://127.0.0.1:${sPort}${base}` });

  // 1. A populated arena within 10 s.
  let populated = false;
  while (Date.now() - t0 < 10_000) {
    populated = await ev(`(async()=>{try{const h=window.__haunt;if(!h)return false;const s=await h.getState();return !!document.querySelector('canvas')&&s.lanes.some(l=>l.order!==null&&l.state!=='idle')}catch(e){return false}})()`);
    if (populated) break;
    await sleep(250);
  }
  const took = Date.now() - t0;
  if (!populated) fail('no populated arena within 10 s');
  else console.log(`populated arena after ${took} ms`);
  await sleep(1500);
  await shot('hosted-splash-over-arena.png');
  await ev(`document.getElementById('splash-skip')?.click()`);
  await sleep(1200);
  await shot('hosted-arena.png');
  const banner = await ev(`document.getElementById('hosted-badge')?.textContent ?? ''`);
  if (!/hosted demo/i.test(banner)) fail('hosted banner missing');
  const mode = await ev(`(async()=>(await window.__haunt.getHealth()).mode)()`);
  if (mode !== 'browser') fail('mode is ' + mode);
  const text = await ev(`document.body.innerText`);
  if (/Wave 4|\\bMOCK\\b/.test(text)) fail('old MOCK / Wave 4 state visible');

  // 1b. Frame sampling: a demo pass at 2x (first 60 s) must never leave the lanes without a creature for more than 5 s (a recorded run can sit quiet for a minute).
  {
    await ev(`window.__haunt.stopDemo()`);
    await sleep(500);
    await ev(`window.__haunt.startDemo('full', 2)`);
    const MAX_QUIET_MS = 5000;
    const SAMPLE_MS = 60_000;
    const tS = Date.now();
    let quietFrom = null, worst = 0, worstAt = 0, frames = 0, seen = 0, ended = false;
    while (Date.now() - tS < SAMPLE_MS) {
      const r = await ev(`(()=>{const a=window.__arena;if(!a)return null;const vm=a.vm;return {run:vm.running,n:vm.lanes.reduce((s,l)=>s+(l.creatures||[]).length,0)}})()`);
      const now = Date.now();
      if (r) {
        frames++;
        if (!r.run) { ended = true; break; }
        if (r.n > 0) { seen++; quietFrom = null; } else { quietFrom ??= now; if (now - quietFrom > worst) { worst = now - quietFrom; worstAt = Math.round((quietFrom - tS) / 1000); } }
      }
      await sleep(250);
    }
    console.log(`demo=full frames: ${frames} sampled, ${seen} with creatures, longest creature-free stretch ${worst} ms (from ${worstAt} s)${ended ? ' (pass ended)' : ''}`);
    if (frames < 20) fail('frame sampling saw too few frames');
    else if (seen === 0) fail('no creature in any sampled frame of the full demo');
    else if (worst > MAX_QUIET_MS) fail(`creature-free stretch of ${worst} ms in the full demo (limit ${MAX_QUIET_MS} ms)`);
    await ev(`window.__haunt.stopDemo()`);
    for (let i = 0; i < 20 && await ev(`(async()=>(await window.__haunt.getState()).wave?.running===true)()`); i++) { await ev(`window.__haunt.stopDemo()`); await sleep(500); }
  }

  // 2. The recorded tournament plays (round card, standings or a fallen lane) without a server.
  // Through the real button, as a visitor would (a direct stopWave would let the page chain the next demo over it).
  const clicked = await ev(`(()=>{const b=document.getElementById('tour-big');if(!b)return false;b.click();return true})()`);
  if (!clicked) fail('Start tournament button missing');
  let round = false;
  const t1 = Date.now();
  while (Date.now() - t1 < 90_000) {
    round = await ev(`(async()=>{const t=await window.__haunt.getTournament();return t.phase==='awaiting_next'||t.phase==='review'})()`);
    if (round) break;
    await sleep(500);
  }
  if (!round) fail('tournament round never ended');
  await sleep(2500);
  await shot('hosted-tournament.png');
  const cb = await ev(`(async()=>{const c=await window.__haunt.getCasebook();return (c.cases?.length??0)+(c.open?.length??0)+(c.awards?.length??0)})()`);
  console.log('casebook entries after round 1:', cb);
  const real = errors.filter((e) => e && !/favicon/i.test(e));
  if (real.length) fail('page errors: ' + real.slice(0, 3).join(' | '));
} catch (e) {
  fail(String(e?.stack ?? e));
} finally {
  cleanup();
}
console.log(failed ? 'hosted check FAILED' : 'hosted check ok');
process.exit(failed ? 1 : 0);
