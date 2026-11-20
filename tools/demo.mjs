// npm run demo            builds if needed, starts the server (mock until live exists) and opens the arena in demo mode.
// npm run demo -- --check starts, verifies the server answers, then exits (used by the fresh-clone test).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const check = process.argv.includes('--check');
const port = process.env.HAUNT_PORT || '7070';
const base = `http://127.0.0.1:${port}`;
const mockSrc = resolve(root, 'packages/core/src/bin/mock.ts');
if (!existsSync(mockSrc)) {
  console.log('The mock server is not implemented yet (task H0.7).');
  process.exit(check ? 1 : 0);
}
const child = spawn(process.execPath, [resolve(root, 'tools/run-ts.mjs'), mockSrc], {
  cwd: root,
  stdio: ['ignore', 'inherit', 'inherit'],
  env: { ...process.env, HAUNT_PORT: port },
  windowsHide: true,
});
const stop = () => child.kill();
process.on('SIGINT', () => { stop(); process.exit(0); });

async function waitHealth() {
  for (let i = 0; i < 100; i++) {
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
  const url = `${base}/?demo=hero`;
  console.log(`Arena: ${url}`);
  const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(opener[0], opener[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
} catch (e) {
  console.error(String(e));
  stop();
  process.exit(1);
}
