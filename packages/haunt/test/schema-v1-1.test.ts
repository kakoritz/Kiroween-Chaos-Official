import { describe, expect, it } from 'vitest';
import { schemaErrors } from '../src/contract/validate';

const lap = { ms: 9000, workMs: 7000, attempts: 9, retries: 1, downtimeMs: 500, issues: [{ stage: 'payment', count: 1 }], recoveries: [{ stage: 'payment', action: 'retry', ms: 500 }] };
const base = { seq: 1, ts: 1, wave: 1, lane: 1, order: 'ord-0001' };
const review = { ...base, type: 'review', detail: { order: 'ord-0001', stars: 4.5, sub: { timeliness: 4, delays: 5, issues: 4.5, delivery: 5, ease: 4 }, reasons: ['one retry'], text: 'ok', cum: { stars: 4.5, max: 5, count: 1 } } };

describe('contract v1.1 schema (additive)', () => {
  it('accepts hello.contractMinor and pace slow', () => {
    expect(schemaErrors({ seq: 1, ts: 1, type: 'hello', contractVersion: 1, contractMinor: 1, mode: 'mock', app: 'orders' })).toEqual([]);
    const ws = { seq: 2, ts: 2, type: 'wave_start', wave: 1, detail: { orders: 1, seed: 1, tiers: 'race', lanes: 1, speed: 1, app: 'orders', pace: 'slow' } };
    expect(schemaErrors(ws)).toEqual([]);
  });
  it('accepts travel fields, lap, refund and discount effects', () => {
    expect(schemaErrors({ ...base, type: 'order_start', detail: { index: 1, total: 1, grabMs: 1500, redo: true } })).toEqual([]);
    expect(schemaErrors({ ...base, type: 'stage_done', stage: 'intake', detail: { ms: 5, skipped: false, walkMs: 1200 } })).toEqual([]);
    expect(schemaErrors({ ...base, type: 'order_done', detail: { clean: true, ms: 9, repeats: 0, ceremonyMs: 4800, returnMs: 5400, lap } })).toEqual([]);
    expect(schemaErrors({ ...base, type: 'order_failed', detail: { stage: 'handoff', error: 'accident', outcome: 'cancelled', reason: 'refunded', cancelMs: 2700, returnMs: 5400, lap } })).toEqual([]);
    expect(schemaErrors({ ...base, type: 'effect', detail: { kind: 'refund', key: 'ord-0001:charge', replayed: false } })).toEqual([]);
  });
  it('accepts review and decision events, rejects bad values', () => {
    expect(schemaErrors(review)).toEqual([]);
    expect(schemaErrors({ ...review, detail: { ...review.detail, stars: 4.3 } })).not.toEqual([]);
    expect(schemaErrors({ ...review, detail: { ...review.detail, stars: 0.5 } })).not.toEqual([]);
    const needed = { ...base, type: 'decision_needed', detail: { order: 'ord-0001', kind: 'wrong_order', detectedAt: 'handoff', options: ['refund', 'discount', 'redo'], defaultChoice: 'refund', timeoutMs: 15000 } };
    expect(schemaErrors(needed)).toEqual([]);
    expect(schemaErrors({ ...needed, detail: { ...needed.detail, defaultChoice: 'explode' } })).not.toEqual([]);
    expect(schemaErrors({ ...base, type: 'decision_made', detail: { order: 'ord-0001', choice: 'redo', source: 'timeout' } })).toEqual([]);
    expect(schemaErrors({ ...base, type: 'decision_made', detail: { order: 'ord-0001', choice: 'redo', source: 'bot' } })).not.toEqual([]);
  });
  it('accepts the wave summary additions and keeps them optional', () => {
    const lane = { score: 1, completed: 1, failed: 0, parked: 0, quarantined: 0, repeats: 0 };
    const extra = { orders: { done: 1, cancelled: 0, parked: 0, quarantined: 0, abandoned: 0 }, bestMs: 9, slowestMs: 9, avgMs: 9, totalMs: 9, retries: 1, downtimeMs: 0, issuesByStage: { payment: 1 }, stars: { sum: 5, max: 5, count: 1, avg: 5 }, rating: 'Five-Star Crypt' };
    const we = (s: any) => ({ seq: 9, ts: 9, type: 'wave_end', wave: 1, detail: { summary: { 1: s } } });
    expect(schemaErrors(we(lane))).toEqual([]);
    expect(schemaErrors(we({ ...lane, ...extra }))).toEqual([]);
    expect(schemaErrors(we({ ...lane, ...extra, rating: 'Meh' }))).not.toEqual([]);
  });
});
