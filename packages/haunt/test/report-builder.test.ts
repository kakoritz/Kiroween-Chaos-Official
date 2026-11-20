import { describe, expect, it } from 'vitest';
import { buildReport, renderHtml, renderJson, renderJsonStable, renderMarkdown, type ReportInput } from '../src/report';

const input: ReportInput = {
  run: 'run-20261120-120000-7',
  mode: 'sweep',
  seed: 7,
  app: 'orders <demo>',
  generatedAt: '2026-11-20T12:00:00Z',
  grade: 'C',
  reliability: 72.5,
  scalability: 'B',
  matrix: [
    { stage: 'pay', fault: 'crash', point: 'after', result: 'repeat', repeats: [{ kind: 'charge', extra: 1 }], evidenceSeq: [4, 5] },
    { stage: 'intake', fault: 'missing_file', result: 'pass', repeats: [], recoverMs: 900, evidenceSeq: [1] },
  ],
  recoveryMs: [900, 1200, 3000],
  repeats: [{ order: 'o2', kind: 'charge', extra: 1, stage: 'pay', fault: 'crash' }],
  lost: [],
  ramp: [{ concurrency: 1, throughputPerMin: 60, p50: 10, p95: 20, errorRate: 0 }],
  knee: 8,
  targets: [{ name: 'repeats', value: 1, target: 0, pass: false }],
  findings: [
    { id: 'F2', rule: 'R1', severity: 'low', stage: 'pay', fault: 'crash', summary: 'b | c', evidenceSeq: [5], suggestedPart: 'idempotency' },
    { id: 'F1', rule: 'R1', severity: 'high', stage: 'pay', fault: 'crash', summary: 'Repeat <charge>', evidenceSeq: [4], suggestedPart: 'journal' },
  ],
};

describe('report builder', () => {
  it('orders rows and computes recovery stats', () => {
    const r = buildReport(input);
    expect(r.matrix.map((m) => m.stage)).toEqual(['intake', 'pay']);
    expect(r.findings.map((f) => f.id)).toEqual(['F1', 'F2']);
    expect(r.recovery).toEqual({ count: 3, p50: 1200, p95: 3000, max: 3000 });
  });

  it('is byte-identical for the same input, ignoring generatedAt', () => {
    const a = renderJsonStable(buildReport(input));
    const b = renderJsonStable(buildReport({ ...input, generatedAt: 'later', matrix: [...input.matrix].reverse() }));
    expect(a).toBe(b);
    expect(renderJson(buildReport(input))).toContain('generatedAt');
    expect(a).not.toContain('generatedAt');
  });

  it('renders markdown with escaped table cells', () => {
    const md = renderMarkdown(buildReport(input));
    expect(md).toContain('**Grade C**');
    expect(md).toContain('| repeats | 1 | 0 | FAIL |');
    expect(md).toContain('| pay | crash | after | repeat |');
  });

  it('renders self-contained escaped HTML', () => {
    const html = renderHtml(buildReport(input));
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('orders &lt;demo&gt;');
    expect(html).toContain('Repeat &lt;charge&gt;');
    expect(html).not.toMatch(/<script|https?:\/\//);
  });
});
