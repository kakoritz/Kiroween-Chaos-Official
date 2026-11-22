import { describe, expect, it } from 'vitest';
import {
  applyCasebookEvent, caseRows, caseTitle, emptyCasebook, lessonCount, lessonsTip, loadCasebook, loadLessons, mechanismWord, recommendFix, solvedCounts, splitSignature,
} from '../src/arena/casebook';
import { fallbackAwards } from '../src/arena/casebook-view';
import { ArenaScene, laneBoxes } from '../src/arena/scene';
import { applyEvent, emptyVM, loadSnapshot } from '../src/arena/model';

const ev = (type: string, detail: Record<string, unknown>, o: Record<string, unknown> = {}) => ({ type, detail, ...o });
const SIG = 'payment + timeout + duplicate_charge';

describe('lessons ledger (TV3-U9)', () => {
  it('records a lesson per lane, once per signature and mechanism, and flags the lane that learned', () => {
    const cb = emptyCasebook();
    const l = { signature: SIG, mechanism: 'idempotency_key', round: 1, via: 'overcame' };
    expect(applyCasebookEvent(cb, ev('lesson', l, { lane: 5 }), 100)).toBe(5);
    expect(applyCasebookEvent(cb, ev('lesson', l, { lane: 5 }), 200)).toBeNull();
    expect(applyCasebookEvent(cb, ev('lesson', { ...l, signature: 'transit + wrong_address + lost' }, { lane: 5 }), 300)).toBe(5);
    expect(lessonCount(cb, 5)).toBe(2);
    expect(cb.learnedAt[5]).toEqual({ at: 300, mechanism: 'idempotency_key' });
    expect(lessonCount(cb, 4)).toBe(0);
  });
  it('accepts the lane in the detail, drops malformed events, and a loss lesson is upgraded when overcome', () => {
    const cb = emptyCasebook();
    applyCasebookEvent(cb, ev('lesson', { lane: 2, signature: SIG, mechanism: 'retry', round: 1, via: 'suggested' }), 0);
    applyCasebookEvent(cb, ev('lesson', { signature: '' }, { lane: 2 }), 0);
    applyCasebookEvent(cb, ev('lesson', { signature: SIG, mechanism: 'retry' }), 0);
    expect(cb.lessons[2]).toHaveLength(1);
    expect(cb.lessons[2]![0]!.via).toBe('suggested');
    applyCasebookEvent(cb, ev('lesson', { lane: 2, signature: SIG, mechanism: 'retry', round: 2, via: 'overcame' }), 0);
    expect(cb.lessons[2]![0]).toMatchObject({ via: 'overcame', round: 2 });
  });
  it('words for the tooltip and the table', () => {
    expect(mechanismWord('idempotency_key')).toBe('idempotency key');
    expect(mechanismWord('hold_and_reroute')).toBe('hold and reroute');
    expect(mechanismWord('some_new_thing')).toBe('some new thing');
    expect(splitSignature(SIG)).toEqual({ stage: 'payment', fault: 'timeout', consequence: 'duplicate_charge' });
    expect(caseTitle(SIG, (s) => s.toUpperCase())).toBe('PAYMENT: timeout, duplicate charge');
    const tip = lessonsTip([{ lane: 1, signature: SIG, mechanism: 'retry', round: 1, via: 'suggested' }], (s) => s);
    expect(tip).toContain('1 lesson learned');
    expect(tip).toContain('retry with backoff (from the loss)');
  });
});

describe('Casebook (TV3-U9)', () => {
  const entries = (cb: ReturnType<typeof emptyCasebook>) => {
    const c = (lane: number, signature: string, outcome: string, extra: Record<string, unknown> = {}) => applyCasebookEvent(cb, ev('case', { signature, round: 1, order: 'ord-1', outcome, costMs: 1500, costPoints: 150, ...extra }, { lane }), 0);
    c(1, SIG, 'lost'); c(4, SIG, 'solved', { mechanism: 'idempotency_key' }); c(5, SIG, 'solved', { mechanism: 'idempotency_key' });
    c(3, 'transit + wrong_address + lost_parcel', 'lost'); c(5, 'transit + wrong_address + lost_parcel', 'partly');
    c(2, 'fz-1a2b3c4d + timeout + truncated', 'lost', { unknown: true });
  };
  it('groups entries by signature: who met it, who solved it and how, open cases first', () => {
    const cb = emptyCasebook(); entries(cb);
    const rows = caseRows(cb);
    expect(rows.map((r) => [r.signature, r.open])).toEqual([['transit + wrong_address + lost_parcel', true], ['fz-1a2b3c4d + timeout + truncated', true], [SIG, false]]);
    const pay = rows.find((r) => r.signature === SIG)!;
    expect(pay.lanes).toEqual([1, 4, 5]);
    expect(pay.solvedBy).toEqual([{ lane: 4, mechanism: 'idempotency_key' }, { lane: 5, mechanism: 'idempotency_key' }]);
    expect(pay.recommended).toBe('Idempotency key');
    expect(pay.costMs).toBe(4500);
    expect(rows.find((r) => r.signature.startsWith('fz-'))!.unknown).toBe(true);
    expect(rows.find((r) => r.signature.startsWith('transit'))!.recommended).toContain('fix spec');
  });
  it('a later outcome for the same order replaces the earlier one', () => {
    const cb = emptyCasebook();
    applyCasebookEvent(cb, ev('case', { signature: SIG, round: 1, order: 'ord-1', outcome: 'partly' }, { lane: 2 }), 0);
    applyCasebookEvent(cb, ev('case', { signature: SIG, round: 1, order: 'ord-1', outcome: 'solved', mechanism: 'retry' }, { lane: 2 }), 0);
    expect(cb.entries).toHaveLength(1);
    expect(caseRows(cb)[0]!.open).toBe(false);
  });
  it('Battle-Tested counts distinct solved cases, even for a lane that was eliminated', () => {
    const cb = emptyCasebook(); entries(cb);
    applyCasebookEvent(cb, ev('case', { signature: 'transit + delay + late', round: 2, order: 'ord-9', outcome: 'solved', mechanism: 'queue' }, { lane: 5 }), 0);
    applyCasebookEvent(cb, ev('case', { signature: 'transit + delay + late', round: 2, order: 'ord-10', outcome: 'solved', mechanism: 'queue' }, { lane: 5 }), 0);
    expect([...solvedCounts(cb)]).toEqual([[4, 1], [5, 2]]);
    const awards = fallbackAwards({ champion: 4, fallen: { 1: { round: 1, stage: 'payment', cause: '', epitaph: '' }, 5: { round: 3, stage: 'x', cause: '', epitaph: '' } } }, cb);
    expect(awards.map((a) => [a.id, a.lane])).toEqual([['champion', 4], ['battle_tested', 5], ['wooden_spoon', 1]]);
  });
  it('recommends the commonest mechanism, or the fix spec when open', () => {
    expect(recommendFix([{ mechanism: 'breaker' }, { mechanism: 'retry' }, { mechanism: 'retry' }], false)).toBe('Retry with backoff');
    expect(recommendFix([{ mechanism: '' }], false)).toContain('not reported');
    expect(recommendFix([], true)).toContain('fix spec');
  });
  it('reads GET /api/casebook as per-lane entries, as groups, or as an object, and GET /api/lessons/:lane', () => {
    const flat = emptyCasebook();
    loadCasebook(flat, { cases: [{ signature: SIG, lane: 5, outcome: 'solved', mechanism: 'retry', round: 1, costMs: 900 }] });
    expect(flat.entries).toHaveLength(1);
    const grouped = emptyCasebook();
    loadCasebook(grouped, [{ signature: SIG, recommended: 'Add an idempotency key', entries: [{ lane: 4, outcome: 'solved', mechanism: 'idempotency_key' }, { lane: 1, outcome: 'lost' }], unknown: false }]);
    expect(grouped.entries.map((e) => e.lane)).toEqual([4, 1]);
    expect(caseRows(grouped)[0]!.recommended).toBe('Add an idempotency key');
    loadCasebook(grouped, 'nonsense');
    expect(grouped.entries).toHaveLength(2);
    const l = emptyCasebook();
    loadLessons(l, 3, { lessons: [{ signature: SIG, mechanism: 'retry', learnedRound: 2 }, { signature: SIG, mechanism: 'retry', learnedRound: 3 }, { nope: 1 }] });
    expect(l.lessons[3]).toEqual([{ lane: 3, signature: SIG, mechanism: 'retry', round: 2, via: 'overcame' }]);
    loadLessons(l, 4, []);
    expect(l.lessons[4]).toBeUndefined();
  });
  it('reset clears everything', () => {
    const cb = emptyCasebook(); entries(cb);
    applyCasebookEvent(cb, ev('lesson', { signature: SIG, mechanism: 'retry' }, { lane: 1 }), 0);
    applyCasebookEvent(cb, { type: 'reset' }, 0);
    expect(cb.entries).toHaveLength(0);
    expect(cb.lessons).toEqual({});
  });
});

describe('lessons on the lane card', () => {
  class FakePath { constructor(public d?: string) {} addPath(): void {} ellipse(): void {} roundRect(): void {} rect(): void {} moveTo(): void {} lineTo(): void {} arc(): void {} closePath(): void {} quadraticCurveTo(): void {} bezierCurveTo(): void {} }
  (globalThis as Record<string, unknown>).Path2D = FakePath;
  const chain = (): CanvasRenderingContext2D => {
    const fn: unknown = new Proxy(function () {}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 30 }) : fn), set: () => true, apply: () => fn });
    return fn as CanvasRenderingContext2D;
  };
  it('draws a scroll with a count and a hover tip, with and without the learned sparkle', () => {
    const vm = emptyVM();
    loadSnapshot(vm, { app: 'orders', stages: [{ id: 'payment', label: 'Payment', icon: '', workAnimation: 'think' }], lanes: [{ lane: 1, tier: 'rookie', label: 'Rookie', state: 'idle', order: null, stage: null, stageIndex: 0, orderIndex: 0, ordersTotal: 3, score: 0, counts: { completed: 0, failed: 0, parked: 0, quarantined: 0, repeats: 0 }, depth: 0, parts: [] }] } as never, 0);
    applyEvent(vm, { seq: 1, ts: 1, type: 'order_start', lane: 1, order: 'o1', detail: { index: 1, total: 3 } } as never, 0);
    const scene = new ArenaScene(chain());
    scene.lessonInfo = () => ({ count: 3, tip: '3 lessons learned.', learnedAt: 900, mechanism: 'idempotency key' });
    const draw = (now: number) => (scene as unknown as { drawLane(c: CanvasRenderingContext2D, v: typeof vm, l: (typeof vm.lanes)[0], b: { top: number; h: number }, n: number): void }).drawLane(chain(), vm, vm.lanes[0]!, laneBoxes(5)[0]!, now);
    draw(1000);
    expect(scene.hot.some((h) => h.tip === '3 lessons learned.' && h.x > 150)).toBe(true);
    scene.hot = [];
    scene.reducedMotion = true;
    draw(5000);
    expect(scene.hot).toHaveLength(1);
  });
});
