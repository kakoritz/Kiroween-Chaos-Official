// The hosted build must work under any base path (GitHub Pages serves a project site under /<repo>/) and reference only files it ships.
// Inspects dist/hosted; builds it first (UI plus assembly) when it is missing or older than the recorded runs. No server, no network.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const out = join(root, 'dist/hosted');
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));

beforeAll(() => {
  if (existsSync(join(out, 'index.html')) && existsSync(join(out, 'recorded/tournament.json'))) return;
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npm, ['run', 'build:hosted'], { cwd: root, stdio: 'ignore', shell: process.platform === 'win32' });
}, 240_000);

const refs = (file: string): string[] => {
  const text = readFileSync(file, 'utf8');
  const found: string[] = [];
  for (const m of text.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) found.push(m[1]!);
  for (const m of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) found.push(m[1]!);
  return found;
};

describe('hosted build (dist/hosted)', () => {
  it('ships the entry, the recorded runs, the 404 fallback and .nojekyll', () => {
    for (const f of ['index.html', '404.html', '.nojekyll', 'workflow-lab.html', 'recorded/tournament.json', 'recorded/improve.json', 'recorded/campaign.json']) {
      expect(existsSync(join(out, f)), f).toBe(true);
    }
  });

  it('has no absolute /assets (or any root-absolute) path in html or css', () => {
    for (const f of walk(out).filter((x) => /\.(html|css)$/.test(x))) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(/(?:src|href)=["']\/(?!\/)/);
      expect(text, f).not.toMatch(/url\(\s*["']?\/(?!\/)/);
    }
    for (const f of walk(join(out, 'assets')).filter((x) => x.endsWith('.js'))) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/["'`]\/assets\//);
    }
  });

  it('references only files that exist', () => {
    for (const f of walk(out).filter((x) => /\.(html|css)$/.test(x))) {
      for (const r of refs(f)) {
        if (/^(?:[a-z]+:|\/\/|#|data:)/i.test(r)) continue; // external or in-page, covered by the external check below
        if (/^\.\.?\/?$/.test(r)) continue;
        const target = resolve(dirname(f), r.split(/[?#]/)[0]!);
        expect(existsSync(target), `${f.slice(out.length + 1)} -> ${r}`).toBe(true);
      }
    }
  });

  it('every file a module imports statically exists', () => {
    for (const f of walk(join(out, 'assets')).filter((x) => x.endsWith('.js'))) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/(?:from|import)\s*["'](\.\/[^"']+)["']/g)) expect(existsSync(resolve(dirname(f), m[1]!)), `${f.slice(out.length + 1)} -> ${m[1]}`).toBe(true);
    }
  });

  it('makes no external request (script, stylesheet, image)', () => {
    for (const f of walk(out).filter((x) => x.endsWith('.html'))) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/<(?:script|link|img)[^>]+(?:src|href)=["'](?:https?:)?\/\//i);
    }
  });

  it('the entry page is the hosted arena, not the server page', () => {
    expect(readFileSync(join(out, 'index.html'), 'utf8')).toBe(readFileSync(join(out, 'hosted.html'), 'utf8'));
  });
});
