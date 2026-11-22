// TV3-C8: lessons through the live tournament: learning at round end, `lesson` events, the +25 bonus, the overlay file, endpoints.
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LiveServer, type LiveEngine } from '../src/live';
import type { HauntEvent } from '../../haunt/src/score/score';

let srv: LiveServer | undefined;
afterEach(async () => { await srv?.close(); srv = undefined; });

/** Round 1: lane 2 loses an order to an outage at Payment, lane 3 rides one out with a backoff, the others are calm. */
function engine(): LiveEngine {
  return {
    startWave(_wave, settings, record, end) {
      const lanes: number[] = settings.tournament!.lanes;
      const round = settings.tournament!.round;
      const ev = (type: string, lane: number, detail: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => record({ type, lane: String(lane), detail, ...extra } as HauntEvent);
      for (const lane of lanes) {
        const orders = lane === 1 ? 0 : lane * 2;
        for (let i = 1; i <= Math.min(orders, 6); i++) {
          const order = `ord-${String(i).padStart(4, '0')}`;
          ev('order_start', lane, { index: i, total: 6 }, { order });
          ev('stage_start', lane, { attempt: 1 }, { order, stage: 'payment' });
          if (round === 1 && i === 1 && lane === 2) {
            ev('chaos', lane, { fault: 'endpoint_down', creature: 'gargoyle', scope: 'outer', depth: 1, injectedAt: 'during', source: 'random' }, { stage: 'payment' });
            ev('stage_fail', lane, { error: 'x', attempt: 1 }, { order, stage: 'payment' });
            ev('order_failed', lane, { reason: 'charge failed' }, { order });
            continue;
          }
          if (round === 1 && i === 1 && lane === 3) {
            ev('chaos', lane, { fault: 'endpoint_down', creature: 'gargoyle', scope: 'outer', depth: 1, injectedAt: 'during', source: 'random' }, { stage: 'payment' });
            ev('recover_start', lane, { action: 'backoff', attempt: 1 });
            ev('recover_done', lane, { action: 'backoff', ms: 2000 });
          }
          ev('stage_done', lane, { ms: 100, skipped: false }, { order, stage: 'payment' });
          ev('order_done', lane, { clean: true, ms: 1000 }, { order });
        }
      }
      setTimeout(() => end?.(), 5);
    },
    setChaosMode() { /* manual */ },
  };
}

async function boot() {
  const lessonsDir = join(mkdtempSync(join(tmpdir(), 'haunt-ls-')), 'lessons');
  srv = new LiveServer({ engine: engine(), staticDir: '/nonexistent', lessonsDir });
  const { url } = await srv.listen(0);
  const get = async (p: string) => { const r = await fetch(url + p); return { status: r.status, body: await r.json() as any }; };
  const post = async (p: string, b?: unknown) => { const r = await fetch(url + p, { method: 'POST', body: JSON.stringify(b ?? {}) }); return { status: r.status, body: await r.json() as any }; };
  const del = async (p: string) => { const r = await fetch(url + p, { method: 'DELETE' }); return { status: r.status, body: await r.json() as any }; };
  const until = async (fn: () => boolean) => { for (let i = 0; i < 300 && !fn(); i++) await new Promise((r) => setTimeout(r, 10)); expect(fn()).toBe(true); };
  return { lessonsDir, get, post, del, until };
}

describe('lessons in a live tournament', () => {
  it('learns at round end, emits lesson events after round_end, pays the first-time bonus, writes the overlay for the next round, serves and resets', async () => {
    const { lessonsDir, get, post, del, until } = await boot();
    await post('/api/tournament/start', { seed: 7, resetLessons: true });
    await until(() => srv!.log.events.some((e) => e.type === 'awaiting_next'));
    const events = srv!.log.events;
    const roundEnd = events.find((e) => e.type === 'round_end')!;
    const lessons = events.filter((e) => e.type === 'lesson');
    expect(lessons.map((e) => [Number(e.lane), (e.detail as any).via, (e.detail as any).mechanism])).toEqual([[2, 'suggested', 'retry_backoff'], [3, 'overcame', 'retry_backoff']]);
    expect(events.indexOf(lessons[0]!)).toBeGreaterThan(events.indexOf(roundEnd));
    expect((lessons[0]!.detail as any).signature).toBe('payment + endpoint_down + order_lost');
    expect((lessons[1]!.detail as any).signature).toBe('payment + endpoint_down + recovered');
    expect((roundEnd.detail as any).lessons).toHaveLength(2);

    // First time overcome: +25 for lane 3 only (capped at +200).
    const st = (roundEnd.detail as any).standings;
    expect(st.find((s: any) => s.lane === 3).lessonsBonus).toBe(25);
    expect(st.find((s: any) => s.lane === 2).lessonsBonus).toBe(0);

    const l2 = (await get('/api/lessons/2')).body;
    expect(l2).toMatchObject({ lane: 2, tier: 'retrier', lessons: [{ via: 'suggested', action: 'retry_backoff', learnedRound: 1 }] });
    expect(l2.policy.rules).toEqual([{ stage: 'payment', fault: 'endpoint_down', action: 'retry_backoff', backoff: 'exp', maxAttempts: 5 }]);
    expect((await get('/api/lessons/9')).status).toBe(400);
    // The overlay of lane 2 is written when round 2 starts, before its bot would.
    expect(existsSync(join(lessonsDir, 'lane-2.policy.json'))).toBe(false);
    await post('/api/next');
    expect(existsSync(join(lessonsDir, 'lane-2.policy.json'))).toBe(true);
    expect(existsSync(join(lessonsDir, 'lane-4.policy.json'))).toBe(false);
    await until(() => srv!.log.events.filter((e) => e.type === 'round_end').length === 2);
    // Learned once: round 2 meets nothing new on lane 2, so no second lesson for the same signature.
    expect(srv!.log.events.filter((e) => e.type === 'lesson' && Number(e.lane) === 2)).toHaveLength(1);

    expect((await del('/api/lessons')).status).toBe(200);
    expect((await get('/api/lessons/2')).body.lessons).toEqual([]);
    expect(existsSync(join(lessonsDir, 'lane-2.policy.json'))).toBe(false);
  });

  it('resetLessons on start clears what an earlier tournament learned', async () => {
    const { get, post, until } = await boot();
    await post('/api/tournament/start', { seed: 7, resetLessons: true });
    await until(() => srv!.log.events.some((e) => e.type === 'awaiting_next'));
    expect((await get('/api/lessons/2')).body.lessons).toHaveLength(1);
    await srv!.close(); srv = undefined;
  });
});
