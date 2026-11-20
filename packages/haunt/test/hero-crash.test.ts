// H1.7 Hero crash test: the storyboard crash (kill at payment, after the charge, before the journal write).
// Rookie ends with 2 charges, Phoenix with 1. Answer key: .kiro/specs/engine/acceptance.md table A, row A2.
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST_ROUTES, Provider, type ProviderClock } from '../../core/src/provider';
import { ProcessKilled, Sdk, type Host, type Transport } from '../src/sdk';
import { Pipeline, TIERS, generateOrders, tierById } from '../src/pipeline';

const LANE = 'L1';
const SEED = 7;
const ID = 'ord-0001';
const PATHS = Object.fromEntries(Object.entries(POST_ROUTES).map(([p, k]) => [k, p]));

async function heroCrash(tierId: string) {
  const tier = tierById(tierId);
  const now = 0;
  const clock: ProviderClock = { now: () => now, sleep: async () => {} };
  const provider = new Provider({ clock });
  const orders = generateOrders(SEED, 2);
  const msgs: Record<string, unknown>[] = [];
  let armed = true;
  const host: Host = {
    now: () => now,
    sleep: async () => {},
    hook: async (point, ctx) => {
      if (armed && point === 'after_effect_before_journal' && ctx.stage === 'payment') {
        armed = false;
        throw new ProcessKilled(point);
      }
    },
    emit: (m) => { msgs.push(m); },
  };
  const transport: Transport = {
    post: async (kind, body, o) => {
      const r = await provider.handle({
        method: 'POST', path: PATHS[kind]!, body,
        headers: { ...(o.key ? { 'Idempotency-Key': o.key } : {}), 'X-Haunt-Phase': o.recovery ? 'recovery' : 'normal' },
      });
      return { status: r.status, body: r.body, headers: r.headers };
    },
    lookup: async (kind, key) => {
      const r = await provider.handle({ method: 'GET', path: '/lookup', query: { lane: LANE, kind, key } });
      return r.body as { found: boolean; row?: Record<string, unknown> };
    },
  };
  const journalPath = join(mkdtempSync(join(tmpdir(), 'haunt-hero-')), 'lane.journal.jsonl');
  const start = async (): Promise<Pipeline> => {
    const sdk = new Sdk({ tier: tier.id, lane: LANE, use: tier.use, host, transport, journalPath });
    await sdk.start();
    return new Pipeline({
      sdk, tier, seed: SEED, lane: LANE,
      readOrder: async (id) => orders.find((o) => o.id === id)!,
      pollTracking: async (shipment) => {
        const r = await provider.handle({ method: 'GET', path: `/tracking/${shipment}`, query: { lane: LANE } });
        return (r.body as { status?: string }).status === 'delivered';
      },
      hook: (point, ctx) => host.hook(point, ctx),
      emit: (m) => host.emit(m),
    });
  };
  await expect((await start()).run(ID)).rejects.toBeInstanceOf(ProcessKilled);
  const result = await (await start()).run(ID);
  const rows = provider.ledger(LANE);
  const count = (kind: string) => rows.filter((r) => r.kind === kind).length;
  return { result, count, msgs };
}

describe('hero crash (A2 at payment)', () => {
  it('Rookie charges twice and Phoenix charges once', async () => {
    const rookie = await heroCrash('rookie');
    const phoenix = await heroCrash('phoenix');
    expect(rookie.count('charge')).toBe(2);
    expect(phoenix.count('charge')).toBe(1);
    expect(rookie.result).toBe('done');
    expect(phoenix.result).toBe('done');
  });

  it('charge and account counts for all five tiers match the answer key', async () => {
    const got: Record<string, [number, number]> = {};
    for (const t of TIERS) {
      const r = await heroCrash(t.id);
      got[t.id] = [r.count('account'), r.count('charge')];
    }
    expect(got).toEqual({
      rookie: [2, 2], retrier: [2, 2], journaler: [1, 2], reconciler: [1, 1], phoenix: [1, 1],
    });
  });

  it('Phoenix replays without repeating any other effect', async () => {
    const r = await heroCrash('phoenix');
    expect(['account', 'charge', 'email', 'dispatch'].map((k) => r.count(k))).toEqual([1, 1, 1, 1]);
    expect(r.count('notify')).toBe(2);
    expect(r.msgs.filter((m) => m.type === 'order_failed')).toEqual([]);
  });
});
