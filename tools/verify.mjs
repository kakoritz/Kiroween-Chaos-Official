import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';

const DIST = 'packages/arena-ui/dist/index.html';
const quick = process.argv.includes('--quick');

const run = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    maxBuffer: 256 * 1024 * 1024,
  });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

const git = (...a) => run('git', a);

const tail = (out, n = 25) => {
  const lines = out.split('\n').filter((l) => l.trim());
  const hits = lines.filter((l) => /error|fail|✗|×|expected|TS\d+/i.test(l));
  return (hits.length ? hits : lines).slice(-n).join('\n');
};

const freePort = (port) =>
  new Promise((resolve) => {
    const s = createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });

const rows = [];
const record = (name, status, detail = '') => {
  rows.push({ name, status, detail });
  console.log(`${status.padEnd(6)} ${name}${detail ? `  ${detail}` : ''}`);
};

const step = (name, cmd, args, env) => {
  const r = run(cmd, args, env);
  record(name, r.ok ? 'pass' : 'FAIL');
  if (!r.ok) console.log(tail(r.out));
  return r.ok;
};

step('tsc', 'npx', ['tsc', '--noEmit']);

const vt = run('npx', ['vitest', 'run']);
if (vt.ok) {
  const m = vt.out.match(/Tests\s+(?:\d+ failed \| )?(\d+) passed/);
  record('vitest', 'pass', m ? `${m[1]} tests` : '');
} else {
  const files = [...new Set([...vt.out.matchAll(/FAIL\s+([^\s>]+\.test\.\w+)/g)].map((m) => m[1]))];
  if (!files.length) {
    record('vitest', 'FAIL');
    console.log(tail(vt.out));
  } else {
    const again = run('npx', ['vitest', 'run', ...files]);
    if (again.ok) record('vitest', 'flake', `failed in full run, pass alone: ${files.join(', ')}`);
    else {
      record('vitest', 'FAIL', `still failing alone: ${files.join(', ')}`);
      console.log(tail(again.out));
    }
  }
}

step('build:bots', 'npm', ['run', 'build:bots']);
step('judge:check', 'npm', ['run', 'judge:check']);

const distWasDirty = git('status', '--porcelain', '--', DIST).out.trim() !== '';
step('ui:build', 'npm', ['run', 'ui:build']);
if (!distWasDirty && git('status', '--porcelain', '--', DIST).out.trim() !== '') {
  git('checkout', '--', DIST);
  console.log(`       reverted ${DIST} (ui:build rewrites it; do not commit)`);
}

if (!quick) {
  const env = {};
  if (!(await freePort(Number(process.env.HAUNT_PROVIDER_PORT ?? 7071)))) {
    env.HAUNT_PROVIDER_PORT = '17071';
    console.log('       port 7071 busy, using HAUNT_PROVIDER_PORT=17071');
  }
  step('demo --check', 'npm', ['run', 'demo', '--', '--check'], env);
}

const bad = rows.filter((r) => r.status === 'FAIL');
console.log(bad.length ? `\nFAILED: ${bad.map((r) => r.name).join(', ')}` : '\nall green');
process.exit(bad.length ? 1 : 0);
