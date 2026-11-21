import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareReports, parseReport, postmortemScore, renderMarkdown, signed } from '../src/report/model';

const proof = (f: string) => readFileSync(new URL(`../../../docs/proof/${f}`, import.meta.url), 'utf8');
const w1 = parseReport(JSON.parse(proof('wave1-report.json')));
const w2 = parseReport(JSON.parse(proof('wave2-report.json')));

describe('report viewer model', () => {
  it('rejects things that are not reports', () => {
    expect(() => parseReport(null)).toThrow();
    expect(() => parseReport({ grade: 'A' })).toThrow();
  });
  it('reads wave scores from the postmortem header', () => {
    expect(postmortemScore(proof('wave1-postmortem.md'))).toBe(-229);
    expect(postmortemScore(proof('wave2-postmortem.md'))).toBe(702);
    expect(postmortemScore('no score')).toBeNull();
  });
  it('compares wave 1 to wave 2 like the loop proof', () => {
    const c = compareReports(w1, w2, -229, 702);
    expect([c.gradeBefore, c.gradeAfter, c.gradeTrend]).toEqual(['F', 'A', 'improved']);
    expect([c.repeatsBefore, c.repeatsAfter, c.lostBefore, c.lostAfter]).toEqual([5, 0, 0, 0]);
    expect(c.scoreDelta).toBe(931);
    expect(c.findings.resolved.map((f) => f.id)).toEqual(['F1', 'F2', 'F3', 'F4', 'F5']);
    expect(c.findings.remaining).toEqual([]);
    expect(c.findings.added).toEqual([]);
    expect(c.tiers.find((t) => t.tier === '1')?.trend).toBe('improved');
    expect(c.tiers.find((t) => t.tier === '2')?.trend).toBe('same');
  });
  it('marks repeat to pass as improved and the reverse as worsened', () => {
    const c = compareReports(w1, w2);
    expect(c.cells[0]).toMatchObject({ before: 'repeat', after: 'pass', trend: 'improved' });
    expect(compareReports(w2, w1).cells[0]!.trend).toBe('worsened');
  });
  it('formats deltas and escapes markdown', () => {
    expect(signed(5)).toBe('+5');
    expect(signed(-5)).toBe('-5');
    expect(renderMarkdown('# T\n\n- <b>x</b> `c`')).toBe('<h2>T</h2><ul><li>&lt;b&gt;x&lt;/b&gt; <code>c</code></li></ul>');
  });
});
