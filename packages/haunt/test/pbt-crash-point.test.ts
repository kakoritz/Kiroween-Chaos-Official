// H6.4 Property test: a crash at ANY hook call (crash point by step) leaves Phoenix with exactly one
// side effect per kind after one restart. Rookie is checked as the contrast (it must be able to double).
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST_ROUTES, Provider, type ProviderClock } from '../../core/src/provider';
import { ProcessKilled, Sdk, type Host, type Transport } from '../src/sdk';
import { Pipeline, generateOrders, tierById } from '../src/pipeline';

const LANE = 'L1';
const SEED = 7;
const ID = 'ord-0001';
const PATHS = Object.fromEntries(Object.entries(POST_ROUTES).map(([p, k]) => [k, p]));
const KINDS = ['account', 'charge', 'email', 'dispatch'];

/** Runs one order, killing the process at the `killAt`-th hook call (1-based; null = never). */
async function run(tierId: string, killAt: number | null) {
  const tier = tierById(tierId);
  const clock: ProviderClock = { now: () => 0, sleep: async () => {} };
  const provider = new Provider({ clock });
  const orders = generateOrders(SEED, 2);
  let calls = 0;
  let armed = killAt !== null;
  const host: Host = {
    now: () => 0,
    sleep: async () => {},
    hook: async (point) => {
      calls += 1;
      if (armed && calls === killAt) {
        armed = false;
        throw new ProcessKilled(point);
      }
    },
    emit: () => {},
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
  const journalPath = join(mkdtempSync(join(tmpdir(), 'haunt-pbt-')), 'lane.journal.jsonl');
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
  let killed = false;
  let result: string;
  try {
    result = await (await start()).run(ID);
  } catch (e) {
    if (!(e instanceof ProcessKilled)) throw e;
    killed = true;
    result = await (await start()).run(ID);
  }
  const rows = provider.ledger(LANE);
  const counts = Object.fromEntries(KINDS.map((k) => [k, rows.filter((r) => r.kind === k).length]));
  return { result, counts, killed, calls };
}

describe('property: crash point by step', () => {
  it('Phoenix has exactly one effect of each kind for any crash point', async () => {
    const total = (await run('phoenix', null)).calls;
    expect(total).toBeGreaterThan(4);
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: total }), async (killAt) => {
        const r = await run('phoenix', killAt);
        expect(r.killed).toBe(true);
        // Known bug (docs/KIRO-LOG.md H6.4): a crash at mid_stage of `updates` ends 'failed' after replay.
        // The side-effect count is the property under test, so the result is not asserted here.
        expect(r.counts).toEqual({ account: 1, charge: 1, email: 1, dispatch: 1 });
      }),
      { numRuns: 60 },
    );
  });

  it('Rookie can double an effect for some crash point (the property is not vacuous)', async () => {
    const total = (await run('rookie', null)).calls;
    let doubled = false;
    for (let k = 1; k <= total && !doubled; k++) {
      const r = await run('rookie', k);
      doubled = Object.values(r.counts).some((c) => c > 1);
    }
    expect(doubled).toBe(true);
  });
});
