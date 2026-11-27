// covers: npm run submit:check (fourth build list item 3). Each check is run on a small real git repo made for the test.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs helper
import { checkAuthors, checkFiles, checkHistory, checkLinks, checkSizes, checkDeliverables, checkGitState } from '../../../tools/lib/submit-checks.mjs';

const sh = (dir: string, ...a: string[]) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
function repo(email = '1+u@users.noreply.github.com') {
  const d = mkdtempSync(join(tmpdir(), 'sc-'));
  sh(d, 'init', '-q', '-b', 'main');
  sh(d, 'config', 'user.email', email); sh(d, 'config', 'user.name', 'u');
  return d;
}
const commit = (d: string, files: Record<string, string>, msg = 'c') => {
  for (const [f, t] of Object.entries(files)) { mkdirSync(join(d, f, '..'), { recursive: true }); writeFileSync(join(d, f), t); }
  sh(d, 'add', '-A'); sh(d, 'commit', '-q', '-m', msg);
};

describe('submit checks', () => {
  it('authors: noreply passes, another address fails', () => {
    const ok = repo(); commit(ok, { 'a.txt': 'x' });
    expect(checkAuthors(ok).ok).toBe(true);
    const bad = repo('someone@mail.example.net'); commit(bad, { 'a.txt': 'x' });
    expect(checkAuthors(bad).ok).toBe(false);
  });
  it('files: a personal address, name or home path fails; a guard pattern and example.test pass', () => {
    const ok = repo(); commit(ok, { 'a.md': 'mail dana@example.test\n', 't.ts': "expect(x).not.toMatch(/gmail|aspiker/)\n" });
    expect(checkFiles(ok).ok).toBe(true);
    for (const line of ['reach me at jo@gmail.com', 'see /home/jo/project/x', 'by aspiker', 'a@b.org']) {
      const d = repo(); commit(d, { 'a.md': line + '\n' });
      expect(checkFiles(d).ok, line).toBe(false);
    }
  });
  it('history: a removed personal string still fails; a guard pattern passes', () => {
    const d = repo(); commit(d, { 'a.md': 'jo@gmail.com\n' }); commit(d, { 'a.md': 'clean\n' });
    expect(checkFiles(d).ok).toBe(true);
    expect(checkHistory(d).ok).toBe(false);
    const g = repo(); commit(g, { 't.ts': "expect(x).not.toMatch(/gmail\\.com|aspiker/)\n" });
    expect(checkHistory(g).ok).toBe(true);
  });
  it('links: a missing target is named', () => {
    const d = repo(); commit(d, { 'README.md': '[a](docs/A.md) [b](https://x.test) [c](#top)\n', 'docs/A.md': 'ok\n' });
    expect(checkLinks(d).ok).toBe(true);
    commit(d, { 'README.md': '[a](docs/NOPE.md)\n' });
    const r = checkLinks(d);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('docs/NOPE.md');
  });
  it('sizes, deliverables and git state', () => {
    const d = repo(); commit(d, { 'a.txt': 'x' });
    expect(checkSizes(d).ok).toBe(true);
    expect(checkDeliverables(d).ok).toBe(false);
    expect(checkGitState(d).ok).toBe(true);
    writeFileSync(join(d, 'a.txt'), 'changed');
    expect(checkGitState(d).ok).toBe(false);
  });
});
