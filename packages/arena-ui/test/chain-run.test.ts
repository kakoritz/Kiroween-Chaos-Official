// The hand-off of a chain to the arena. Spec: .kiro/specs/chain-wizard-v2 (R2.1, R2.3).
import { describe, expect, it } from 'vitest';
import { CHAIN_HANDOFF_KEY, sendToArena } from '../src/chain/run';

const res = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const store = () => { const m = new Map<string, string>(); return { m, setItem: (k: string, v: string) => { m.set(k, v); } }; };

describe('sendToArena', () => {
  // covers: chain-wizard-v2/R2.1
  it('with a live server: registers the chain, switches to it, opens the arena', async () => {
    const calls: string[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url === './api/health') return res(200, { ok: true, mode: 'live' });
      if (url === './api/apps/register') return res(200, { id: 'my-chain' });
      return res(200, {});
    }) as unknown as typeof fetch;
    const r = await sendToArena('name: my-chain\n', { fetchFn, store: store() });
    expect(r).toEqual({ ok: true, where: 'live', url: './index.html?splash=0', id: 'my-chain' });
    expect(calls).toEqual(['GET ./api/health', 'POST ./api/apps/register', 'POST ./api/app']);
  });

  it('says why when the arena refuses the chain or will not switch', async () => {
    const refuse = (async (url: string) => (url === './api/health' ? res(200, { mode: 'live' }) : res(400, { error: { message: 'stage "Bad-Id": use 2 to 32 lowercase letters' } }))) as unknown as typeof fetch;
    const a = await sendToArena('x', { fetchFn: refuse });
    expect(!a.ok && a.error).toMatch(/refused the chain: stage "Bad-Id"/);
    const busy = (async (url: string) => (url === './api/health' ? res(200, { mode: 'live' }) : url === './api/apps/register' ? res(200, { id: 'c' }) : res(409, {}))) as unknown as typeof fetch;
    const b = await sendToArena('x', { fetchFn: busy });
    expect(!b.ok && b.error).toMatch(/would not switch.*Stop the running wave/);
  });

  // covers: chain-wizard-v2/R2.3
  it('with no server (the hosted page): keeps the chain for the next page and opens the hosted arena', async () => {
    const s = store();
    const down = (async () => { throw new Error('no server'); }) as unknown as typeof fetch;
    const r = await sendToArena('name: my-chain\nstages: []\n', { fetchFn: down, store: s });
    expect(r).toEqual({ ok: true, where: 'hosted', url: './hosted.html?splash=0' });
    expect(s.m.get(CHAIN_HANDOFF_KEY)).toBe('name: my-chain\nstages: []\n');
    const notLive = (async () => res(404, {})) as unknown as typeof fetch;
    expect((await sendToArena('y', { fetchFn: notLive, store: store() })).ok).toBe(true);
  });
});
