import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { improveCardData, renderImproveFiles, writeImproveFiles } from '../src/share';
import { callTool } from '../src/mcp/server';

const work = mkdtempSync(join(tmpdir(), 'haunt-improve-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const report = {
  closed: 5, of: 9, grade: { before: 'C', after: 'B' },
  reliability: { before: 70, after: 87 }, lost: { before: 9, after: 2 }, repeats: { before: 9, after: 8 },
  patterns: [
    { id: 'p1', signature: 'payment + http_404 + order_lost', status: 'applied' },
    { id: 'p2', signature: 'payment + http_429 + order_lost', status: 'verified' },
  ],
};

describe('improve before and after card', () => {
  it('reads the C13 report shape', () => {
    const d = improveCardData(report);
    expect(d).toMatchObject({ closed: 5, of: 9, summary: 'closed 5 of 9 patterns' });
    expect(d.before.grade).toBe('C');
    expect(d.after.reliability).toBe(87);
  });
  it('is deterministic, 1200x630 and says closed n of m, B to A style', () => {
    const f = renderImproveFiles(report);
    expect(f).toEqual(renderImproveFiles(JSON.parse(JSON.stringify(report))));
    expect(f['haunt-improve.svg']).toContain('width="1200" height="630"');
    expect(f['haunt-improve.svg']).toContain('closed 5 of 9, C to B');
    expect(f['haunt-improve.html']).not.toContain('<script');
    expect(f['haunt-improve.svg']).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });
  it('writes files from a saved report (also wrapped in {report}) and via MCP', async () => {
    writeFileSync(join(work, 'imp.json'), JSON.stringify({ report }));
    const r = writeImproveFiles(work, 'imp.json', 'out');
    expect('files' in r && r.files.length).toBe(2);
    const a = readFileSync(join(work, 'out', 'haunt-improve.svg'), 'utf8');
    const m = await callTool({ root: work }, 'haunt_badge', { improve: 'imp.json', out: 'out2' });
    expect(m.isError).toBe(false);
    expect(readFileSync(join(work, 'out2', 'haunt-improve.svg'), 'utf8')).toBe(a);
    expect('error' in writeImproveFiles(work, 'nope.json', 'x')).toBe(true);
  });
});
