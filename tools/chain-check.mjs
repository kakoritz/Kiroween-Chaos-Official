// Headless Chrome check of the Chain Wizard page (needs `npm run ui:build`): the tour, "Save as block", the protection switches, the example chains.
//   node tools/chain-check.mjs        (CHROME env or the usual install paths; CHROME_NO_SANDBOX=1 adds --no-sandbox). Binds 127.0.0.1 only.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const chrome = [process.env.CHROME, '/usr/bin/google-chrome', '/usr/bin/chromium', ...['1255', '1228'].map((v) => `${process.env.HOME}/.cache/ms-playwright/chromium-${v}/chrome-linux64/chrome`), 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find((p) => p && existsSync(p));
if (!chrome) { console.error('Chrome not found (set CHROME)'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sPort = 18700 + Math.floor(Math.random() * 200), cPort = 19700 + Math.floor(Math.random() * 200);
// The built UI (npm run ui:build) served as plain files, like any static host.
const server = spawn(process.execPath, ['-e', `const h=require('http'),f=require('fs'),p=require('path');const R=${JSON.stringify(resolve(root, 'packages/arena-ui/dist'))};const T={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};h.createServer((q,r)=>{const u=p.join(R,decodeURIComponent(q.url.split('?')[0]));if(!u.startsWith(R)||!f.existsSync(u)||f.statSync(u).isDirectory()){r.statusCode=404;return r.end('no');}r.setHeader('content-type',T[p.extname(u)]||'application/octet-stream');f.createReadStream(u).pipe(r)}).listen(${sPort},'127.0.0.1')`], { stdio: 'ignore' });
const prof = mkdtempSync(join(tmpdir(), 'haunt-chain-'));
const proc = spawn(chrome, [...(process.env.CHROME_NO_SANDBOX || process.getuid?.() !== 0 ? ['--no-sandbox'] : []), '--headless=new', '--disable-gpu', `--remote-debugging-port=${cPort}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + String(detail).slice(0, 200) : ''}`); };
try {
  await sleep(2500);
  const tabs = await (await fetch(`http://127.0.0.1:${cPort}/json`)).json();
  const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = {}; const errors = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend[d.id]) pend[d.id](d.result); if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails?.exception?.description ?? 'error'); };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.value;
  await send('Runtime.enable'); await send('Page.enable');
  const go = async (path) => { await send('Page.navigate', { url: `http://127.0.0.1:${sPort}/${path}` }); await sleep(3500); };
  const click = (label) => ev(`[...document.querySelectorAll('button')].find(b=>b.textContent==='${label}')?.click()`);
  await go('chain.html?blocks=read_request,charge');
  // tour
  await click('Take the tour');
  check('tour opens on step 1 and lights the library', (await ev(`document.querySelector('.ch-tour-hl')?.getAttribute('aria-label')`)) === 'Block library');
  const seen = [];
  for (let i = 0; i < 5; i++) { await ev(`[...document.querySelectorAll('.ch-tour button')].find(b=>b.textContent==='Next').click()`); seen.push(await ev(`!!document.querySelector('.ch-tour-hl')`)); }
  check('tour steps 2 to 6 each light a part of the page', seen.every(Boolean), seen.join());
  await ev(`[...document.querySelectorAll('.ch-tour button')].find(b=>b.textContent==='Done').click()`);
  check('tour closes and lights nothing', (await ev(`document.querySelector('.ch-tour').hidden`)) === true && (await ev(`!!document.querySelector('.ch-tour-hl')`)) === false);
  // save as block
  await ev(`(()=>{const i=document.querySelector('input[placeholder="custom_stage"]');i.value='tea_time';const s=i.nextElementSibling;s.value='effect';s.dispatchEvent(new Event('change'));[...document.querySelectorAll('button')].find(b=>b.textContent==='Add my own block').click()})()`);
  await sleep(1200);
  await click('Save as block');
  await sleep(1200);
  check('Save as block says it saved', /Saved "tea_time"/.test(await ev(`document.querySelector('.ch-status')?.textContent ?? ''`)));
  check('the new block is in the library as (mine)', /tea time \(mine\)/.test(await ev(`[...document.querySelectorAll('.ch-lib button')].map(b=>b.textContent).join()`)));
  await go('chain.html');
  check('and it is still there after a reload', /tea time \(mine\)/.test(await ev(`[...document.querySelectorAll('.ch-lib button')].map(b=>b.textContent).join()`)));
  // protections move the grade
  await go('chain.html?blocks=read_request,charge,wait_for_callback,notify&run=1');
  const grade = async () => (await ev(`document.body.innerText.match(/grade ([A-F])/i)?.[1] ?? '?'`));
  const g0 = await grade();
  for (let i = 0; i < 5; i++) { await ev(`(()=>{const c=document.querySelectorAll('.ch-toggle input')[${i}];c.checked=true;c.dispatchEvent(new Event('change'))})()`); await sleep(1500); }
  const g1 = await grade();
  check('all five protections on: the grade goes up', g0 !== g1 && g1 <= g0, `${g0} -> ${g1}`);
  check('page errors', errors.length === 0, errors.join(' | '));
} catch (e) { failed++; console.log('FAIL  check crashed', e); } finally {
  proc.kill(); server.kill(); setTimeout(() => { try { rmSync(prof, { recursive: true, force: true }); } catch { /* locked */ } }, 800);
}
console.log(failed ? `chain check FAILED (${failed})` : 'chain check ok');
process.exit(failed ? 1 : 0);
