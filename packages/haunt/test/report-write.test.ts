// covers: haunted-house/R4.1, haunted-house/R4.2, haunted-house/R4.4
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildReport, makeRunId, renderHtml, renderJson, renderMarkdown, writeReport } from '../src/report';

const report = () =>
  buildReport({
    run: makeRunId(new Date(Date.UTC(2026, 10, 20, 12, 0, 5)), 7),
    mode: 'sweep',
    seed: 7,
    app: 'orders',
    generatedAt: '2026-11-20T12:00:05Z',
    grade: 'A',
    reliability: 95,
    matrix: [],
    recoveryMs: [],
    repeats: [],
    lost: [],
    targets: [],
    findings: [],
  });

describe('report writer', () => {
  it('formats the run id', () => {
    expect(makeRunId(new Date(Date.UTC(2026, 10, 20, 12, 0, 5)), 7)).toBe('run-20261120-120005-7');
  });

  it('writes json, html and markdown under .haunt/runs/<run>', () => {
    const root = mkdtempSync(join(tmpdir(), 'haunt-report-'));
    try {
      const r = report();
      const w = writeReport(root, r);
      expect(w.dir).toBe(join(root, '.haunt', 'runs', 'run-20261120-120005-7'));
      expect(readFileSync(w.json, 'utf8')).toBe(renderJson(r));
      expect(readFileSync(w.html, 'utf8')).toBe(renderHtml(r));
      expect(readFileSync(w.markdown, 'utf8')).toBe(renderMarkdown(r));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a run id that could escape the runs folder', () => {
    const r = { ...report(), run: '../evil' };
    expect(() => writeReport('/nowhere', r)).toThrow(/unsafe run id/);
  });
});
