// npm run demo                    builds the bots if needed, starts the live server on 127.0.0.1 and opens the arena in demo mode (hero).
// npm run demo -- --script=full   story: hero | full | loop (loop also starts the server with --loop so wave 2 runs the hardened bot).
// npm run demo -- --no-open       start the server and print the URL only.
// npm run demo -- --check         starts, verifies the server answers, then exits (used by the fresh-clone test).
// Falls back to the mock server when live is missing. Binds 127.0.0.1 only; Ctrl+C stops everything.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const check = args.includes('--check');
const noOpen = args.includes('--no-open');
const scriptArg = args.find((a) => a.startsWith('--script='))?.slice('--script='.length) ?? (args.includes('--loop') ? 'loop' : 'hero');
if (!['hero', 'full', 'loop'].includes(scriptArg)) {
  console.error(`unknown demo script "${scriptArg}" (use hero, full or loop)`);
  process.exit(2);
}
// --check picks a free port unless HAUNT_PORT is set, so a foreign server on 7070 cannot answer in place of ours.
const freePort = () => new Promise((ok, bad) => { const s = createServer(); s.once('error', bad); s.listen(0, '127.0.0.1', () => { const { port: p } = s.address(); s.close(() => ok(String(p))); }); });
const port = process.env.HAUNT_PORT || (check ? await freePort() : '7070');
const base = `http://127.0.0.1:${port}`;
const liveSrc = resolve(root, 'packages/core/src/bin/live.ts');
const mockSrc = resolve(root, 'packages/core/src/bin/mock.ts');
const useLive = existsSync(liveSrc);
const entry = useLive ? liveSrc : mockSrc;
if (!existsSync(entry)) {
  console.log('Neither the live server nor the mock server exists yet.');
  process.exit(check ? 1 : 0);
}

function run(file, extra, stdio) {
  return spawn(process.execPath, [file, ...extra], {
    cwd: root, stdio, windowsHide: true, env: { ...process.env, HAUNT_PORT: port },
  });
}

if (useLive && !existsSync(resolve(root, 'dist/bots/rookie.js'))) {
  console.log('Building the bots (first run)...');
  const code = await new Promise((done) => run(resolve(root, 'tools/build-bots.mjs'), [], 'inherit').on('exit', done));
  if (code !== 0) { console.error('build:bots failed'); process.exit(1); }
}

// The server serves packages/arena-ui/dist. A stale or empty dist (index.html without assets) shows a blank page, so build the UI first.
if (!existsSync(resolve(root, 'packages/arena-ui/dist/assets'))) {
  console.log('Building the arena UI (first run)...');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const code = await new Promise((done) => spawn(npm, ['run', 'ui:build'], { cwd: root, stdio: 'inherit', windowsHide: true, shell: process.platform === 'win32' }).on('exit', done));
  if (code !== 0) console.error('ui:build failed: the arena page may be blank');
}

const child = run(resolve(root, 'tools/run-ts.mjs'), [entry, ...(useLive && scriptArg === 'loop' ? ['--loop'] : [])], ['ignore', 'inherit', 'inherit']);
const stop = () => { if (!child.killed) child.kill(); };
process.on('SIGINT', () => { stop(); process.exit(0); });
process.on('SIGTERM', () => { stop(); process.exit(0); });
let childExit = null;
child.on('exit', (code) => { childExit = code ?? 1; if (!check) process.exit(code ?? 0); });

async function waitHealth() {
  for (let i = 0; i < 100; i++) {
    if (childExit !== null) throw new Error(`server exited with code ${childExit} before answering (is port ${port} already in use?)`);
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) return await r.json();
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not answer /api/health');
}

try {
  const health = await waitHealth();
  if (check) {
    const page = await fetch(`${base}/`);
    if (!page.ok) throw new Error(`GET / answered ${page.status}`);
    console.log(`demo check ok (mode ${health.mode}, contract ${health.contractVersion})`);
    stop();
    process.exit(0);
  }
  const url = `${base}/?demo=${scriptArg}`;
  console.log(`Arena (${health.mode}, story ${scriptArg}): ${url}`);
  if (noOpen) console.log('Press Ctrl+C to stop.');
  else {
    const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    spawn(opener[0], opener[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
    console.log('Press Ctrl+C to stop.');
  }
} catch (e) {
  console.error(String(e));
  stop();
  process.exit(1);
}
