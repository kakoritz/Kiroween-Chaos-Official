import { describe, expect, it } from 'vitest';
import { createMockServer } from '../src/mock/server';
// @ts-expect-error plain JS module without types
import { createHaunt } from '../inpage-stub.js';

async function withServer(fn: (base: string) => Promise<void>): Promise<void> {
  const m = createMockServer({ port: 0 });
  const port = await m.listen();
  try { await fn(`http://127.0.0.1:${port}`); } finally { await m.close(); }
}

const post = (base: string, path: string, body: unknown = {}) => fetch(`${base}${path}`, { method: 'POST', body: JSON.stringify(body) });

describe('window.__haunt stub', () => {
  it('mirrors the REST calls and rejects with {code, message}', async () => {
    await withServer(async (base) => {
      const h = createHaunt({ base });
      expect((await h.getHealth()).ok).toBe(true);
      expect((await h.getState()).wave).toBeNull();
      expect(Array.isArray(await h.getApps())).toBe(true);
      await expect(h.setSpeed(3)).rejects.toMatchObject({ code: 'bad_request' });
      await expect(h.getLaneOrders(9)).rejects.toMatchObject({ code: 'bad_lane' });
      await expect(h.getLaneOrder(9, 'o1')).rejects.toMatchObject({ code: 'bad_lane' });
      await expect(h.getLaneLaps(9)).rejects.toMatchObject({ code: 'bad_lane' });
      await expect(h.getWaveLaps(99)).rejects.toMatchObject({ code: 'not_ready' });
      await expect(h.getWaveStars(99)).rejects.toMatchObject({ code: 'not_ready' });
      await expect(h.decide(9, 'o1', 'x')).rejects.toMatchObject({ code: 'bad_lane' });
      await expect(h.decide(1, 'o1', 'x')).rejects.toMatchObject({ code: 'no_decision' });
    });
  });

  it('subscribe delivers hello and stops after unsubscribe', async () => {
    await withServer(async (base) => {
      const h = createHaunt({ base });
      const got: any[] = [];
      const off = h.subscribe((e: any) => got.push(e), { since: 0 });
      const end = Date.now() + 5000;
      while (!got.length && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
      off();
      expect(got[0].type).toBe('hello');
    });
  });
});

describe('/_mock/fault version and unreachable', () => {
  it('version bumps contractVersion until reset', async () => {
    await withServer(async (base) => {
      const before = (await (await fetch(`${base}/api/health`)).json() as any).contractVersion;
      await post(base, '/_mock/fault', { kind: 'version' });
      expect((await (await fetch(`${base}/api/health`)).json() as any).contractVersion).toBe(before + 1);
      await post(base, '/_mock/reset');
      expect((await (await fetch(`${base}/api/health`)).json() as any).contractVersion).toBe(before);
    });
  });

  it('unreachable drops api requests but keeps /_mock reachable', async () => {
    await withServer(async (base) => {
      await post(base, '/_mock/fault', { kind: 'unreachable' });
      await expect(fetch(`${base}/api/health`)).rejects.toBeTruthy();
      expect((await post(base, '/_mock/reset')).status).toBe(200);
      expect((await fetch(`${base}/api/health`)).status).toBe(200);
    });
  });
});
