import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { reviewEvents, runReviewer, writeReview } from '../src/reviewer';

const evs = [
  { seq: 1, type: 'chaos', wave: 1, lane: '1', detail: { fault: 'crash', depth: 3 } },
  { seq: 2, type: 'repeat', wave: 1, lane: '1', order: 'o1', stage: 'payment', detail: { kind: 'charge', count: 2 } },
  { seq: 3, type: 'stage_fail', wave: 1, lane: '2', order: 'o2', stage: 'payment', detail: { retryable: true, status: 503 } },
  { seq: 4, type: 'stage_fail', wave: 1, lane: '2', order: 'o2', stage: 'payment', detail: { retryable: true, status: 503 } },
  { seq: 5, type: 'stage_fail', wave: 1, lane: '2', order: 'o2', stage: 'payment', detail: { retryable: true, status: 429 } },
  { seq: 6, type: 'order_failed', wave: 1, lane: '2', order: 'o2', stage: 'payment', detail: {} },
  { seq: 7, type: 'order_failed', wave: 1, lane: '3', order: 'o3', stage: 'intake', detail: { error: 'ENOENT: no such file' } },
  { seq: 8, type: 'lane_halted', wave: 1, lane: '1', detail: { error: 'boom' } },
  { seq: 9, type: 'recover_done', wave: 1, lane: '1', detail: { ms: 30000 } },
];

describe('reviewer', () => {
  it('applies rules R1 to R8', () => {
    const rules = new Set(reviewEvents(evs, { journal: [{ order: 'o1', kind: 'charge' }], ledger: [] }).map((f) => f.rule));
    expect([...rules].sort()).toEqual(['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8']);
  });
  it('is deterministic and cites seq numbers', () => {
    const a = runReviewer('run-x', evs);
    const b = runReviewer('run-x', [...evs].reverse());
    expect(a).toEqual(b);
    expect(a.postmortem).toContain('seq 2');
    expect(a.hardening.tasks).toContain('idempotency');
  });
  it('reports nothing for a clean run', () => {
    expect(reviewEvents([{ seq: 1, type: 'order_done', lane: '1', order: 'o1' }])).toEqual([]);
  });
  it('writes postmortem and hardening spec files', () => {
    const root = mkdtempSync(join(tmpdir(), 'rev-'));
    try {
      const w = writeReview(root, join(root, 'specs'), 'run-x', runReviewer('run-x', evs));
      expect(readFileSync(w.postmortem, 'utf8')).toContain('Postmortem run-x');
      expect(readFileSync(join(w.specDir, 'tasks.md'), 'utf8')).toContain('- [ ] F1');
      expect(() => writeReview(root, root, '../bad', runReviewer('x', []))).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
