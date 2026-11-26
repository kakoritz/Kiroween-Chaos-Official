import { describe, expect, it } from 'vitest';
import { createMockServer } from '../src/mock/server';

async function withServer(fn: (base: string) => Promise<void>): Promise<void> {
  const m = createMockServer({ port: 0 });
  const port = await m.listen();
  try { await fn(`http://127.0.0.1:${port}`); } finally { await m.close(); }
}

const post = (base: string, path: string, body: unknown = {}) => fetch(`${base}${path}`, { method: 'POST', body: JSON.stringify(body) });
const get = async (base: string, path: string) => (await fetch(`${base}${path}`)).json() as Promise<any>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(fn: () => Promise<T | undefined | false>, ms = 15000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(50); }
  throw new Error('timed out');
}

/** Read SSE messages until `stop` says so or the stream closes. */
async function readSse(url: string, stop: (all: any[]) => boolean, ms = 15000): Promise<{ events: any[]; status: number }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const res = await fetch(url, { signal: ctrl.signal });
  if (res.status !== 200) { clearTimeout(timer); return { events: [], status: res.status }; }
  const events: any[] = [];
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
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
  } catch { /* aborted */ }
  clearTimeout(timer);
  ctrl.abort();
  return { events, status: 200 };
}

describe('mock server waves (H0.3)', () => {
  it('starts a scaled wave, updates state, and refuses a second start', async () => {
    await withServer(async (base) => {
      const r = await post(base, '/api/wave/start', { orders: 2, lanes: 2, speed: 4 });
      expect(r.status).toBe(200);
      expect(((await r.json()) as any).wave).toBe(1);
      expect((await post(base, '/api/wave/start', {})).status).toBe(409);
      const st = await get(base, '/api/state');
      expect(st.wave.running).toBe(true);
      await waitFor(async () => (await get(base, '/api/state')).lanes.length === 2);
      expect((await post(base, '/api/wave/stop')).status).toBe(200);
      const after = await get(base, '/api/state');
      expect(after.wave.running).toBe(false);
      expect((await get(base, '/api/waves'))[0].endedAt).toBeTypeOf('number');
    });
  });

  it('validates wave, speed and mode parameters', async () => {
    await withServer(async (base) => {
      expect((await post(base, '/api/wave/start', { orders: 0 })).status).toBe(400);
      expect((await post(base, '/api/wave/start', { lanes: 9 })).status).toBe(400);
      expect((await post(base, '/api/wave/start', { tiers: 'x' })).status).toBe(400);
      expect((await post(base, '/api/speed', { speed: 3 })).status).toBe(400);
      expect(((await (await post(base, '/api/speed', { speed: 2 })).json()) as any).speed).toBe(2);
      expect((await post(base, '/api/chaos/mode', { mode: 'bad' })).status).toBe(400);
      expect((await post(base, '/api/chaos/mode', { mode: 'random', frequency: 0.5 })).status).toBe(200);
      expect((await get(base, '/api/state')).chaos.mode).toBe('random');
      expect((await post(base, '/api/app', { app: 'nope' })).status).toBe(400);
    });
  });

  it('plays a finished wave and serves ledger, report, postmortem, compare and hardening', async () => {
    await withServer(async (base) => {
      await post(base, '/api/wave/start', { orders: 1, lanes: 1, speed: 4 });
      expect((await fetch(`${base}/api/waves/1/postmortem`)).status).toBe(404);
      await waitFor(async () => (await get(base, '/api/state')).wave.running === false);
      const pm = await fetch(`${base}/api/waves/1/postmortem`);
      expect(pm.status).toBe(200);
      expect(pm.headers.get('content-type')).toContain('text/markdown');
      expect((await get(base, '/api/waves/1/report')).mode).toBe('mock');
      expect((await get(base, '/api/waves/1/hardening')).files.length).toBeGreaterThan(0);
      expect((await get(base, '/api/ledger')).lanes.length).toBe(1);
      expect((await fetch(`${base}/api/waves/9/report`)).status).toBe(404);
      await post(base, '/api/wave/start', { orders: 1, lanes: 1, speed: 4 });
      await waitFor(async () => (await get(base, '/api/state')).wave.running === false);
      const cmp = await get(base, '/api/waves/1/compare/2');
      expect(cmp.cells.length).toBe(1);
      expect((await get(base, '/api/apps')).length).toBe(3);
    });
  });
});

describe('mock server chaos (H0.3)', () => {
  it('answers the contract error codes', async () => {
    await withServer(async (base) => {
      const code = async (body: unknown) => ((await (await post(base, '/api/chaos', body)).json()) as any).error?.code;
      expect(await code({ lane: 1 })).toBe('no_wave');
      await post(base, '/api/wave/start', { orders: 3, lanes: 5, speed: 4 });
      expect(await code({ lane: 1, creature: 'nope' })).toBe('bad_creature');
      expect(await code({ lane: 1, fault: 'nope' })).toBe('bad_fault');
      expect(await code({ lane: 9, fault: 'crash' })).toBe('bad_lane');
      expect(await code({ fault: 'crash' })).toBe('bad_lane');
      expect((await post(base, '/api/app', { app: 'inbox' })).status).toBe(409);
    });
  });

  it('injects a crash on a working lane and emits chaos followed by its consequence', async () => {
    await withServer(async (base) => {
      await post(base, '/api/wave/start', { orders: 3, lanes: 5, speed: 4 });
      await waitFor(async () => (await get(base, '/api/state')).lanes.find((l: any) => l.lane === 5 && l.stage === 'payment'));
      const r = await post(base, '/api/chaos', { lane: 5, fault: 'crash' });
      expect(r.status).toBe(200);
      const body = (await r.json()) as any;
      expect(body).toMatchObject({ creature: 'reaper', fault: 'crash', depth: 1, deferred: false });
      const log = await waitFor(async () => {
        const l = await get(base, '/api/lane/5/log');
        return l.lines.some((x: any) => x.type === 'process_up') && l;
      });
      const types = log.lines.map((x: any) => x.type);
      expect(types.indexOf('chaos')).toBeGreaterThanOrEqual(0);
      expect(types.indexOf('process_dead')).toBeGreaterThan(types.indexOf('chaos'));
      const detail = await get(base, '/api/lane/5/stage/payment');
      expect(detail.chaos.length).toBeGreaterThan(0);
      expect((await get(base, '/api/lane/5/orders')).length).toBeGreaterThan(0);
    });
  });

  it('runs a boss warning, start and end', async () => {
    await withServer(async (base) => {
      await post(base, '/api/wave/start', { orders: 6, lanes: 2, speed: 4 });
      await waitFor(async () => (await get(base, '/api/state')).lanes.some((l: any) => l.stage));
      const r = await post(base, '/api/chaos', { fault: 'boss_power_outage' });
      expect(r.status).toBe(200);
      expect(((await r.json()) as any).creature).toBe('lich');
      await waitFor(async () => (await get(base, '/api/state')).boss.startsInMs === 8000);
    });
  });
});

describe('mock server SSE (H0.3)', () => {
  it('starts with hello, replays since an exclusive seq, and keeps seq strictly increasing', async () => {
    await withServer(async (base) => {
      await post(base, '/api/demo/start', { script: 'calm', speed: 4 });
      await sleep(400);
      const a = await readSse(`${base}/api/events?since=0`, (e) => e.length >= 6);
      expect(a.events[0].type).toBe('hello');
      expect(a.events[0].contractVersion).toBe(1);
      const seqs = a.events.slice(1).map((e) => e.seq);
      expect(seqs[0]).toBe(1);
      for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
      const cut = seqs[2];
      const b = await readSse(`${base}/api/events?since=${cut}`, (e) => e.length >= 3);
      expect(b.events[1].seq).toBe(cut + 1);
    });
  });

  it('rejects a bad since and honours the gone fault', async () => {
    await withServer(async (base) => {
      expect((await fetch(`${base}/api/events?since=abc`)).status).toBe(400);
      expect((await post(base, '/_mock/fault', { kind: 'nope' })).status).toBe(400);
      await post(base, '/_mock/fault', { kind: 'gone' });
      const res = await fetch(`${base}/api/events?since=1`);
      expect(res.status).toBe(410);
      expect(((await res.json()) as any).error.code).toBe('gone');
    });
  });

  it('drop_sse closes open streams and reset emits a reset event', async () => {
    await withServer(async (base) => {
      const open = readSse(`${base}/api/events?since=0`, () => false, 3000);
      await sleep(300);
      await post(base, '/_mock/fault', { kind: 'drop_sse' });
      const t0 = Date.now();
      await open;
      expect(Date.now() - t0).toBeLessThan(2500);
      await post(base, '/_mock/reset');
      const r = await readSse(`${base}/api/events?since=0`, (e) => e.some((x) => x.type === 'reset'));
      expect(r.events.some((x) => x.type === 'reset')).toBe(true);
    });
  });
});

describe('GET /api/campaign (CP-C1)', () => {
  it('serves the nights, gear and start state', async () => {
    await withServer(async (base) => {
      const c = await get(base, '/api/campaign');
      expect(c.nights).toHaveLength(7);
      expect(c.gear).toHaveLength(5);
      expect(c.start).toEqual({ gear: [], credits: 300 });
      expect(c.nights[0].title).toBe('The Double Charge');
    });
  });
});