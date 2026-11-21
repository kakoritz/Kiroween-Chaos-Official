import { describe, expect, it } from 'vitest';
import { LapTracker } from '../src/live/lap-tracker';
import { LiveServer, type LiveEngine } from '../src/live/server';
import type { HauntEvent } from '../../haunt/src/score/score';

const T0 = 1_000_000;
const ev = (type: string, ts: number, order?: string, stage?: string, detail: Record<string, unknown> = {}, lane: string | number = '1'): HauntEvent =>
  ({ type, ts, lane, ...(order ? { order } : {}), ...(stage ? { stage } : {}), detail } as HauntEvent);

const clean = (order: string, at: number, ms = 4000): HauntEvent[] => [
  ev('order_start', at, order, undefined, { grabMs: 100 }),
  ev('stage_start', at + 100, order, 'intake'),
  ev('stage_done', at + ms - 100, order, 'intake', { walkMs: 0 }),
  ev('order_done', at + ms, order, undefined, {}),
];

const run = (t: LapTracker, evs: HauntEvent[]): HauntEvent[] => evs.flatMap((e) => t.process(e));

describe('LapTracker (PT-C3)', () => {
  it('adds a lap to order_done and emits a review right after it', () => {
    const t = new LapTracker({ app: 'orders', pace: 1, speed: 1 });
    const out = run(t, clean('ord-0001', T0));
    expect(out.map((e) => e.type)).toEqual(['order_start', 'stage_start', 'stage_done', 'order_done', 'review']);
    const done = out[3]!;
    expect((done.detail as any).lap).toMatchObject({ ms: 4000, workMs: 3900, attempts: 1, retries: 0, downtimeMs: 0, issues: [], recoveries: [] });
    const rv = out[4]!;
    expect(rv).toMatchObject({ lane: '1', order: 'ord-0001' });
    expect((rv.detail as any).cum).toEqual({ stars: (rv.detail as any).stars, max: 5, count: 1 });
  });

  it('counts issues, retries and the merged downtime interval, and reviews a fault lower', () => {
    const t = new LapTracker({ app: 'orders', pace: 1, speed: 1 });
    const out = run(t, [
      ev('order_start', T0, 'ord-0001', undefined, { grabMs: 0 }),
      ev('stage_start', T0, 'ord-0001', 'intake'),
      ev('stage_fail', T0 + 1000, 'ord-0001', 'intake', { error: 'x' }),
      ev('recover_start', T0 + 1000, 'ord-0001', undefined, { action: 'retry' }),
      ev('stage_fail', T0 + 3000, 'ord-0001', 'intake', { error: 'x' }),
      ev('recover_done', T0 + 6000, 'ord-0001', undefined, { action: 'retry' }),
      ev('stage_done', T0 + 7000, 'ord-0001', 'intake'),
      ev('order_done', T0 + 7000, 'ord-0001'),
    ]);
    const lap = (out.find((e) => e.type === 'order_done')!.detail as any).lap;
    expect(lap).toMatchObject({ ms: 7000, attempts: 3, retries: 1, downtimeMs: 6000, issues: [{ stage: 'intake', count: 2 }] });
    expect(lap.recoveries).toEqual([{ stage: 'intake', action: 'retry', ms: 5000 }]);
    expect((out.at(-1)!.detail as any).stars).toBeLessThan(5);
  });

  it('a cancelled order gets one star and the running total follows each review', () => {
    const t = new LapTracker({ app: 'orders', pace: 1, speed: 1 });
    const out = run(t, [
      ...clean('ord-0001', T0),
      ev('order_start', T0 + 5000, 'ord-0002', undefined, {}),
      ev('order_failed', T0 + 6000, 'ord-0002', undefined, { outcome: 'cancelled' }),
    ]);
    const reviews = out.filter((e) => e.type === 'review').map((e) => e.detail as any);
    expect(reviews[1]).toMatchObject({ stars: 1, cum: { max: 10, count: 2 } });
    expect(reviews[1].cum.stars).toBe(reviews[0].stars + 1);
    const s = t.summary('1') as any;
    expect(s.orders).toMatchObject({ done: 1, cancelled: 1 });
    expect(s.stars).toMatchObject({ count: 2, max: 10 });
    expect(s.bestMs).toBe(4000);
    expect(s.slowestMs).toBe(4000);
    expect(s.totalMs).toBe(5000);
  });

  it('is a pure function of the stream: replaying gives the same result and lanes stay separate', () => {
    const evs = [...clean('ord-0001', T0), ...clean('ord-0001', T0 + 100, 3000).map((e) => ({ ...e, lane: '2' }))];
    const a = new LapTracker({ app: 'orders', pace: 2, speed: 1 });
    const b = new LapTracker({ app: 'orders', pace: 2, speed: 1 });
    expect(run(a, evs)).toEqual(run(b, evs));
    expect(a.summary('2')).toEqual(b.summary('2'));
    expect((a.summary('2') as any).stars.count).toBe(1);
  });

  it('omits bestMs when no order was completed', () => {
    const t = new LapTracker({ app: 'orders', pace: 1, speed: 1 });
    run(t, [ev('order_start', T0, 'ord-0001'), ev('order_failed', T0 + 10, 'ord-0001')]);
    expect(t.summary('1')).not.toHaveProperty('bestMs');
  });
});

describe('live server emits lap, review and summary (PT-C3)', () => {
  it('records review after order_done, extends wave_end and serves the lap endpoints', async () => {
    let rec!: (e: HauntEvent) => void;
    let end!: () => void;
    const engine: LiveEngine = { startWave: (_n, _s, r, e) => { rec = r; end = e!; } };
    const srv = new LiveServer({ engine });
    const { url } = await srv.listen(0);
    try {
      const post = await fetch(`${url}/api/wave/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lanes: 1, orders: 2 }) });
      expect(post.status).toBe(200);
      const now = Date.now();
      for (const e of clean('ord-0001', now)) rec({ ...e, ts: undefined as never, lane: '1' });
      end();
      const types = srv.log.events.filter((e) => e.lane !== undefined && e.type !== 'score').map((e) => e.type);
      expect(types.slice(types.indexOf('order_done'), types.indexOf('order_done') + 2)).toEqual(['order_done', 'review']);
      const we = srv.log.events.find((e) => e.type === 'wave_end')!;
      const row = (we.detail as any).summary['1'];
      expect(row).toMatchObject({ completed: 1, orders: { done: 1, cancelled: 0, parked: 0 }, stars: { count: 1, max: 5 } });
      expect(row.rating).toBeTypeOf('string');
      const laps = await (await fetch(`${url}/api/lane/1/laps`)).json();
      expect(laps).toHaveLength(1);
      expect(laps[0]).toMatchObject({ order: 'ord-0001', outcome: 'done' });
      expect(laps[0].lap).toBeTruthy();
      expect(laps[0].review.stars).toBeGreaterThanOrEqual(1);
      const wl = await (await fetch(`${url}/api/waves/1/laps`)).json();
      expect(wl.lanes[0]).toMatchObject({ lane: 1 });
      expect(wl.lanes[0].laps).toHaveLength(1);
      const ws = await (await fetch(`${url}/api/waves/1/stars`)).json();
      expect(ws.lanes[0].series[0]).toMatchObject({ order: 'ord-0001', cumMax: 5 });
    } finally {
      await srv.close();
    }
  });
});
