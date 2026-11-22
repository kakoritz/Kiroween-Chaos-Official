// TV3-C7: tournament endpoints on the live server (fake engine) and on the mock server.
import { afterEach, describe, expect, it } from 'vitest';
import { LiveServer, type LiveEngine } from '../src/live';
import { createMockServer } from '../src/mock/server';
import type { HauntEvent } from '../../haunt/src/score/score';

let srv: LiveServer | undefined;
afterEach(async () => { await srv?.close(); srv = undefined; });

/** An engine that plays each round at once: lane n finishes `n * 2` of its orders, so lane 1 is always the worst. */
function fakeEngine(log: { settings: unknown[] }): LiveEngine {
  return {
    startWave(_wave, settings, record, end) {
      log.settings.push(settings);
      const lanes = settings.tournament ? settings.tournament.lanes : Array.from({ length: settings.lanes }, (_, i) => i + 1);
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
}

async function boot() {
  const log = { settings: [] as unknown[] };
  srv = new LiveServer({ engine: fakeEngine(log), staticDir: '/nonexistent' });
  const { url } = await srv.listen(0);
  const get = async (p: string) => { const r = await fetch(url + p); return { status: r.status, body: await r.json() as any }; };
  const post = async (p: string, b?: unknown) => { const r = await fetch(url + p, { method: 'POST', body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, body: await r.json() as any }; };
  const until = async (fn: () => boolean) => { for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 10)); expect(fn()).toBe(true); };
  return { log, get, post, until };
}

describe('live tournament', () => {
  it('runs rounds of 5, 4, 3, 2 lanes, waits for Next after each (rule 49), drops one lane per round and crowns a champion', async () => {
    const { log, get, post, until } = await boot();
    expect((await post('/api/next')).status).toBe(409);
    expect((await get('/api/tournament')).body).toEqual({ phase: 'idle' });

    const start = await post('/api/tournament/start', { seed: 7 });
    expect(start.status).toBe(200);
    expect(start.body).toMatchObject({ round: 1, lanes: [1, 2, 3, 4, 5] });
    const types = () => srv!.log.events.map((e) => e.type);
    await until(() => types().includes('awaiting_next'));
    // Nothing starts until Next: no second wave, state says awaitingNext.
    await new Promise((r) => setTimeout(r, 60));
    expect(types().filter((x) => x === 'wave_start')).toHaveLength(1);
    const s1 = (await get('/api/state')).body;
    expect(s1.awaitingNext).toBe(true);
    expect(s1.tournament).toMatchObject({ round: 1, total: 4, phase: 'awaiting_next', alive: [2, 3, 4, 5] });
    expect(s1.corpses).toHaveLength(1);
    expect(s1.corpses[0]).toMatchObject({ lane: 1, kind: 'eliminated', round: 1 });
    expect(s1.lanes.find((l: { lane: number }) => l.lane === 1).fallen).toMatchObject({ round: 1 });
    const t1 = (await get('/api/tournament')).body;
    expect(t1).toMatchObject({ phase: 'awaiting_next', round: 1, alive: [2, 3, 4, 5] });
    expect(t1.history[0].standings.map((s: { lane: number }) => s.lane)).toEqual([5, 4, 3, 2, 1]);

    const lanesPerRound = [5];
    for (let r = 2; r <= 4; r++) {
      expect((await post('/api/next')).status).toBe(200);
      await until(() => types().filter((x) => x === 'round_end').length === r);
      lanesPerRound.push(((log.settings.at(-1) as { tournament: { lanes: number[] } }).tournament.lanes.length));
    }
    expect(lanesPerRound).toEqual([5, 4, 3, 2]);
    await until(() => types().includes('tournament_end'));
    const end = srv!.log.events.find((e) => e.type === 'tournament_end')!;
    expect(end.detail).toMatchObject({ champion: 5, rounds: 4 });
    expect(types().filter((x) => x === 'awaiting_next')).toHaveLength(3);
    expect((await post('/api/next')).status).toBe(409);
    const s4 = (await get('/api/state')).body;
    expect(s4.corpses.map((c: { lane: number }) => c.lane)).toEqual([1, 2, 3, 4]);
    expect(s4.tournament).toMatchObject({ phase: 'done', champion: 5 });

    // Rule 50: after lane 1 fell, no event of lane 1 other than its corpse marks.
    const fell = srv!.log.events.findIndex((e) => e.type === 'lane_eliminated' && Number(e.lane) === 1);
    expect(srv!.log.events.slice(fell + 2).filter((e) => e.lane !== undefined && Number(e.lane) === 1)).toEqual([]);
    // Same seeded wave seed for every lane of a round, and a round's script presses every live lane.
    const rounds = log.settings as { seed: number; tournament: { lanes: number[]; level: number; script: { presses: { lane: number }[] } } }[];
    expect(rounds.map((r) => r.tournament.level)).toEqual([3, 5, 7, 9]);
    for (const r of rounds) expect(new Set(r.tournament.script.presses.map((p) => p.lane))).toEqual(new Set(r.tournament.lanes.filter((l) => r.tournament.script.presses.some((p) => p.lane === l))));
  });

  it('validates the request and refuses a second start while a wave runs', async () => {
    const { post } = await boot();
    for (const bad of [{ seed: 1.5 }, { lanes: 9 }, { speed: 3 }, { rounds: [] }, { rounds: [{ lanes: 9 }] }]) expect((await post('/api/tournament/start', bad)).status).toBe(400);
    expect((await post('/api/tournament/start', {})).status).toBe(200);
    expect((await post('/api/tournament/start', {})).status).toBe(409);
  });

  it('custom rounds are honoured', async () => {
    const { post, until, get } = await boot();
    await post('/api/tournament/start', { rounds: [{ lanes: 5, orders: 3, intensity: 2 }, { lanes: 4, orders: 3, intensity: 2 }] });
    await until(() => srv!.log.events.some((e) => e.type === 'awaiting_next'));
    await post('/api/next');
    await until(() => srv!.log.events.some((e) => e.type === 'tournament_end'));
    expect((await get('/api/state')).body.tournament).toMatchObject({ total: 2, phase: 'done', champion: 5 });
  });
});

describe('mock tournament', () => {
  it('POST /api/tournament/start plays round 1 and waits; POST /api/next plays the next round', async () => {
    const m = createMockServer({ port: 0 });
    const port = await m.listen();
    try {
      const base = `http://127.0.0.1:${port}`;
      const post = (p: string, b?: unknown) => fetch(base + p, { method: 'POST', body: JSON.stringify(b ?? {}) });
      expect((await post('/api/next')).status).toBe(409);
      expect((await post('/api/tournament/start', { rounds: [{ lanes: 9 }] })).status).toBe(400);
      expect((await post('/api/tournament/start', { speed: 4, rounds: [{ lanes: 5, orders: 1, intensity: 3 }, { lanes: 4, orders: 1, intensity: 3 }] })).status).toBe(200);
      let state: any = {};
      for (let i = 0; i < 400 && !state.awaitingNext; i++) { await new Promise((r) => setTimeout(r, 50)); state = await (await fetch(`${base}/api/state`)).json(); }
      expect(state.awaitingNext).toBe(true);
      expect(state.corpses.length).toBeGreaterThanOrEqual(1);
      expect(state.tournament).toMatchObject({ round: 1, total: 2, phase: 'awaiting_next' });
      const t = await (await fetch(`${base}/api/tournament`)).json() as any;
      expect(t.history).toHaveLength(1);
      expect((await post('/api/next')).status).toBe(200);
      expect((await post('/api/next')).status).toBe(409);
    } finally { await m.close(); }
  }, 60000);
});
