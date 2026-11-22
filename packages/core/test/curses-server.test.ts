// TV3-C9: POST /api/curse, state.curses, GET /api/curses and the tournament giving lanes curses by level.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LiveServer, type LiveEngine } from '../src/live';
import { RunnerEngine } from '../../haunt/src/runner/engine';
import { createMockServer } from '../src/mock/server';
import type { HauntEvent } from '../../haunt/src/score/score';

let srv: LiveServer | undefined;
afterEach(async () => { await srv?.close(); srv = undefined; });

/** A live engine around a real RunnerEngine's curse methods, with waves that end at once. */
function boot() {
  const dir = mkdtempSync(join(tmpdir(), 'haunt-curses-'));
  const re = new RunnerEngine();
  let record: (e: HauntEvent) => void = () => {};
  const engine: LiveEngine = {
    startWave(wave, settings, rec, end) {
      record = (e) => { re.observe(e); rec(e); };
      re.startWave(wave, settings as never, record);
      setTimeout(() => end?.(), 5);
    },
    setChaosMode() { /* manual */ },
    addCurse: (lane, kind, endpoint, source) => re.addCurse(lane, kind, endpoint, source),
    endCurse: (lane, id) => re.endCurse(lane, id),
    clearCurses: () => re.clearCurses(),
    bindEmit: (fn) => re.bindEmit(fn),
    assignCurses: (lanes, level, seed, round) => re.assignCurses(lanes, level, seed, round),
  };
  srv = new LiveServer({ engine, staticDir: '/nonexistent', lessonsDir: join(dir, 'l'), patternsFile: join(dir, 'p.json'), runDir: dir });
  return { re, run: async () => {
    const { url } = await srv!.listen(0);
    const get = async (p: string) => { const r = await fetch(url + p); return { status: r.status, body: await r.json() as any }; };
    const post = async (p: string, b?: unknown) => { const r = await fetch(url + p, { method: 'POST', body: JSON.stringify(b ?? {}) }); return { status: r.status, body: await r.json() as any }; };
    const until = async (fn: () => boolean) => { for (let i = 0; i < 300 && !fn(); i++) await new Promise((r) => setTimeout(r, 10)); expect(fn()).toBe(true); };
    return { get, post, until };
  } };
}

describe('live server curses', () => {
  it('POST /api/curse validates, adds the curse, announces it and shows it in state; POST /api/curse/end ends it', async () => {
    const { run } = boot();
    const { get, post } = await run();
    for (const bad of [{ lane: 0, kind: '404', endpoint: 'charge' }, { lane: 2, kind: 'evil', endpoint: 'charge' }, { lane: 2, kind: '404', endpoint: 'moon' }, { lane: 2, kind: '404' }]) expect((await post('/api/curse', bad)).status).toBe(400);
    const r = await post('/api/curse', { lane: 2, kind: 'slow', endpoint: 'dispatch' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ lane: 2, kind: 'slow', endpoint: 'dispatch' });
    expect(r.body.delayMs).toBeGreaterThanOrEqual(2000);
    const ev = srv!.log.events.find((e) => e.type === 'curse_start')!;
    expect(ev).toMatchObject({ lane: '2', detail: { id: r.body.id, kind: 'slow', endpoint: 'dispatch', source: 'player' } });
    expect((await get('/api/state')).body.curses).toMatchObject([{ id: r.body.id, lane: 2, kind: 'slow', endpoint: 'dispatch' }]);
    const list = (await get('/api/curses')).body;
    expect(list.curses).toHaveLength(1);
    expect(list.kinds).toEqual(['404', 'slow', 'flaky500', 'clock_skew', 'rate_limit']);
    expect((await post('/api/curse/end', { lane: 2, id: 'nope' })).status).toBe(404);
    expect((await post('/api/curse/end', { lane: 2, id: r.body.id })).status).toBe(200);
    expect((await get('/api/state')).body.curses).toEqual([]);
    expect(srv!.log.events.some((e) => e.type === 'curse_end')).toBe(true);
  });

  it('a tournament gives every live lane the curses its round level allows, and they persist through the rounds and also on corpses', async () => {
    const { re, run } = boot();
    const { get, post, until } = await run();
    await post('/api/tournament/start', { seed: 7, rounds: [{ lanes: 5, orders: 2, intensity: 4 }, { lanes: 4, orders: 2, intensity: 7 }] });
    await until(() => srv!.log.events.some((e) => e.type === 'awaiting_next'));
    expect([1, 2, 3, 4, 5].map((l) => re.curses.get(l)?.length ?? 0)).toEqual([1, 1, 1, 1, 1]);
    const starts1 = srv!.log.events.filter((e) => e.type === 'curse_start');
    expect(starts1).toHaveLength(5);
    expect(starts1.every((e) => (e.detail as any).source === 'plan')).toBe(true);
    await post('/api/next');
    await until(() => srv!.log.events.some((e) => e.type === 'tournament_end'));
    // Round 2 (level 7) tops each live lane up to two; the lane that fell in round 1 keeps its one.
    const counts = [1, 2, 3, 4, 5].map((l) => re.curses.get(l)?.length ?? 0);
    expect(counts.filter((c) => c === 2)).toHaveLength(4);
    expect(counts.filter((c) => c === 1)).toHaveLength(1);
    expect((await get('/api/state')).body.curses.length).toBe(9);
    // A new tournament starts clean.
    await srv!.close(); srv = undefined;
  });
});

describe('mock server curses', () => {
  it('POST /api/curse and state.curses', async () => {
    const m = createMockServer({ port: 0 });
    const port = await m.listen();
    try {
      const base = `http://127.0.0.1:${port}`;
      const post = (b: unknown) => fetch(`${base}/api/curse`, { method: 'POST', body: JSON.stringify(b) });
      expect((await post({ lane: 9, kind: '404', endpoint: 'charge' })).status).toBe(400);
      expect((await post({ lane: 1, kind: 'x', endpoint: 'charge' })).status).toBe(400);
      expect((await post({ lane: 1, kind: '404', endpoint: 'charge' })).status).toBe(200);
      const state = await (await fetch(`${base}/api/state`)).json() as any;
      expect(state.curses).toMatchObject([{ lane: 1, kind: '404', endpoint: 'charge' }]);
      expect((await (await fetch(`${base}/api/curses`)).json() as any).curses).toHaveLength(1);
      expect((await fetch(`${base}/api/demo/start`, { method: 'POST', body: JSON.stringify({ script: 'curses-404', speed: 4 }) })).status).toBe(200);
    } finally { await m.close(); }
  });
});
