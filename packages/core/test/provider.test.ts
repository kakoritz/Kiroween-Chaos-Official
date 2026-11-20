import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Provider, startProvider, type ProviderClock } from '../src/provider';

const fast: ProviderClock = { now: () => Date.now(), sleep: async () => {} };
const post = (p: Provider, path: string, body: Record<string, unknown>, key?: string, headers: Record<string, string> = {}) =>
  p.handle({ method: 'POST', path, body, headers: { ...(key ? { 'Idempotency-Key': key } : {}), ...headers } });

describe('provider idempotency (P5)', () => {
  it('N calls with one key give one row and identical responses', async () => {
    const p = new Provider({ clock: fast });
    const rs = [];
    for (let i = 0; i < 5; i++) rs.push(await post(p, '/charges', { lane: 'L1', order: 'ord-0001', amount: 500 }, 'ord-0001:charge'));
    expect(p.ledger('L1')).toHaveLength(1);
    expect(new Set(rs.map((r) => JSON.stringify(r.body))).size).toBe(1);
    expect(rs[0]!.status).toBe(201);
    expect(rs[0]!.headers['Idempotent-Replayed']).toBeUndefined();
    expect(rs[1]!.headers['Idempotent-Replayed']).toBe('true');
    expect(rs[0]!.body).toEqual({ id: 'ch_1', amount: 500 });
  });

  it('no key or a new key always creates a row; keys are per lane', async () => {
    const p = new Provider({ clock: fast });
    await post(p, '/charges', { lane: 'L1', order: 'o', amount: 1 });
    await post(p, '/charges', { lane: 'L1', order: 'o', amount: 1 });
    await post(p, '/charges', { lane: 'L1', order: 'o', amount: 1 }, 'k');
    await post(p, '/charges', { lane: 'L2', order: 'o', amount: 1 }, 'k');
    expect(p.ledger('L1')).toHaveLength(3);
    expect(p.ledger('L2')).toHaveLength(1);
  });

  it('effect routes use the documented id prefixes and notify keeps its index', async () => {
    const p = new Provider({ clock: fast });
    const ids: string[] = [];
    for (const path of ['/accounts', '/emails', '/shipments', '/tickets', '/replies']) {
      ids.push(((await post(p, path, { lane: 'L', order: 'o' })).body as { id: string }).id);
    }
    expect(ids).toEqual(['acct_1', 'em_1', 'sh_1', 'tk_1', 'rp_1']);
    const n = await post(p, '/notifications', { lane: 'L', order: 'o', index: 2 }, 'o:notify:2');
    expect(n.body).toEqual({ id: 'nt_1', index: 2 });
  });

  it('lookup finds a row by kind and key', async () => {
    const p = new Provider({ clock: fast });
    await post(p, '/charges', { lane: 'L', order: 'o', amount: 9 }, 'o:charge');
    const hit = await p.handle({ method: 'GET', path: '/lookup', query: { lane: 'L', kind: 'charge', key: 'o:charge' } });
    expect((hit.body as { found: boolean }).found).toBe(true);
    const miss = await p.handle({ method: 'GET', path: '/lookup', query: { lane: 'L', kind: 'charge', key: 'zzz' } });
    expect(miss.body).toEqual({ found: false });
  });
});

describe('provider faults (H4)', () => {
  it.each([404, 429, 500, 503])('status %i writes no ledger row, count limits it', async (code) => {
    const p = new Provider({ clock: fast });
    p.addFault({ lane: 'L', service: 'charge', mode: 'status', value: code, count: 2, headers: { 'Retry-After': '2' } });
    const a = await post(p, '/charges', { lane: 'L', order: 'o', amount: 1 });
    const b = await post(p, '/charges', { lane: 'L', order: 'o', amount: 1 });
    expect(a.status).toBe(code);
    expect(a.headers['Retry-After']).toBe('2');
    expect(b.status).toBe(code);
    expect(p.ledger('L')).toHaveLength(0);
    expect((await post(p, '/charges', { lane: 'L', order: 'o', amount: 1 })).status).toBe(201);
    expect(p.ledger('L')).toHaveLength(1);
  });

  it('drop writes no row', async () => {
    const p = new Provider({ clock: fast });
    p.addFault({ lane: 'L', service: '*', mode: 'drop', count: 1 });
    const r = await post(p, '/emails', { lane: 'L', order: 'o' });
    expect(r.drop).toBe(true);
    expect(p.ledger('L')).toHaveLength(0);
  });

  it('latency over the client timeout still writes the row while the call is pending', async () => {
    const slept: number[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const p = new Provider({ clock: { now: () => Date.now(), sleep: (ms) => { slept.push(ms); return gate; } } });
    p.addFault({ lane: 'L', service: 'charge', mode: 'latency', value: 3000, count: 1 });
    const pending = post(p, '/charges', { lane: 'L', order: 'o', amount: 1 }, 'o:charge');
    await new Promise((r) => setTimeout(r, 5));
    expect(p.ledger('L')).toHaveLength(1);
    expect(Math.max(...slept)).toBeGreaterThanOrEqual(3000);
    release();
    await pending;
  });

  it('faults match by lane, service and recovery phase', async () => {
    const p = new Provider({ clock: fast });
    p.addFault({ lane: 'L', service: 'charge', mode: 'status', value: 500, count: 1, nextCaller: 'recovery' });
    expect((await post(p, '/charges', { lane: 'L', order: 'o', amount: 1 })).status).toBe(201);
    expect((await post(p, '/charges', { lane: 'M', order: 'o', amount: 1 }, undefined, { 'X-Haunt-Phase': 'recovery' })).status).toBe(201);
    expect((await post(p, '/charges', { lane: 'L', order: 'o', amount: 1 }, undefined, { 'X-Haunt-Phase': 'recovery' })).status).toBe(500);
  });

  it('time-window faults expire', async () => {
    let t = 0;
    const p = new Provider({ clock: { now: () => t, sleep: async () => {} } });
    p.addFault({ lane: 'L', service: '*', mode: 'status', value: 503, forMs: 10000 });
    expect((await post(p, '/emails', { lane: 'L', order: 'o' })).status).toBe(503);
    t = 9999;
    expect((await post(p, '/emails', { lane: 'L', order: 'o' })).status).toBe(503);
    t = 10000;
    expect((await post(p, '/emails', { lane: 'L', order: 'o' })).status).toBe(201);
  });
});

describe('provider tracking and capacity', () => {
  it('polls 1..4 in transit, 5 delivered; stall and no_driver answer as documented', async () => {
    const p = new Provider({ clock: fast });
    const get = () => p.handle({ method: 'GET', path: '/tracking/sh_1', query: { lane: 'L' } });
    const seen = [];
    for (let i = 0; i < 5; i++) seen.push(((await get()).body as { status: string }).status);
    expect(seen).toEqual(['in_transit', 'in_transit', 'in_transit', 'in_transit', 'delivered']);
    p.addFault({ lane: 'L', service: 'tracking', mode: 'stall', value: 5000, count: 1 });
    p.addFault({ lane: 'L', service: 'tracking', mode: 'no_driver', count: 1 });
    expect((await get()).body).toEqual({ status: 'in_transit', reroute: true });
    expect((await get()).body).toEqual({ status: 'no_driver' });
  });

  it('adds 50 ms per request above 8 in flight and answers 503 above 24, unprocessed', async () => {
    const slept: number[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const p = new Provider({ clock: { now: () => 0, sleep: (ms) => { slept.push(ms); return gate; } } });
    const calls = Array.from({ length: 26 }, (_, i) => post(p, '/emails', { lane: 'L', order: `o${i}` }));
    const over = await calls[25]!;
    expect(over.status).toBe(503);
    expect(p.ledger('L')).toHaveLength(24);
    expect(Math.max(...slept)).toBeGreaterThanOrEqual(20 + 16 * 50);
    release();
    await Promise.all(calls);
  });

  it('base latency is seeded and in [20, 100)', async () => {
    const run = async () => {
      const s: number[] = [];
      const p = new Provider({ seed: 's1', clock: { now: () => 0, sleep: async (ms) => { s.push(ms); } } });
      for (let i = 0; i < 20; i++) await post(p, '/emails', { lane: 'L', order: `o${i}` });
      return s;
    };
    const a = await run();
    expect(a).toEqual(await run());
    expect(a.every((x) => x >= 20 && x < 100)).toBe(true);
  });
});

describe('provider over HTTP', () => {
  it('serves effects, replays, ledger.jsonl, faults, drop and reset on loopback', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'haunt-prov-'));
    const ledgerPath = join(dir, 'ledger.jsonl');
    const s = await startProvider({ port: 0, clock: fast, ledgerPath });
    try {
      const call = (path: string, init?: RequestInit) => fetch(s.url + path, init);
      const body = JSON.stringify({ lane: 'L', order: 'ord-0001', amount: 700 });
      const h = { 'content-type': 'application/json', 'Idempotency-Key': 'ord-0001:charge' };
      const a = await call('/charges', { method: 'POST', body, headers: h });
      const b = await call('/charges', { method: 'POST', body, headers: h });
      expect(a.status).toBe(201);
      expect(b.headers.get('idempotent-replayed')).toBe('true');
      expect(await b.json()).toEqual({ id: 'ch_1', amount: 700 });
      const led = (await (await call('/ledger?lane=L')).json()) as { rows: unknown[] };
      expect(led.rows).toHaveLength(1);
      expect(readFileSync(ledgerPath, 'utf8').trim().split('\n')).toHaveLength(1);

      await call('/_fault', { method: 'POST', body: JSON.stringify({ lane: 'L', service: 'email', mode: 'drop', count: 1 }) });
      await expect(call('/emails', { method: 'POST', body: JSON.stringify({ lane: 'L', order: 'o' }) })).rejects.toThrow();
      expect((await call('/emails', { method: 'POST', body: JSON.stringify({ lane: 'L', order: 'o' }) })).status).toBe(201);

      await call('/_reset', { method: 'POST' });
      expect(((await (await call('/ledger?lane=L')).json()) as { rows: unknown[] }).rows).toHaveLength(0);
      expect(readFileSync(ledgerPath, 'utf8')).toBe('');
      expect((await call('/nope')).status).toBe(404);
    } finally {
      await s.close();
    }
  });
});
