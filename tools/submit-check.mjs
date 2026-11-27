// `npm run submit:check [-- --quick] [--online]`: the last look before submitting. Offline checks of the repo and its history, then `npm run verify`.
//   --quick   skip `npm run verify`
//   --online  also ask GitHub (needs `gh`): the repo is public, and the Pages site answers 200
// Exit 1 when anything fails. It changes nothing.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { OFFLINE_CHECKS } from './lib/submit-checks.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const quick = process.argv.includes('--quick'), online = process.argv.includes('--online');
const rows = [];
const show = (r) => { rows.push(r); console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`); };
for (const c of OFFLINE_CHECKS) { try { show(c(root)); } catch (e) { show({ name: c.name, ok: false, detail: String(e.message ?? e).split('\n')[0] }); } }
if (online) {
  const gh = (...a) => spawnSync('gh', a, { encoding: 'utf8', cwd: root });
  const info = gh('repo', 'view', '--json', 'visibility,url,homepageUrl');
  if (info.status !== 0) show({ name: 'GitHub: repo is public', ok: false, detail: 'gh could not read the repo' });
  else {
    const j = JSON.parse(info.stdout);
    show({ name: 'GitHub: repo is public', ok: j.visibility === 'PUBLIC', detail: `${j.visibility} ${j.url}` });
    const owner = j.url.split('/').slice(-2);
    const page = `https://${owner[0]}.github.io/${owner[1]}/`;
    try { const r = await fetch(page); show({ name: 'GitHub Pages answers 200', ok: r.status === 200, detail: `${r.status} ${page}` }); } catch (e) { show({ name: 'GitHub Pages answers 200', ok: false, detail: String(e.message) }); }
  }
}
if (!quick) {
  const v = spawnSync('npm', ['run', 'verify'], { encoding: 'utf8', cwd: root, maxBuffer: 256 * 1024 * 1024 });
  show({ name: 'npm run verify is green', ok: v.status === 0, detail: v.status === 0 ? 'tsc, tests, bots, judge check, ui build, demo check' : (v.stdout + v.stderr).split('\n').filter((l) => /FAIL|error/i.test(l)).slice(0, 3).join(' | ') });
}
const bad = rows.filter((r) => !r.ok);
console.log(bad.length ? `\n${bad.length} check(s) failed. Fix them before you submit.` : '\nAll checks passed.');
process.exit(bad.length ? 1 : 0);
