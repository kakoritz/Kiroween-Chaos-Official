// TV3-C2: the optional auto-continue of the review state. Off by default; Next still works by hand.
import { afterEach, describe, expect, it } from 'vitest';
import { LiveServer, type LiveEngine } from '../src/live';
import type { HauntEvent } from '../../haunt/src/score/score';

let srv: LiveServer | undefined;
afterEach(async () => { await srv?.close(); srv = undefined; });

const engine: LiveEngine = {
  startWave(_wave, settings, record, end) {
    const lanes = settings.tournament ? settings.tournament.lanes : [1];
    for (const lane of lanes) {
      for (let i = 1; i <= Math.min(settings.orders, lane * 2); i++) {
        const order = `ord-${String(i).padStart(4, '0')}`;
        record({ type: 'order_start', lane: String(lane), order, detail: { index: i, total: settings.orders } } as HauntEvent);
        record({ type: 'order_done', lane: String(lane), order, detail: { clean: true, ms: 1000 } } as HauntEvent);
      }
    }
    setTimeout(() => end?.(), 5);
  },
  setChaosMode() { /* manual */ },
};

async function boot() {
  srv = new LiveServer({ engine, staticDir: '/nonexistent' });
  const { url } = await srv.listen(0);
  const post = async (p: string, b?: unknown) => { const r = await fetch(url + p, { method: 'POST', body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, body: (await r.json()) as any }; };
  const count = (t: string) => srv!.log.events.filter((e) => e.type === t).length;
  const until = async (fn: () => boolean, ms = 4000) => { for (let i = 0; i < ms / 10 && !fn(); i++) await new Promise((r) => setTimeout(r, 10)); expect(fn()).toBe(true); };
  return { post, count, until };
}

describe('auto-continue', () => {
  it('is off by default: the review state waits for Next', async () => {
    const { post, count, until } = await boot();
    expect((await post('/api/tournament/start', { seed: 3 })).body.autoContinueSec).toBeUndefined();
    await until(() => count('awaiting_next') === 1);
    await new Promise((r) => setTimeout(r, 400));
    expect(count('round_start')).toBe(1);
    expect((await post('/api/next')).status).toBe(200);
  });

  it('presses Next by itself after the set seconds and plays the whole tournament', async () => {
    const { post, count, until } = await boot();
    const r = await post('/api/tournament/start', { seed: 3, autoContinueSec: 0.05 });
    expect(r.body.autoContinueSec).toBe(0.05);
    await until(() => count('tournament_end') === 1);
    expect(count('round_start')).toBe(count('round_end'));
    expect(count('awaiting_next')).toBe(count('round_end') - 1);
  });

  it('can be changed live, and 0 turns it off again', async () => {
    const { post, count, until } = await boot();
    await post('/api/tournament/start', { seed: 3 });
    await until(() => count('awaiting_next') === 1);
    expect((await post('/api/tournament/auto-continue', { seconds: 0.05 })).body).toEqual({ autoContinueSec: 0.05 });
    await until(() => count('round_start') === 2);
    await until(() => count('awaiting_next') === 2);
    expect((await post('/api/tournament/auto-continue', { seconds: 0 })).body).toEqual({ autoContinueSec: 0 });
    await new Promise((r) => setTimeout(r, 300));
    expect(count('round_start')).toBe(2);
  });

  it('a hand-pressed Next cancels the timer (no double start)', async () => {
    const { post, count, until } = await boot();
    await post('/api/tournament/start', { seed: 3, autoContinueSec: 0.3 });
    await until(() => count('awaiting_next') === 1);
    expect((await post('/api/next')).status).toBe(200);
    await new Promise((r) => setTimeout(r, 450));
    expect(count('round_start')).toBeLessThanOrEqual(3);
    expect(count('round_start')).toBeGreaterThanOrEqual(2);
  });

  it('rejects bad values, and the live setter needs a tournament', async () => {
    const { post } = await boot();
    expect((await post('/api/tournament/auto-continue', { seconds: 5 })).status).toBe(409);
    for (const v of [-1, 4000, 'x']) expect((await post('/api/tournament/start', { autoContinueSec: v })).status).toBe(400);
  });
});
