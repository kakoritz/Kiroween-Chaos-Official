import { describe, expect, it } from 'vitest';
import {
  bestSlowest, downtimePoints, filterLog, lapOf, logEntries, normReview, offsetText, orderRows, outcomeOf, reviewOf, segment,
  stageRows, starGlyphs, starText, starTone,
} from '../src/arena/lane-popup-model';
import type { ArenaEvent } from '../src/api/types';

const STAGES = ['intake', 'payment', 'handoff'];
let n = 0;
const ev = (type: string, ts: number, extra: Partial<ArenaEvent> = {}): ArenaEvent => ({ seq: ++n, ts, type, lane: 1, order: 'o1', ...extra });
const label = (id: string) => id.toUpperCase();

function orderOne(): ArenaEvent[] {
  return [
    ev('order_start', 1000),
    ev('stage_start', 1500, { stage: 'intake', detail: { attempt: 1 } }),
    ev('stage_done', 1900, { stage: 'intake', detail: { ms: 400 } }),
    ev('stage_start', 2300, { stage: 'payment', detail: { attempt: 1 } }),
    ev('stage_fail', 2800, { stage: 'payment', detail: { error: 'timeout', retryable: true } }),
    ev('recover_start', 2900, { stage: 'payment', detail: { action: 'retry' } }),
    ev('recover_done', 4900, { stage: 'payment' }),
    ev('stage_done', 5200, { stage: 'payment', detail: { ms: 2900 } }),
    ev('score', 5200, { order: undefined, detail: { delta: -2, reason: 'downtime' } }),
    ev('stage_start', 5600, { stage: 'handoff' }),
    ev('stage_done', 6000, { stage: 'handoff', detail: { ms: 400 } }),
    ev('order_done', 6000, { detail: { lap: { ms: 5000, workMs: 3700, attempts: 4, retries: 1, downtimeMs: 2000, issues: [{ stage: 'payment', count: 1 }] } } }),
    ev('review', 6010, { order: undefined, detail: { order: 'o1', stars: 3.5, sub: { timeliness: 3, delays: 3.5, issues: 3, delivery: 5, ease: 4 }, reasons: ['slow payment'], text: 'Took a while', cum: { stars: 3.5, max: 5, count: 1 } } }),
  ];
}

describe('segment', () => {
  it('assigns lane events without an order to the running order and ignores other lanes', () => {
    const evs = [...orderOne(), ev('order_start', 7000, { order: 'o2' }), ev('score', 7100, { order: undefined, detail: { delta: 5, reason: 'x' } }), ev('stage_start', 1, { lane: 2, stage: 'intake' })];
    const seg = segment(evs, 1);
    expect([...seg.keys()]).toEqual(['o1', 'o2']);
    expect(seg.get('o1')!.some((e) => e.type === 'score')).toBe(true);
    expect(seg.get('o1')!.some((e) => e.type === 'review')).toBe(true);
    expect(seg.get('o2')!.length).toBe(2);
  });
});

describe('stage table', () => {
  const rows = stageRows(orderOne(), STAGES);
  it('counts attempts, retries, issues, downtime, time and recoverable per stage', () => {
    const pay = rows[1]!;
    expect(pay).toMatchObject({ stage: 'payment', state: 'healed', retries: 1, issues: 1, ms: 2900, recoverable: 'yes' });
    expect(pay.attempts).toBeGreaterThanOrEqual(1);
    expect(pay.downtimeMs).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({ state: 'passed', issues: 0, recoverable: 'n/a', ms: 400 });
  });
  it('marks a failure that never succeeded as not recoverable', () => {
    const r = stageRows([ev('order_start', 0), ev('stage_start', 1, { stage: 'intake' }), ev('stage_fail', 2, { stage: 'intake', detail: { error: 'x' } })], STAGES);
    expect(r[0]!.recoverable).toBe('no');
  });
  it('falls back to the server record for stages the buffer never saw', () => {
    const r = stageRows([], STAGES, { stages: [{ stage: 'payment', status: 'healed', attempts: 3, retries: 2, issues: 2, downtimeMs: 900, ms: 1200, recoverable: true }] });
    expect(r[1]).toMatchObject({ state: 'healed', attempts: 3, retries: 2, issues: 2, downtimeMs: 900, ms: 1200, recoverable: 'yes' });
    expect(r[0]!.state).toBe('pending');
  });
});

describe('lap and review', () => {
  it('uses the server lap object when the order ended', () => {
    const evs = orderOne();
    const lap = lapOf(evs, stageRows(evs, STAGES))!;
    expect(lap).toMatchObject({ ms: 5000, workMs: 3700, attempts: 4, retries: 1, downtimeMs: 2000, issues: 1, final: true });
  });
  it('tallies a running order from events', () => {
    const evs = orderOne().slice(0, 5);
    const lap = lapOf(evs, stageRows(evs, STAGES))!;
    expect(lap.final).toBe(false);
    expect(lap.ms).toBe(1800);
    expect(lap.issues).toBe(1);
  });
  it('reads the review card and handles cancelled orders', () => {
    const rv = reviewOf(orderOne(), 'done')!;
    expect(rv).toMatchObject({ stars: 3.5, text: 'Took a while', cancelled: false, cum: { stars: 3.5, max: 5, count: 1 } });
    expect(rv.sub.map((s) => s.key)).toEqual(['timeliness', 'delays', 'issues', 'delivery', 'ease']);
    expect(normReview({ stars: 1 }, true)!.cancelled).toBe(true);
    expect(normReview({ nope: 1 })).toBeNull();
  });
  it('formats stars', () => {
    expect(starText(4)).toBe('4');
    expect(starText(4.5)).toBe('4.5');
    expect(starTone(4.5)).toBe('gold');
    expect(starTone(3)).toBe('amber');
    expect(starTone(2.5)).toBe('red');
    expect(starGlyphs(3.5)).toBe('\u2605\u2605\u2605\u00BD\u2606');
  });
});

describe('orders', () => {
  it('lists orders with outcome, lap time and stars, merging older server laps first', () => {
    const evs = [...orderOne(), ev('order_start', 8000, { order: 'o2' })];
    const rows = orderRows(evs, 1, [{ order: 'o0', outcome: 'cancelled', lap: { ms: 9000 }, review: { stars: 1 } }, { order: 'o1', outcome: 'done' }]);
    expect(rows.map((r) => [r.order, r.outcome, r.lapMs, r.stars])).toEqual([['o0', 'cancelled', 9000, 1], ['o1', 'done', 5000, 3.5], ['o2', 'running', null, null]]);
  });
  it('tags the best and slowest completed laps', () => {
    const rows = [
      { order: 'a', outcome: 'done' as const, lapMs: 5000, stars: 5 },
      { order: 'b', outcome: 'done' as const, lapMs: 9000, stars: 3 },
      { order: 'c', outcome: 'cancelled' as const, lapMs: 20000, stars: 1 },
      { order: 'd', outcome: 'done' as const, lapMs: 3000, stars: 5 },
    ];
    expect(bestSlowest(rows)).toEqual({ best: 'd', slowest: 'b' });
    expect(bestSlowest(rows.slice(0, 1))).toBeNull();
  });
  it('reads outcomes', () => {
    expect(outcomeOf(orderOne())).toBe('done');
    expect(outcomeOf([ev('order_start', 0), ev('order_failed', 1)])).toBe('cancelled');
    expect(outcomeOf([ev('order_start', 0), ev('order_failed', 1), ev('order_start', 2)])).toBe('running');
  });
});

describe('log', () => {
  const entries = logEntries(orderOne(), label);
  it('offsets times from order start and colours by level', () => {
    expect(entries[0]!.text).toMatch(/Grabbed order o1/);
    expect(entries[1]).toMatchObject({ t: 0.5, stage: 'intake' });
    expect(offsetText(entries[1]!.t)).toBe('+0.5s');
    expect(entries.find((x) => x.text.includes('timeout'))!.level).toBe('error');
  });
  it('filters All, Issues, Score and by stage', () => {
    expect(filterLog(entries, 'all', null).length).toBe(entries.length);
    expect(filterLog(entries, 'issues', null).map((x) => x.text).join()).toMatch(/PAYMENT failed/);
    expect(filterLog(entries, 'issues', null).length).toBe(1);
    expect(filterLog(entries, 'score', null).length).toBe(1);
    expect(filterLog(entries, 'all', 'handoff').every((x) => x.stage === 'handoff')).toBe(true);
  });
  it('sums downtime points', () => {
    expect(downtimePoints(orderOne())).toBe(2);
  });
});

describe('review sub labels', () => {
  it('relabels the five slots from subLabels and keeps defaults otherwise', () => {
    const base = { stars: 4, sub: { a: 1 } };
    const def = normReview(base)!;
    const key = def.sub[0].key;
    const r = normReview({ ...base, subLabels: { [key]: 'First response' } })!;
    expect(r.sub[0].label).toBe('First response');
    expect(r.sub[1].label).toBe(def.sub[1].label);
    expect(def.sub[0].label).not.toBe('First response');
  });
});
