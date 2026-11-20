import { describe, expect, it } from 'vitest';
import { buildReport, compareWaves, renderProofMarkdown, type Finding, type ReportInput } from '../src/report';

const finding = (id: string): Finding => ({
  id, rule: 'R1', severity: 'high', stage: 'pay', fault: 'crash', summary: id, evidenceSeq: [1], suggestedPart: 'journal',
});

const base: ReportInput = {
  run: 'r1', mode: 'sweep', seed: 7, app: 'orders', generatedAt: 't',
  grade: 'F', reliability: 20, matrix: [], recoveryMs: [], repeats: [], lost: [], targets: [], findings: [],
};

describe('loop proof compare', () => {
  const w1 = buildReport({
    ...base,
    repeats: [{ order: 'o1', kind: 'charge', extra: 1, stage: 'pay', fault: 'crash' }],
    lost: [{ order: 'o2', reason: 'paid_not_fulfilled' }],
    findings: [finding('F1'), finding('F2')],
  });
  const w2 = buildReport({ ...base, run: 'r2', grade: 'A', reliability: 95, findings: [finding('F2'), finding('F3')] });

  it('reports the grade rise and finding changes', () => {
    const d = compareWaves(w1, w2);
    expect(d.improved).toBe(true);
    expect([d.gradeBefore, d.gradeAfter]).toEqual(['F', 'A']);
    expect([d.repeatsBefore, d.repeatsAfter, d.lostBefore, d.lostAfter]).toEqual([1, 0, 1, 0]);
    expect(d.resolvedFindings).toEqual(['F1']);
    expect(d.remainingFindings).toEqual(['F2']);
    expect(d.newFindings).toEqual(['F3']);
  });

  it('is not improved when the grade does not rise', () => {
    expect(compareWaves(w2, w1).improved).toBe(false);
    expect(compareWaves(w1, w1).improved).toBe(false);
  });

  it('renders markdown', () => {
    const md = renderProofMarkdown(compareWaves(w1, w2));
    expect(md).toContain('| Grade | F | A |');
    expect(md).toContain('Improved: yes');
  });
});
