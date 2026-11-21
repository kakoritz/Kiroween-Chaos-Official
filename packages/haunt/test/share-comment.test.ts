import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { COMMENT_MARKER, renderPrComment } from '../src/share';

const report = {
  app: 'haunted-orders', grade: 'B', reliability: 0.94,
  matrix: [
    { stage: 'charge', fault: 'crash', result: 'pass' },
    { stage: 'charge', fault: 'timeout', result: 'repeat' },
    { stage: 'ship', fault: 'crash', result: 'fail' },
  ],
  recovery: { p50: 5, p95: 35 },
  findings: [{ id: 'f1', severity: 'high', summary: 'Charge repeats | after timeout' }],
};

describe('SH-C2 pr comment', () => {
  it('has the marker, grade, table and findings', () => {
    const md = renderPrComment(report, { runUrl: 'https://example.invalid/run/1', targetsPassed: false });
    expect(md.startsWith(COMMENT_MARKER)).toBe(true);
    expect(md).toContain('grade B (94)');
    expect(md).toContain('Targets: **FAILED**');
    expect(md).toContain('| charge | ok | repeat |');
    expect(md).toContain('Charge repeats \\| after timeout');
    expect(md).toContain('[workflow run artifacts](https://example.invalid/run/1)');
  });
  it('is deterministic and survives an empty report', () => {
    expect(renderPrComment(report)).toBe(renderPrComment(report));
    expect(renderPrComment({}, { targetsPassed: true })).toContain('Targets: **passed**');
  });
  it('action file declares inputs and the gate', () => {
    const y = readFileSync(new URL('../../../.github/actions/haunt-sweep/action.yml', import.meta.url), 'utf8');
    for (const k of ['config:', 'tiers:', 'fail-on:', 'comment:', 'using: composite', 'haunt-sweep-comment']) expect(y).toContain(k);
    expect(y).not.toMatch(/npm (run )?test|vitest/);
  });
});
