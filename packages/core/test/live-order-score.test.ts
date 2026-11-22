import { describe, expect, it } from 'vitest';
import { LiveServer, type LiveEngine } from '../src/live/server';
import { orderRecord } from '../src/live/laps';
import { laneOrderRecord } from '../src/mock/queries';
import type { HauntEvent } from '../../haunt/src/score/score';

const ev = (type: string, ts: number, order?: string, stage?: string, detail: Record<string, unknown> = {}): HauntEvent =>
  ({ type, ts, lane: '1', ...(order ? { order } : {}), ...(stage ? { stage } : {}), detail } as HauntEvent);

async function boot() {
  let rec!: (e: HauntEvent) => void;
  const engine: LiveEngine = { startWave: (_n, _s, r) => { rec = r; } };
  const srv = new LiveServer({ engine });
  const { url } = await srv.listen(0);
  const r = await fetch(`${url}/api/wave/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lanes: 1, orders: 3 }) });
  expect(r.status).toBe(200);
  return { srv, url, rec, now: Date.now() };
}

describe('live review score and order record (PT-C3-remainder)', () => {
  it('records a score event of (stars - 3) x 40 right after each review', async () => {
    const { srv, rec, now } = await boot();
    try {
      rec(ev('order_start', now, 'ord-0001', undefined, { grabMs: 100 }));
      rec(ev('stage_start', now + 100, 'ord-0001', 'create'));
      rec(ev('stage_done', now + 3900, 'ord-0001', 'create', { walkMs: 0 }));
      rec(ev('order_done', now + 4000, 'ord-0001'));
      rec(ev('order_start', now + 6000, 'ord-0002'));
      rec(ev('order_failed', now + 6100, 'ord-0002', undefined, { outcome: 'cancelled' }));
      const evs = srv.log.events;
      const reviews = evs.filter((e) => e.type === 'review');
      expect(reviews).toHaveLength(2);
      for (const rv of reviews) {
        const stars = (rv.detail as any).stars as number;
        const after = evs[evs.indexOf(rv) + 1];
        const delta = (stars - 3) * 40;
        if (delta === 0) continue;
        expect(after).toMatchObject({ type: 'score', order: rv.order, detail: { delta, reason: 'review' } });
      }
      expect((reviews[1]!.detail as any).stars).toBe(1);
      expect(evs.filter((e) => e.type === 'score' && (e.detail as any).reason === 'review' && e.order === 'ord-0002')[0]!.detail).toMatchObject({ delta: -80 });
    } finally {
      await srv.close();
    }
  });

  it('GET /api/lane/:lane/order/:order returns the record, 404 for an unknown order, 400 for a bad lane', async () => {
    const { srv, url, rec, now } = await boot();
    try {
      rec(ev('order_start', now, 'ord-0001', undefined, { grabMs: 100 }));
      rec(ev('stage_start', now + 100, 'ord-0001', 'create'));
      rec(ev('stage_fail', now + 600, 'ord-0001', 'create', { error: 'boom', retryable: true }));
      rec(ev('recover_start', now + 700, 'ord-0001', 'create', { action: 'retry' }));
      rec(ev('recover_done', now + 1200, 'ord-0001', 'create', { action: 'retry', ms: 500, depth: 1 }));
      rec(ev('stage_start', now + 1300, 'ord-0001', 'create'));
      rec(ev('stage_done', now + 3900, 'ord-0001', 'create', { walkMs: 0 }));
      rec(ev('order_done', now + 4000, 'ord-0001'));
      const res = await fetch(`${url}/api/lane/1/order/ord-0001`);
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body).toMatchObject({ order: 'ord-0001', outcome: 'done', startTs: now, endTs: now + 4000 });
      expect(body.lap).toBeTruthy();
      expect(body.review.stars).toBeGreaterThanOrEqual(1);
      expect(body.stages).toHaveLength(1);
      expect(body.stages[0]).toMatchObject({ stage: 'create', status: 'done', attempts: 2, retries: 1, recoverable: true, issues: 1, downtimeMs: 500 });
      expect(body.stages[0].recoveries).toEqual([{ startTs: now + 700, endTs: now + 1200, ms: 500, action: 'retry', depth: 1 }]);
      expect(srv.log.events.length).toBeGreaterThan(0);
      expect(body).toEqual(JSON.parse(JSON.stringify(orderRecord(srv.log.events, 1, 'ord-0001', 1))));
      const miss = await fetch(`${url}/api/lane/1/order/ord-9999`);
      expect([miss.status, ((await miss.json()) as any).error.code]).toEqual([404, 'not_found']);
      const bad = await fetch(`${url}/api/lane/9/order/ord-0001`);
      expect([bad.status, ((await bad.json()) as any).error.code]).toEqual([400, 'bad_lane']);
    } finally {
      await srv.close();
    }
  });

  it('mock and live share one implementation of the record', () => {
    const events = [
      ev('order_start', 1000, 'ord-0001'), ev('stage_start', 1100, 'ord-0001', 'create'), ev('stage_done', 1900, 'ord-0001', 'create'),
      ev('order_done', 2000, 'ord-0001'),
    ].map((e) => ({ ...e, lane: 1 })) as unknown as HauntEvent[];
    expect(laneOrderRecord({ buffer: events } as any, 1, 'ord-0001')).toEqual(orderRecord(events, 1, 'ord-0001'));
  });
});
