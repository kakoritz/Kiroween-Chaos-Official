// Contract suite (H0.8). Local only; never wired into CI.
// Default: starts the mock in-process. Set CONTRACT_URL=http://host:port to run against a live server (H1.6).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMockServer } from '../../src/mock/server';
import { schemaErrors } from '../../../haunt/src/contract/validate';

const EXTERNAL = process.env.CONTRACT_URL?.replace(/\/+$/, '');
let base = EXTERNAL ?? '';
let closeMock: (() => Promise<void>) | undefined;

beforeAll(async () => {
  if (EXTERNAL) return;
  const m = createMockServer({ port: 0 });
  base = `http://127.0.0.1:${await m.listen()}`;
  closeMock = m.close;
});
afterAll(async () => { await closeMock?.(); });

const get = (p: string) => fetch(`${base}${p}`);
const post = (p: string, body: unknown = {}) => fetch(`${base}${p}`, { method: 'POST', body: JSON.stringify(body) });
const errCode = async (r: Response) => ((await r.json()) as any).error?.code;
const mockOnly = EXTERNAL ? it.skip : it;

async function readSse(url: string, stop: (all: any[]) => boolean, ms = 15000): Promise<{ events: any[]; status: number }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const events: any[] = [];
  let status = 0;
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    status = res.status;
    if (status !== 200) return { events, status };
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value);
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (chunk.startsWith('data: ')) events.push(JSON.parse(chunk.slice(6)));
      }
      if (stop(events)) break;
    }
  } catch { /* aborted */ } finally { clearTimeout(timer); ctrl.abort(); }
  return { events, status };
}

describe('contract: read endpoints', () => {
  it('health reports ok and a contract version', async () => {
    const b = (await (await get('/api/health')).json()) as any;
    expect(b.ok).toBe(true);
    expect(typeof b.contractVersion).toBe('number');
    expect(['mock', 'live']).toContain(b.mode);
  });

  it('creatures have the documented fields', async () => {
    const list = (await (await get('/api/creatures')).json()) as any[];
    expect(list.length).toBeGreaterThan(0);
    for (const c of list) {
      for (const k of ['id', 'label', 'family', 'sprite', 'causes', 'boss', 'apps', 'description']) expect(c).toHaveProperty(k);
      expect(Array.isArray(c.causes)).toBe(true);
      expect(typeof c.boss).toBe('boolean');
    }
  });

  it('apps list orders and inbox with stages', async () => {
    const apps = (await (await get('/api/apps')).json()) as any[];
    expect(apps.map((a) => a.id)).toEqual(expect.arrayContaining(['orders', 'inbox']));
    for (const a of apps) expect(a.stages.length).toBeGreaterThan(0);
  });

  it('state has the documented top-level shape', async () => {
    const s = (await (await get('/api/state')).json()) as any;
    for (const k of ['contractVersion', 'app', 'wave', 'chaos', 'stages', 'lanes', 'boss', 'demo']) expect(s).toHaveProperty(k);
    expect(Array.isArray(s.lanes)).toBe(true);
    expect(s.demo).toHaveProperty('scripts');
  });

  it('ledger and waves are well formed', async () => {
    const l = (await (await get('/api/ledger')).json()) as any;
    expect(Array.isArray(l.lanes)).toBe(true);
    expect(Array.isArray(await (await get('/api/waves')).json())).toBe(true);
  });
});

describe('contract: error codes', () => {
  it('unknown wave artifacts answer 404 not_ready', async () => {
    const r = await get('/api/waves/9999/postmortem');
    expect(r.status).toBe(404);
    expect(await errCode(r)).toBe('not_ready');
  });

  it('bad lane answers 400 bad_lane', async () => {
    const r = await get('/api/lane/9/log');
    expect(r.status).toBe(400);
    expect(await errCode(r)).toBe('bad_lane');
  });

  it('invalid wave parameters answer 400 bad_request', async () => {
    for (const body of [{ orders: 0 }, { lanes: 6 }, { speed: 3 }, { tiers: 'x' }, { app: 'nope' }]) {
      const r = await post('/api/wave/start', body);
      expect(r.status).toBe(400);
      expect(await errCode(r)).toBe('bad_request');
    }
  });

  it('invalid speed and chaos mode answer 400 bad_request', async () => {
    expect((await post('/api/speed', { speed: 3 })).status).toBe(400);
    const r = await post('/api/chaos/mode', { mode: 'sometimes' });
    expect(r.status).toBe(400);
    expect(await errCode(r)).toBe('bad_request');
  });

  it('SSE rejects a malformed since', async () => {
    const r = await get('/api/events?since=abc');
    expect(r.status).toBe(400);
    expect(await errCode(r)).toBe('bad_request');
  });
});

describe('contract: wave lifecycle and events', () => {
  it('starts a wave, rejects a second start, streams valid events, stops', async () => {
    await post('/api/wave/stop');
    const r = await post('/api/wave/start', { orders: 2, lanes: 2, speed: 4 });
    expect(r.status).toBe(200);
    expect(typeof ((await r.json()) as any).wave).toBe('number');
    const dup = await post('/api/wave/start', {});
    expect(dup.status).toBe(409);
    expect(await errCode(dup)).toBe('wave_running');

    const { events, status } = await readSse(`${base}/api/events?since=0`, (all) => all.some((e) => e.type === 'wave_end'));
    expect(status).toBe(200);
    expect(events[0].type).toBe('hello');
    for (const e of events) expect(schemaErrors(e)).toEqual([]);
    const seqs = events.filter((e) => typeof e.seq === 'number' && e.type !== 'hello').map((e) => e.seq);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    expect(events.some((e) => e.type === 'wave_end')).toBe(true);
    await post('/api/wave/stop');
  });

  it('since is exclusive', async () => {
    const all = await readSse(`${base}/api/events?since=0`, (e) => e.length >= 4, 5000);
    const withSeq = all.events.filter((e) => typeof e.seq === 'number' && e.type !== 'hello');
    if (withSeq.length < 2) return;
    const cut = withSeq[0].seq;
    const rest = await readSse(`${base}/api/events?since=${cut}`, (e) => e.length >= 2, 5000);
    for (const e of rest.events.filter((x) => x.type !== 'hello' && typeof x.seq === 'number')) expect(e.seq).toBeGreaterThan(cut);
  });
});

describe('contract: demo replay and chaos', () => {
  mockOnly('a demo fixture replays as a valid stream', async () => {
    await post('/api/wave/stop');
    await post('/_mock/reset');
    expect((await post('/api/demo/start', { script: 'calm', speed: 4 })).status).toBe(200);
    const { events } = await readSse(`${base}/api/events?since=0`, (all) => all.some((e) => e.type === 'wave_end'), 20000);
    const body = events.filter((e) => e.type !== 'hello');
    for (const e of body) expect(schemaErrors(e)).toEqual([]);
    expect(body.some((e) => e.type === 'wave_end')).toBe(true);
    await post('/api/demo/stop');
  });

  it('chaos with no wave answers no_wave 409, and a bad creature 400', async () => {
    await post('/api/wave/stop');
    await post('/_mock/reset');
    const r = await post('/api/chaos', { lane: 1, creature: 'does-not-exist' });
    expect([400, 409]).toContain(r.status);
    expect(['bad_creature', 'no_wave']).toContain(await errCode(r));
  });
});

describe('contract: mock fault hooks', () => {
  mockOnly('gone fault makes the next SSE connect answer 410', async () => {
    expect((await post('/_mock/fault', { kind: 'gone' })).status).toBe(200);
    const r = await get('/api/events?since=0');
    expect(r.status).toBe(410);
    expect(await errCode(r)).toBe('gone');
  });

  mockOnly('version fault bumps contractVersion, reset clears it', async () => {
    const v0 = ((await (await get('/api/health')).json()) as any).contractVersion;
    await post('/_mock/fault', { kind: 'version' });
    expect(((await (await get('/api/health')).json()) as any).contractVersion).toBe(v0 + 1);
    await post('/_mock/reset');
    expect(((await (await get('/api/health')).json()) as any).contractVersion).toBe(v0);
  });
});



async function waitIdle(ms = 40000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms && ((await (await get('/api/state')).json()) as any).wave?.running) await new Promise((r) => setTimeout(r, 200));
}

describe('contract v1.1: laps, order records, stars, decisions (mock)', () => {
  mockOnly('typo-redo replays, then laps, order record, wave laps and stars answer', async () => {
    await post('/api/wave/stop');
    await post('/_mock/reset');
    expect((await post('/api/demo/start', { script: 'typo-redo', speed: 4 })).status).toBe(200);
    await waitIdle();
    const wave = ((await (await get('/api/state')).json()) as any).wave.n;
    const laps = (await (await get('/api/lane/1/laps')).json()) as any[];
    expect(laps.length).toBeGreaterThanOrEqual(2);
    for (const l of laps) {
      expect(typeof l.order).toBe('string');
      expect(typeof l.lap.ms).toBe('number');
      expect(l.review.stars).toBeGreaterThanOrEqual(1);
    }
    const rec = (await (await get(`/api/lane/1/order/${laps[0].order}`)).json()) as any;
    expect(rec.order).toBe(laps[0].order);
    expect(rec.outcome).toBe('done');
    expect(rec.lap.ms).toBe(laps[0].lap.ms);
    expect(rec.stages.length).toBeGreaterThan(0);
    expect(rec.stages[0]).toHaveProperty('recoverable');
    const wl = (await (await get(`/api/waves/${wave}/laps`)).json()) as any;
    expect(wl.lanes[0].lane).toBe(1);
    expect(wl.lanes[0].laps.length).toBe(laps.length);
    const ws = (await (await get(`/api/waves/${wave}/stars`)).json()) as any;
    const last = ws.lanes[0].series.at(-1);
    expect(last.cumMax).toBe(5 * ws.lanes[0].series.length);
    expect(typeof last.cumStars).toBe('number');
  });

  mockOnly('unknown order, bad lane and unknown wave answer errors', async () => {
    expect((await get('/api/lane/1/order/nope')).status).toBe(404);
    expect(await errCode(await get('/api/lane/9/order/x'))).toBe('bad_lane');
    expect(await errCode(await get('/api/lane/9/laps'))).toBe('bad_lane');
    const r = await get('/api/waves/999/laps');
    expect(r.status).toBe(404);
    expect(await errCode(r)).toBe('not_ready');
    expect(await errCode(await get('/api/waves/999/stars'))).toBe('not_ready');
  });

  mockOnly('POST /api/decision: 409 no_decision when nothing pending, 400 on bad input', async () => {
    await post('/api/wave/stop');
    await post('/_mock/reset');
    const r = await post('/api/decision', { lane: 1, order: 'ord-0001', choice: 'refund' });
    expect(r.status).toBe(409);
    expect(await errCode(r)).toBe('no_decision');
    expect(await errCode(await post('/api/decision', { lane: 9, order: 'x', choice: 'refund' }))).toBe('bad_lane');
    expect(await errCode(await post('/api/decision', { lane: 1 }))).toBe('bad_request');
  });

  mockOnly('POST /api/decision answers 200 while a decision is pending', async () => {
    await post('/api/wave/stop');
    await post('/_mock/reset');
    expect((await post('/api/demo/start', { script: 'typo-redo', speed: 4 })).status).toBe(200);
    let ok: Response | undefined;
    const t0 = Date.now();
    while (Date.now() - t0 < 30000 && (!ok || ok.status !== 200)) {
      ok = await post('/api/decision', { lane: 1, order: 'ord-0002', choice: 'refund' });
      if (ok.status !== 200) await new Promise((r) => setTimeout(r, 50));
    }
    expect(ok!.status).toBe(200);
    await post('/api/demo/stop');
  });
});
