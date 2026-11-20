// npm run fresh-clone [-- <source>]
// Clones the repo (default: this checkout) into a temp folder, installs, then runs `npm run demo -- --check`.
// No tests are run. Source can be a local path or a git URL. Set KEEP=1 to keep the clone.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = process.argv[2] || root;
const base = process.env.FRESH_CLONE_DIR || resolve(root, '.tmp');
mkdirSync(base, { recursive: true });
const dir = mkdtempSync(join(base, 'fresh-clone-'));
const target = join(dir, 'repo');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const started = Date.now();

function run(cmd, args, cwd) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' && cmd === npm });
  if (r.status !== 0) {
    console.error(`fresh-clone failed at: ${cmd} ${args.join(' ')}`);
    cleanup();
    process.exit(r.status || 1);
  }
}
function cleanup() {
  if (process.env.KEEP !== '1') rmSync(dir, { recursive: true, force: true });
}

run('git', ['clone', '--quiet', source, target], base);
run(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund'], target);
run(npm, ['run', 'demo', '--', '--check'], target);
cleanup();
const secs = Math.round((Date.now() - started) / 1000);
console.log(`fresh-clone ok in ${secs}s`);
