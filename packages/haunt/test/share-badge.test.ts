import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderBadgeFiles, renderBadgeSvg, scorecardData, writeBadgeFiles } from '../src/share';
import { callTool } from '../src/mcp/server';

const work = mkdtempSync(join(tmpdir(), 'haunt-badge-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const report = {
  run: 'r1', app: 'haunted-orders', seed: 1, grade: 'B', reliability: 0.94,
  matrix: [
    { stage: 'charge', fault: 'crash', result: 'pass', repeats: [], evidenceSeq: [1] },
    { stage: 'charge', fault: 'timeout', result: 'repeat', repeats: [], evidenceSeq: [2] },
    { stage: 'ship', fault: 'crash', result: 'fail', repeats: [], evidenceSeq: [3] },
  ],
  recovery: { count: 3, p50: 5, p95: 35, max: 35 },
  repeats: [{ order: 'o1', kind: 'charge', extra: 1, stage: 'charge', fault: 'timeout' }],
  lost: [],
  findings: [
    { id: 'f2', severity: 'low', summary: 'low one <&>' },
    { id: 'f1', severity: 'high', summary: 'Charge repeats after timeout' },
  ],
  tiers: [{ tier: 'rookie', grade: 'F', score: 20 }, { tier: 'phoenix', grade: 'A', score: 95 }],
};

describe('badge and scorecard', () => {
  it('same report gives the same bytes', () => {
    expect(renderBadgeFiles(report)).toEqual(renderBadgeFiles(JSON.parse(JSON.stringify(report))));
  });
  it('badge shows label, grade and score with the grade colour, 20 px tall', () => {
    const svg = renderBadgeSvg(scorecardData(report));
    expect(svg).toContain('height="20"');
    expect(svg).toContain('B 94');
    expect(svg).toContain('#97ca00');
    expect(renderBadgeSvg({ grade: 'F', score: 10 })).toContain('#e05d44');
  });
  it('scorecard is 1200x630, self-contained, escapes text and lists the worst finding first', () => {
    const f = renderBadgeFiles(report);
    const svg = f['haunt-scorecard.svg'];
    expect(svg).toContain('width="1200" height="630"');
    expect(svg).toContain('Kiroween Chaos resilience scorecard');
    expect(svg).toContain('1. Charge repeats after timeout');
    expect(svg).toContain('2. low one &lt;&amp;&gt;');
    expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect(f['haunt-scorecard.html']).toContain('<svg');
    expect(f['haunt-scorecard.html']).not.toContain('<script');
  });
  it('tolerates a plain sweep report and an empty one', () => {
    const d = scorecardData({ grade: 'A', reliability: 1, cells: [{ stage: 's', creature: 'c', fault: 'f', outcome: 'pass' }] });
    expect(d.score).toBe(100);
    expect(renderBadgeFiles({})['haunt-badge.svg']).toContain('F ');
  });
  it('writeBadgeFiles writes the three files locally and the MCP tool does too', async () => {
    mkdirSync(join(work, '.haunt', 'sweeps'), { recursive: true });
    writeFileSync(join(work, '.haunt', 'sweeps', 'r1.json'), JSON.stringify(report));
    const r = writeBadgeFiles(work, 'r1', 'out');
    expect('files' in r && r.files.length).toBe(3);
    const a = readFileSync(join(work, 'out', 'haunt-badge.svg'), 'utf8');
    const m = await callTool({ root: work }, 'haunt_badge', { run: 'r1', out: 'out2' });
    expect(m.isError).toBe(false);
    expect(readFileSync(join(work, 'out2', 'haunt-badge.svg'), 'utf8')).toBe(a);
    expect('error' in writeBadgeFiles(work, 'nope', 'x')).toBe(true);
    expect((await callTool({ root: work }, 'haunt_badge', {})).isError).toBe(true);
  });
});
