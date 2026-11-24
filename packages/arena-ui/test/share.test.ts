import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { README_SNIPPET, readmeSnippet, shareFiles } from '../src/share/share-model';

const proof = (f: string) => JSON.parse(readFileSync(new URL(`../../../docs/proof/${f}`, import.meta.url), 'utf8'));

describe('share model (SH-U2)', () => {
  it('builds the badge, scorecard svg and scorecard html', () => {
    const files = shareFiles(proof('wave2-report.json'));
    expect(files.map((f) => f.name)).toEqual(['haunt-badge.svg', 'haunt-scorecard.svg', 'haunt-scorecard.html']);
    expect(files[0]!.text).toContain('<svg');
    expect(files[0]!.mime).toBe('image/svg+xml');
    expect(files[2]!.mime).toBe('text/html');
  });
  it('is deterministic: same report, same bytes', () => {
    const r = proof('wave1-report.json');
    expect(shareFiles(r)).toEqual(shareFiles(r));
  });
  it('uses the README snippet from the spec', () => {
    expect(README_SNIPPET).toBe('![Kiroween Chaos grade](./haunt-badge.svg)');
    expect(readmeSnippet()).toBe(README_SNIPPET);
  });
});
