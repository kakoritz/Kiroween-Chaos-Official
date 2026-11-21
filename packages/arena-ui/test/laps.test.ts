import { describe, expect, it } from 'vitest';
import {
  heatOf, laneCards, laneLapsOf, laneStarsOf, lapRowsFromEvents, lapRowsOf, lapTable, mergeLapRows, ratingFor, ratingsOf, starBars,
  starSeriesFromEvents, starTracker, waveAvgStars,
} from '../src/arena/laps-model';
import type { ArenaEvent } from '../src/api';

const lap = (ms: number, extra: Record<string, unknown> = {}) => ({ ms, workMs: ms - 500, attempts: 4, retries: 0, downtimeMs: 0, issues: [], ...extra });
const server = [
  { order: 'o1', outcome: 'done', lap: lap(8000), review: { stars: 5 } },
  { order: 'o2', outcome: 'done', lap: lap(14000, { retries: 2, downtimeMs: 3000, issues: [{ stage: 'pay', count: 2 }] }), review: { stars: 3.5 } },
  { order: 'o3', outcome: 'cancelled', lap: lap(30000, { issues: [{ stage: 'pay', count: 1 }, { stage: 'ship', count: 1 }] }), review: { stars: 1 } },
];

describe('lapTable', () => {
  it('tags best and slowest among completed laps only, and totals the footer', () => {
    const t = lapTable(lapRowsOf(server));
    expect(t.rows.map((r) => r.tag)).toEqual(['best', 'slowest', null]);
    expect(t.footer.count).toBe(3);
    expect(t.footer.done).toBe(2);
    expect(t.footer.avgMs).toBe(11000);
    expect(t.footer.totalMs).toBe(52000);
    expect(t.footer.retries).toBe(2);
    expect(t.footer.downtimeMs).toBe(3000);
    expect(t.footer.issues).toBe(4);
    expect(t.footer.avgStars).toBe(3.17);
  });
  it('gives no tags with a single completed lap or equal laps', () => {
    expect(lapTable(lapRowsOf(server.slice(0, 1))).rows[0]!.tag).toBeNull();
    expect(lapTable(lapRowsOf([server[0], { ...server[0], order: 'o9' }])).rows.map((r) => r.tag)).toEqual([null, null]);
  });
  it('handles an empty list', () => {
    expect(lapTable([]).footer.avgMs).toBeNull();
  });
});

describe('rows from events', () => {
  const ev = (seq: number, type: string, order: string, detail: Record<string, unknown>, lane = 1): ArenaEvent => ({ seq, ts: seq, type, lane, order, detail });
  const events = [
    ev(1, 'order_done', 'o1', { lap: lap(9000) }),
    ev(2, 'review', 'o1', { stars: 4.5, cum: { stars: 4.5, max: 5, count: 1 } }),
    ev(3, 'order_failed', 'o2', { lap: lap(20000) }),
    ev(4, 'review', 'o2', { stars: 1, cum: { stars: 5.5, max: 10, count: 2 } }),
    ev(5, 'order_done', 'x', { lap: lap(1) }, 2),
  ];
  it('builds rows for one lane with their review stars', () => {
    const rows = lapRowsFromEvents(events, 1);
    expect(rows.map((r) => [r.order, r.outcome, r.stars])).toEqual([['o1', 'done', 4.5], ['o2', 'cancelled', 1]]);
  });
  it('derives the star series and the tracker text', () => {
    const s = starSeriesFromEvents(events, 1);
    expect(s.map((p) => `${p.cumStars}/${p.cumMax}`)).toEqual(['4.5/5', '5.5/10']);
    expect(starTracker({ stars: 8, max: 15 })).toBe('8/15');
    expect(starTracker(null)).toBe('');
  });
  it('lets live rows override server rows of the same order', () => {
    const merged = mergeLapRows(lapRowsOf(server), lapRowsFromEvents(events, 1));
    expect(merged.map((r) => r.order)).toEqual(['o1', 'o2', 'o3']);
    expect(merged[0]!.ms).toBe(9000);
  });
});

describe('stars and ratings', () => {
  it('maps average stars to rating titles', () => {
    expect([5, 4.5, 4.49, 3.5, 2.5, 2.49, 1].map(ratingFor)).toEqual(['Five-Star Crypt', 'Five-Star Crypt', 'Respectable', 'Respectable', 'Spooky Service', 'Cursed', 'Cursed']);
  });
  it('builds chart bars as cumStars over cumMax', () => {
    const bars = starBars([{ order: 'o1', stars: 5, cumStars: 5, cumMax: 5 }, { order: 'o2', stars: 1, cumStars: 6, cumMax: 10 }, { order: 'o3', stars: 2, cumStars: 8, cumMax: 15 }]);
    expect(bars.map((b) => b.label)).toEqual(['5/5', '6/10', '8/15']);
    expect(bars[0]!.ratio).toBe(1);
    expect(bars[1]!.tone).toBe('amber');
    expect(bars[2]!.tone).toBe('red');
  });
  it('derives ratings from the star series when the report has none', () => {
    const stars = laneStarsOf({ lanes: [{ lane: 1, series: [{ order: 'o1', stars: 5, cumStars: 5, cumMax: 5 }] }, { lane: 2, series: [{ order: 'o1', stars: 2, cumStars: 2, cumMax: 5 }] }] });
    const r = ratingsOf(undefined, stars);
    expect(r.map((x) => x.rating)).toEqual(['Five-Star Crypt', 'Cursed']);
    expect(waveAvgStars(r)).toBe(3.5);
  });
  it('reads the report JSON array shapes', () => {
    expect(laneLapsOf([{ lane: 1, tier: 'race', laps: server }])[0]!.rows).toHaveLength(3);
    expect(ratingsOf([{ lane: 1, rating: 'Respectable', avg: 3.6 }], new Map())[0]!.rating).toBe('Respectable');
  });
});

describe('wave end cards', () => {
  const summary = {
    1: {
      score: 120, orders: { done: 4, cancelled: 1, parked: 0, quarantined: 0, abandoned: 0 }, bestMs: 8000, slowestMs: 20000, avgMs: 12000, totalMs: 60000,
      retries: 3, downtimeMs: 4000, issuesByStage: { pay: 4, ship: 1 }, stars: { sum: 18, max: 25, count: 5, avg: 3.6 }, rating: 'Respectable',
    },
  };
  it('builds a card per lane with heat per stage', () => {
    const [c] = laneCards(summary, ['intake', 'pay', 'ship'], new Map(), (l) => `L${l}`);
    expect(c!.rating).toBe('Respectable');
    expect(c!.tone).toBe('good');
    expect(c!.stars).toBe('18/25');
    expect(c!.issues.map((i) => [i.stage, i.count, i.heat])).toEqual([['intake', 0, 0], ['pay', 4, 3], ['ship', 1, 1]]);
    expect(c!.bestMs).toBe(8000);
  });
  it('computes heat relative to the worst stage', () => {
    expect([0, 1, 4, 7, 10].map((n) => heatOf(n, 10))).toEqual([0, 1, 2, 3, 3]);
  });
  it('falls back to a derived rating and tolerates missing fields', () => {
    const [c] = laneCards({ 2: { stars: { sum: 5, max: 5, count: 1 } } }, [], new Map(), () => '');
    expect(c!.rating).toBe('Five-Star Crypt');
    expect(c!.bestMs).toBeNull();
    expect(c!.title).toBe('Lane 2');
  });
});
