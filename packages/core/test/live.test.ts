import { afterEach, describe, expect, it } from 'vitest';
import { LiveServer, type LiveEngine } from '../src/live';

let srv: LiveServer | undefined;
afterEach(async () => { await srv?.close(); srv = undefined; });

async function boot(engine?: LiveEngine, pingMs?: number) {
  srv = new LiveServer({ engine, pingMs, staticDir: '/nonexistent' });
  const { url } = await srv.listen(0);
  const get = async (p: string) => { const r = await fetch(url + p); return { status: r.status, body: await r.json() as any }; };
  const post = async (p: string, b?: unknown) => {
    const r = await fetch(url + p, { method: 'POST', body: b === undefined ? undefined : JSON.stringify(b) });
    return { status: r.status, body: await r.json() as any };
  };
  return { url, get, post };
}

async function readSse(url: string, until: (events: any[]) => boolean, ms = 3000): Promise<{ events: any[]; raw: string }> {
  const ctl = new AbortController();
  const r = await fetch(url, { signal: ctl.signal });
  const dec = new TextDecoder();
  let raw = '';
  const events: any[] = [];
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    for await (const chunk of r.body as any) {
      raw += dec.decode(chunk);
      events.length = 0;
      for (const m of raw.split('\n\n')) if (m.startsWith('data: ')) events.push(JSON.parse(m.slice(6)));
      if (until(events)) break;
    }
  } catch { /* aborted */ }
  clearTimeout(timer);
  ctl.abort();
  return { events, raw };
}

describe('live server: reads', () => {
  it('health and idle state (rule 35)', async () => {
    const { get } = await boot();
    expect((await get('/api/health')).body).toMatchObject({ contractVersion: 1, mode: 'live' });
    const s = (await get('/api/state')).body;
    expect(s.wave).toBeNull();
    expect(s.lanes).toEqual([]);
    expect(s.boss).toEqual({ next: null, startsInMs: null, active: false });
    expect(s.stages).toHaveLength(11);
    expect(s.stages.map((x: { id: string }) => x.id)).toEqual(['account', 'create', 'submit', 'payment', 'confirmation', 'receive', 'process', 'updates', 'ship', 'transit', 'handoff']);
    expect(s.stages[0]).toMatchObject({ id: 'account', label: 'Account or login', kind: 'effect' });
    expect(s.stages.map((x: { kind: string }) => x.kind)).toEqual(['effect', 'read', 'effect', 'effect', 'effect', 'effect', 'effect', 'effect', 'effect', 'poll', 'final']);
    expect(s.demo).toEqual({ scripts: ['hero', 'full', 'loop'], running: null });
  });

  it('creature catalog covers every fault and the three bosses', async () => {
    const { get } = await boot();
    const cs = (await get('/api/creatures')).body as any[];
    expect(cs).toHaveLength(21);
    expect(cs.filter((c) => c.boss).map((c) => c.id).sort()).toEqual(['banshee_queen', 'headless_horseman', 'lich']);
    expect(cs.find((c) => c.id === 'zombie').causes).toEqual(['timeout', 'comm_timeout', 'slow_link']);
    for (const c of cs) expect(c.sprite).toBe(c.id);
  });
  it('serves a display name and description for every creature', async () => {
    const { get } = await boot();
    const cs = (await get('/api/creatures')).body as any[];
    const label = (id: string) => cs.find((c) => c.id === id).label;
    expect([label('reaper'), label('zombie'), label('ghost'), label('lich')]).toEqual(['Reaper', 'Zombie', 'Ghost', 'Lich']);
    expect(label('will_o_wisp')).toBe('Will-o-the-wisp');
    for (const c of cs) {
      expect(c.label).toMatch(/^[A-Z]/);
      expect(c.label).not.toBe(c.id);
      expect(c.description.length).toBeGreaterThan(0);
    }
  });

  it('apps list and app switch emits reset', async () => {
    const { get, post } = await boot();
    expect((await get('/api/apps')).body.map((a: any) => a.id)).toEqual(['orders', 'inbox']);
    const before = srv!.log.events.length;
    expect((await post('/api/app', { app: 'inbox' })).status).toBe(200);
    expect(srv!.log.events.length).toBe(before + 1);
    expect((await get('/api/state')).body.stages.map((s: any) => s.id)).toEqual(['fetch', 'classify', 'ticket', 'draft', 'reply', 'archive']);
    expect((await post('/api/app', { app: 'x' })).body.error.code).toBe('bad_request');
  });
});

describe('live server: waves', () => {
  it('starts a wave with the lane to tier mapping and ends it on stop', async () => {
    const { get, post } = await boot();
    const r = await post('/api/wave/start', { orders: 5, lanes: 3, seed: 9 });
    expect(r).toMatchObject({ status: 200, body: { wave: 1 } });
    const s = (await get('/api/state')).body;
    expect(s.wave).toMatchObject({ n: 1, running: true, seed: 9, orders: 5, tiers: 'race' });
    expect(s.lanes.map((l: any) => l.tier)).toEqual(['rookie', 'journaler', 'phoenix']);
    expect(s.lanes[2].parts.filter((p: any) => p.installed).map((p: any) => p.id).sort()).toEqual(['breaker', 'idempotency', 'journal', 'offline_queue', 'retry']);
    expect((await post('/api/wave/start', {})).body.error.code).toBe('wave_running');
    expect((await post('/api/app', { app: 'inbox' })).body.error.code).toBe('wave_running');
    expect((await post('/api/wave/stop')).status).toBe(200);
    expect((await post('/api/wave/stop')).body.error.code).toBe('no_wave');
    const waves = (await get('/api/waves')).body;
    expect(waves).toHaveLength(1);
    expect(waves[0].endedAt).toBeTypeOf('number');
    const end = srv!.log.events.at(-1)!;
    expect(end.type).toBe('wave_end');
    expect((end.detail as any).stopped).toBe(true);
  });

  it('wave_start detail and lane_ready events follow the protocol', async () => {
    const { post } = await boot();
    await post('/api/wave/start', { orders: 4, lanes: 2, speed: 2, pace: 'show' });
    const evs = srv!.log.events;
    const ws = evs.find((e) => e.type === 'wave_start')!;
    expect(ws.detail).toMatchObject({ orders: 4, lanes: 2, speed: 2, pace: 'show', app: 'orders', tiers: 'race' });
    const ready = evs.filter((e) => e.type === 'lane_ready');
    expect(ready.map((e) => (e.detail as any).tier)).toEqual(['rookie', 'phoenix']);
    expect(evs.indexOf(ws)).toBeLessThan(evs.indexOf(ready[0]!));
  });

  it('rejects bad wave parameters', async () => {
    const { post } = await boot();
    for (const b of [{ lanes: 6 }, { lanes: 0 }, { orders: 0 }, { speed: 3 }, { tiers: 'x' }, { pace: 'x' }, { app: 'x' }, { seed: 1.5 }]) {
      const r = await post('/api/wave/start', b);
      expect([r.status, r.body.error.code]).toEqual([400, 'bad_request']);
    }
    expect((await post('/api/wave/stop')).body.error.code).toBe('no_wave');
  });

  it('allPhoenix gives every lane the full kit', async () => {
    const { get, post } = await boot();
    await post('/api/wave/start', { lanes: 3, tiers: 'allPhoenix' });
    expect((await get('/api/state')).body.lanes.map((l: any) => l.tier)).toEqual(['phoenix', 'phoenix', 'phoenix']);
  });
});

describe('live server: lane views from events', () => {
  it('tracks state, counts, score and the log', async () => {
    const { get, post } = await boot();
    await post('/api/wave/start', { orders: 2, lanes: 1 });
    const rec = (ev: any) => srv!.waves.record(ev);
    rec({ type: 'order_start', lane: '1', order: 'ord-0001', detail: { index: 1, total: 2 } });
    rec({ type: 'stage_start', lane: '1', order: 'ord-0001', stage: 'payment', detail: { attempt: 1 } });
    rec({ type: 'chaos', lane: '1', order: 'ord-0001', stage: 'payment', detail: { creature: 'reaper', fault: 'crash', scope: 'inner', depth: 1, injectedAt: 'after_effect', source: 'user' } });
    rec({ type: 'process_dead', lane: '1', detail: { reason: 'crash', restartInMs: 1000 } });
    expect((await get('/api/state')).body.lanes[0]).toMatchObject({ state: 'dead', stage: 'payment', stageIndex: 3, depth: 1, order: 'ord-0001' });
    rec({ type: 'process_up', lane: '1', detail: { attempt: 2 } });
    rec({ type: 'order_done', lane: '1', order: 'ord-0001', detail: { clean: false, ms: 5000, repeats: 0 } });
    const lane = (await get('/api/state')).body.lanes[0];
    expect(lane).toMatchObject({ state: 'working', depth: 0, counts: { completed: 1 } });

    const log = (await get('/api/lane/1/log')).body.lines;
    expect(log.map((l: any) => l.type)).toEqual(expect.arrayContaining(['order_start', 'chaos', 'process_dead', 'order_done']));
    expect(log.find((l: any) => l.type === 'process_dead')).toMatchObject({ level: 'error', text: 'Bot died: crash' });
    const since = log.at(-1).seq;
    expect((await get(`/api/lane/1/log?since=${since}`)).body.lines).toEqual([]);

    const st = (await get('/api/lane/1/stage/payment?order=ord-0001')).body;
    expect(st).toMatchObject({ lane: 1, order: 'ord-0001', stage: 'payment', status: 'dead' });
    expect(st.attempts).toEqual([expect.objectContaining({ attempt: 1, status: 'killed' })]);
    expect(st.chaos).toHaveLength(1);
    expect((await get('/api/lane/1/orders')).body).toEqual([{ order: 'ord-0001', outcome: 'done' }]);
    expect((await get('/api/lane/2/log')).body.error.code).toBe('bad_lane');
    expect((await get('/api/lane/1/stage/nope')).body.error.code).toBe('bad_request');
  });

  it('wave_end marks working lanes done', async () => {
    const { get, post } = await boot();
    await post('/api/wave/start', { lanes: 1 });
    srv!.waves.record({ type: 'order_start', lane: '1', order: 'ord-0001', detail: { index: 1, total: 12 } });
    await post('/api/wave/stop');
    expect((await get('/api/state')).body.lanes[0].state).toBe('done');
  });
});

describe('live server: chaos', () => {
  const engine = (): LiveEngine => ({ chaos: (r) => ({ chaosId: 'c1', creature: r.creature!, fault: r.fault, depth: 1, deferred: false }) });

  it('validates before touching the engine', async () => {
    const { post } = await boot(engine());
    expect((await post('/api/chaos', { lane: 1, fault: 'crash' })).body.error.code).toBe('no_wave');
    await post('/api/wave/start', { lanes: 2 });
    expect((await post('/api/chaos', { lane: 1, creature: 'nope' })).body.error.code).toBe('bad_creature');
    expect((await post('/api/chaos', { lane: 1, fault: 'nope' })).body.error.code).toBe('bad_fault');
    expect((await post('/api/chaos', { lane: 1, creature: 'reaper', fault: 'timeout' })).body.error.code).toBe('bad_fault');
    expect((await post('/api/chaos', { lane: 9, fault: 'crash' })).body.error.code).toBe('bad_lane');
    expect((await post('/api/chaos', { fault: 'crash' })).body.error.code).toBe('bad_lane');
    expect((await post('/api/chaos', { lane: 1, fault: 'crash' })).body.error.code).toBe('lane_not_active');
  });

  it('passes a valid press to the engine and enforces depth 5', async () => {
    const { post } = await boot(engine());
    await post('/api/wave/start', { lanes: 2 });
    srv!.waves.record({ type: 'order_start', lane: '1', order: 'ord-0001', detail: { index: 1, total: 12 } });
    expect((await post('/api/chaos', { lane: 1, fault: 'crash' })).body).toMatchObject({ chaosId: 'c1', creature: 'reaper', fault: 'crash' });
    expect((await post('/api/chaos', { lane: 1, creature: 'zombie' })).body.creature).toBe('zombie');
    const random = (await post('/api/chaos', { lane: 1 })).body;
    expect(random.fault).toBeTypeOf('string');
    srv!.waves.record({ type: 'chaos', lane: '1', detail: { creature: 'reaper', fault: 'crash', depth: 5 } });
    expect((await post('/api/chaos', { lane: 1, fault: 'crash' })).body.error.code).toBe('depth_limit');
  });

  it('boss faults need no lane', async () => {
    const { post } = await boot(engine());
    await post('/api/wave/start', { lanes: 2 });
    expect((await post('/api/chaos', { fault: 'boss_power_outage' })).body).toMatchObject({ creature: 'lich' });
  });

  it('without an engine a valid press is not_applicable', async () => {
    const { post } = await boot();
    await post('/api/wave/start', { lanes: 1 });
    srv!.waves.record({ type: 'order_start', lane: '1', order: 'ord-0001', detail: { index: 1, total: 12 } });
    expect((await post('/api/chaos', { lane: 1, fault: 'crash' })).body.error.code).toBe('not_applicable');
  });

  it('chaos mode and speed', async () => {
    const { get, post } = await boot();
    expect((await post('/api/chaos/mode', { mode: 'random', frequency: 0.5, seed: 3 })).status).toBe(200);
    expect((await get('/api/state')).body.chaos).toEqual({ mode: 'random', frequency: 0.5, seed: 3 });
    expect((await post('/api/chaos/mode', { mode: 'wild' })).status).toBe(400);
    expect((await post('/api/chaos/mode', { mode: 'off', frequency: 2 })).status).toBe(400);
    expect((await post('/api/speed', { speed: 2 })).body).toEqual({ speed: 2 });
    expect((await post('/api/speed', { speed: 3 })).status).toBe(400);
  });
});

describe('live server: demo, waves and errors', () => {
  it('demo needs the engine and validates the script', async () => {
    const { get, post } = await boot({ startDemo: () => {} });
    expect((await post('/api/demo/start', { script: 'nope' })).body.error.code).toBe('bad_request');
    expect((await post('/api/demo/start', { script: 'hero' })).status).toBe(200);
    expect((await get('/api/state')).body.demo.running).toBe('hero');
    expect((await post('/api/demo/stop')).status).toBe(200);
    expect((await get('/api/state')).body.demo.running).toBeNull();
  });

  it('report, postmortem and hardening are not_ready; compare needs ended waves', async () => {
    const { get, post } = await boot();
    await post('/api/wave/start', { lanes: 1 });
    expect((await get('/api/waves/1/postmortem')).body.error.code).toBe('not_ready');
    expect((await get('/api/waves/9/report')).status).toBe(404);
    await post('/api/wave/stop');
    await post('/api/wave/start', { lanes: 1 });
    await post('/api/wave/stop');
    const c = (await get('/api/waves/1/compare/2')).body;
    expect(c.cells).toEqual([expect.objectContaining({ lane: 1, change: 'same' })]);
  });

  it('bad json, unknown routes and CORS', async () => {
    const { url, post } = await boot();
    const r = await fetch(url + '/api/speed', { method: 'POST', body: '{nope' });
    expect([r.status, ((await r.json()) as any).error.code]).toEqual([400, 'bad_request']);
    expect((await fetch(url + '/api/nothing')).status).toBe(404);
    const ok = await fetch(url + '/api/health', { headers: { origin: 'http://localhost:5173' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    const no = await fetch(url + '/api/health', { headers: { origin: 'http://evil.example' } });
    expect(no.headers.get('access-control-allow-origin')).toBeNull();
    expect((await fetch(url + '/api/chaos', { method: 'OPTIONS', headers: { origin: 'http://127.0.0.1:5173' } })).status).toBe(204);
    void post;
  });
});

describe('live server: SSE', () => {
  it('sends hello first, then live events, with integer lanes and no lane on globals', async () => {
    const { url, post } = await boot();
    const reading = readSse(url + '/api/events', (e) => e.some((x) => x.type === 'lane_ready'));
    await new Promise((r) => setTimeout(r, 100));
    await post('/api/wave/start', { lanes: 1 });
    const { events } = await reading;
    expect(events[0]).toMatchObject({ type: 'hello', contractVersion: 1, mode: 'live', app: 'orders' });
    // V1_2 section 1: the hello carries the stage list as data, account first.
    expect(events[0].stages.map((s: { id: string }) => s.id)).toEqual(['account', 'create', 'submit', 'payment', 'confirmation', 'receive', 'process', 'updates', 'ship', 'transit', 'handoff']);
    expect(events[0].stages[1]).toEqual({ id: 'create', label: 'Create order', icon: 'mail', workAnimation: 'read_mail', kind: 'read' });
    expect(events[0].seq).toBe(1);
    const ws = events.find((e) => e.type === 'wave_start');
    expect('lane' in ws).toBe(false);
    expect(events.find((e) => e.type === 'lane_ready').lane).toBe(1);
    const seqs = events.slice(1).map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });

  it('since is exclusive and replays retained events', async () => {
    const { url, post } = await boot();
    await post('/api/wave/start', { lanes: 1 });
    const { events } = await readSse(url + '/api/events?since=1', (e) => e.some((x) => x.type === 'lane_ready'));
    expect(events.slice(1).map((e) => e.type)).toEqual(['wave_start', 'lane_ready']);
    expect(events.slice(1).every((e) => e.seq > 1)).toBe(true);
  });

  it('answers 410 gone when since is older than the retained window', async () => {
    const { url } = await boot();
    for (let i = 0; i < 5100; i++) srv!.log.emit({ type: 'stage_progress', lane: '1', detail: { pct: 1, label: 'x' } });
    const r = await fetch(url + '/api/events?since=3');
    expect([r.status, ((await r.json()) as any).error.code]).toEqual([410, 'gone']);
    expect((await fetch(url + '/api/events?since=abc')).status).toBe(400);
  });

  it('sends a ping comment', async () => {
    const { url } = await boot(undefined, 50);
    const { raw } = await readSse(url + '/api/events', () => false, 400);
    expect(raw).toContain(': ping');
  });
});
