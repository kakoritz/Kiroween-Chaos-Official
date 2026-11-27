// Checks behind `npm run submit:check`. Each takes a repo folder and returns { name, ok, detail }. Plain Node, no dependencies.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const res = (name, ok, detail = '') => ({ name, ok, detail });
const SKIP_FILES = new Set(['package-lock.json']);
const SAFE_EMAIL = /(noreply|example\.(com|org|test)|\.test$)/i;
const PERSONAL = /gmail\.com|outlook\.com|aspiker|deckedout|\/home\/[a-z0-9_-]+\/|C:\\Users\\/i;

/** Every commit author and committer email is a noreply address (GitHub's, or a bot's). */
export function checkAuthors(dir) {
  const out = git(dir, 'log', '--all', '--format=%ae%n%ce').split('\n').filter(Boolean);
  const bad = [...new Set(out.filter((e) => !/noreply/i.test(e)))];
  return res('commit emails are all noreply', bad.length === 0, bad.length ? `${bad.length} other address(es) in history` : `${new Set(out).size} address(es), all noreply`);
}

/** Tracked text files hold no personal address, name, or home path. Lines that are the guard itself (a pattern in a test) are allowed. */
export function checkFiles(dir) {
  const hits = [];
  for (const f of git(dir, 'ls-files', '-z').split('\0').filter(Boolean)) {
    if (SKIP_FILES.has(f)) continue;
    const p = join(dir, f);
    let size; try { size = statSync(p).size; } catch { continue; }
    if (size > 2_000_000) continue;
    const buf = readFileSync(p);
    if (buf.includes(0)) continue;
    buf.toString('utf8').split('\n').forEach((line, i) => {
      if (PERSONAL.test(line) && !/toMatch|RegExp|\.test\(|PERSONAL\s*=/.test(line)) hits.push(`${f}:${i + 1}`);
      for (const m of line.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) if (!SAFE_EMAIL.test(m[0]) && !/^@/.test(m[0]) && !/^[a-z0-9-]+@[0-9]/i.test(m[0])) hits.push(`${f}:${i + 1} ${m[0]}`);
    });
  }
  return res('files hold no personal info', hits.length === 0, hits.length ? hits.slice(0, 5).join('; ') : 'no personal address, name or home path in tracked files');
}

/** History never added a personal string (a line in a test that only names the pattern is allowed). The one test of this check is skipped: commit 011c0c3 added fake fixtures to it, before they were built at run time. */
export function checkHistory(dir) {
  const found = [];
  const revs = git(dir, 'log', '--all', '-i', '-G', 'gmail\\.com|outlook\\.com|aspiker|deckedout|/home/[a-z0-9_-]+/', '--format=%h').split('\n').filter(Boolean);
  for (const h of revs) {
    const added = git(dir, 'show', h, '--format=', '-U0', '--', '.', ':!packages/haunt/test/submit-check.test.ts').split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++') && PERSONAL.test(l) && !/toMatch|RegExp|\.test\(|PERSONAL\s*=/.test(l));
    if (added.length) found.push(h);
  }
  return res('history never added personal info', found.length === 0, found.length ? `commits: ${found.slice(0, 5).join(' ')}` : `${revs.length} commit(s) mention the words only inside a guard pattern`);
}

/** Relative links in the README and docs point at files that exist. */
export function checkLinks(dir) {
  const md = [];
  const walk = (d) => { for (const n of readdirSync(d)) { if (n === 'node_modules' || n === '.git' || n === 'dist') continue; const p = join(d, n); const s = statSync(p); if (s.isDirectory()) { if (['docs', 'contract', 'kiro-power', 'examples', 'kiro-crew-app'].includes(n) || d !== dir) walk(p); } else if (n.endsWith('.md')) md.push(p); } };
  for (const n of readdirSync(dir)) if (n.endsWith('.md')) md.push(join(dir, n));
  walk(dir);
  const broken = [];
  for (const f of new Set(md)) {
    const text = readFileSync(f, 'utf8').replace(/```[\s\S]*?```/g, '');
    for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const t = m[1].split('#')[0];
      if (!t || /^(https?:|mailto:|data:)/.test(t)) continue;
      if (!existsSync(resolve(dirname(f), decodeURIComponent(t)))) broken.push(`${f.replace(dir + '/', '')} -> ${t}`);
    }
  }
  return res('relative links in the docs resolve', broken.length === 0, broken.length ? `${broken.length} broken: ${broken.slice(0, 4).join('; ')}` : `${new Set(md).size} markdown files checked`);
}

/** Size: recorded runs under 6 MB, no tracked file over 5 MB outside them, the whole repo under 200 MB. */
export function checkSizes(dir) {
  const files = git(dir, 'ls-files', '-z').split('\0').filter(Boolean);
  let total = 0, rec = 0; const big = [];
  for (const f of files) { let s; try { s = statSync(join(dir, f)).size; } catch { continue; } total += s; if (f.startsWith('site/recorded/')) rec += s; else if (s > 5_000_000) big.push(`${f} ${(s / 1e6).toFixed(1)} MB`); }
  const ok = rec <= 6 * 1024 * 1024 && big.length === 0 && total < 200 * 1024 * 1024;
  return res('sizes are within limits', ok, `repo ${(total / 1e6).toFixed(1)} MB, recorded runs ${(rec / 1e6).toFixed(1)} of 6.3 MB${big.length ? ', big: ' + big.join(', ') : ''}`);
}

/** The pieces a judge looks for are there. */
export function checkDeliverables(dir) {
  const need = ['README.md', 'LICENSE', '.kiro', 'docs/JUDGE-CHECK.md', 'docs/INTEGRATE.md', 'contract/V1_4.md', 'kiro-power', 'kiro-crew-app', 'site/recorded/tournament.json', 'examples/pizza-shop/haunt.yaml'];
  const miss = need.filter((n) => !existsSync(join(dir, n)));
  return res('required files are present', miss.length === 0, miss.length ? `missing: ${miss.join(', ')}` : `${need.length} paths found`);
}

/** The working tree is clean, on main, and the same as origin/main. */
export function checkGitState(dir) {
  const dirty = git(dir, 'status', '--porcelain').trim();
  const branch = git(dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
  let ahead = '?';
  try { ahead = git(dir, 'rev-list', '--left-right', '--count', 'HEAD...origin/main').trim().replace(/\s+/, '/'); } catch { /* no remote */ }
  const ok = !dirty && branch === 'main' && (ahead === '0/0' || ahead === '?');
  return res('git: clean, on main, pushed', ok, `${dirty ? 'uncommitted changes; ' : ''}branch ${branch}; ahead/behind ${ahead}`);
}

export const OFFLINE_CHECKS = [checkGitState, checkAuthors, checkFiles, checkHistory, checkLinks, checkSizes, checkDeliverables];
