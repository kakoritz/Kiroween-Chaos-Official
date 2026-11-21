import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST_ROUTES, Provider, type FaultSpec, type ProviderClock } from '../../core/src/provider';
import { ProcessKilled, Sdk, type HookPoint, type Host, type Transport } from '../src/sdk';
import {
  InputError, LaneHalted, Pipeline, STAGES, TIERS, baselineMs, generateOrders, stageDuration, tierById,
  type OrderData, type TierDef,
} from '../src/pipeline';

const LANE = 'L1';
const SEED = 'seed-1';
const PATHS = Object.fromEntries(Object.entries(POST_ROUTES).map(([p, k]) => [k, p]));

class World {
  now = 0;
  readonly provider: Provider;
  readonly msgs: Record<string, unknown>[] = [];
  killAt: { point: HookPoint; stage?: string } | null = null;
  readInput: (id: string) => Promise<OrderData>;
  readonly orders = generateOrders(SEED, 3);
  readonly dir = mkdtempSync(join(tmpdir(), 'haunt-pipe-'));
  readonly journalPath = join(this.dir, 'lane-1.journal.jsonl');

  constructor() {
    const clock: ProviderClock = { now: () => this.now, sleep: async () => {} };
    this.provider = new Provider({ clock });
    this.readInput = async (id) => this.orders.find((o) => o.id === id)!;
  }

  host: Host = {
    now: () => this.now,
    sleep: async (ms) => { this.now += ms; },
    hook: async (point, ctx) => {
      const k = this.killAt;
      if (k && k.point === point && (k.stage === undefined || k.stage === ctx.stage)) {
        this.killAt = null;
        throw new ProcessKilled(point);
      }
    },
    emit: (m) => { this.msgs.push(m); },
  };

  transport: Transport = {
    post: async (kind, body, o) => {
      const r = await this.provider.handle({
        method: 'POST', path: PATHS[kind]!, body,
        headers: { ...(o.key ? { 'Idempotency-Key': o.key } : {}), 'X-Haunt-Phase': o.recovery ? 'recovery' : 'normal' },
      });
      if (r.drop) throw new Error('dropped');
      return { status: r.status, body: r.body, headers: r.headers };
    },
    lookup: async (kind, key) => {
      const r = await this.provider.handle({ method: 'GET', path: '/lookup', query: { lane: LANE, kind, key } });
      return r.body as { found: boolean; row?: Record<string, unknown> };
    },
  };

  fault(spec: Partial<FaultSpec>): void {
    this.provider.addFault({ lane: LANE, service: '*', mode: 'status', ...spec } as FaultSpec);
  }

  /** A fresh process: new SDK and pipeline over the same journal file. */
  async start(tier: TierDef): Promise<Pipeline> {
    const sdk = new Sdk({ tier: tier.id, lane: LANE, use: tier.use, host: this.host, transport: this.transport, journalPath: this.journalPath });
    await sdk.start();
    return new Pipeline({
      sdk, tier, seed: SEED, lane: LANE,
      readOrder: (id) => this.readInput(id),
      pollTracking: async (shipment) => {
        const r = await this.provider.handle({ method: 'GET', path: `/tracking/${shipment}`, query: { lane: LANE } });
        return (r.body as { status?: string }).status === 'delivered';
      },
      handoff: async (shipment) => {
        const r = await this.provider.handle({ method: 'GET', path: `/handoff/${shipment}`, query: { lane: LANE } });
        const status = (r.body as { status?: string }).status;
        if (status !== 'delivered') throw new Error(`handoff blocked: ${status}`);
      },
      hook: (point, ctx) => this.host.hook(point, ctx),
      emit: (m) => this.host.emit(m),
    });
  }

  rows(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of this.provider.ledger(LANE)) out[r.kind] = (out[r.kind] ?? 0) + 1;
    return out;
  }
}

const ID = 'ord-0001';
const CLEAN = { account: 1, charge: 1, email: 1, dispatch: 1, notify: 2 };

/** Runs the order, kills once at `at`, restarts a fresh process, and returns the ledger. */
async function crashAndRestart(tier: string, at: { point: HookPoint; stage?: string }): Promise<Record<string, number>> {
  const w = new World();
  const t = tierById(tier);
  w.killAt = at;
  await expect((await w.start(t)).run(ID)).rejects.toBeInstanceOf(ProcessKilled);
  await (await w.start(t)).run(ID);
  return w.rows();
}

describe('pipeline definition', () => {
  it('has eight stages in order and five tiers with the documented parts', () => {
    expect(STAGES.map((s) => s.id)).toEqual(['intake', 'account', 'payment', 'confirmation', 'dispatch', 'updates', 'tracking', 'handoff']);
    expect(TIERS.map((t) => [t.id, t.lane, t.use.length])).toEqual([
      ['rookie', 1, 0], ['retrier', 2, 1], ['journaler', 3, 2], ['reconciler', 4, 3], ['phoenix', 5, 5],
    ]);
  });

  it('generates the same orders for the same seed with unique emails', () => {
    const a = generateOrders('s', 12);
    expect(a).toEqual(generateOrders('s', 12));
    expect(new Set(a.map((o) => o.email)).size).toBe(12);
    expect(a[0]!.id).toBe('ord-0001');
    for (const o of a) expect(o.total).toBe(o.items.reduce((x, i) => x + i.qty * i.price, 0));
  });

  it('stage durations are stateless, in range, and sum to the baseline', () => {
    for (const d of STAGES) {
      const v = stageDuration(d, SEED, LANE, ID, 1, 1);
      expect(v).toBe(stageDuration(d, SEED, LANE, ID, 1, 1));
      expect(v).toBeGreaterThanOrEqual(d.min);
      expect(v).toBeLessThan(d.max);
    }
    expect(baselineMs(SEED, LANE, ID, 2)).toBeCloseTo(baselineMs(SEED, LANE, ID, 1) / 2);
  });
});

describe('clean runs', () => {
  it.each(TIERS.map((t) => t.id))('%s completes one clean order with one row per effect', async (tier) => {
    const w = new World();
    const r = await (await w.start(tierById(tier))).run(ID); expect([r, w.msgs.filter((m) => m.type === 'order_failed')]).toEqual(['done', []]);
    expect(w.rows()).toEqual(CLEAN);
    const stages = w.msgs.filter((m) => m.type === 'stage_start').map((m) => m.stage);
    expect(stages).toEqual(STAGES.map((s) => s.id));
  });

  it('sends keys only for tiers with idempotency', async () => {
    for (const tier of ['rookie', 'journaler', 'reconciler']) {
      const w = new World();
      await (await w.start(tierById(tier))).run(ID);
      const keyed = w.provider.ledger(LANE).every((r) => (r as { key?: string | null }).key != null);
      expect(keyed).toBe(tier === 'reconciler');
    }
  });
});

describe('acceptance table A through the pipeline', () => {
  it('A1 crash at payment before_effect: Rookie repeats the account', async () => {
    expect(await crashAndRestart('rookie', { point: 'before_effect', stage: 'payment' })).toEqual({ ...CLEAN, account: 2 });
    expect(await crashAndRestart('journaler', { point: 'before_effect', stage: 'payment' })).toEqual(CLEAN);
  });

  it('A2 crash at payment after_effect_before_journal: only idempotency prevents the second charge', async () => {
    const at = { point: 'after_effect_before_journal' as const, stage: 'payment' };
    expect(await crashAndRestart('rookie', at)).toEqual({ ...CLEAN, account: 2, charge: 2 });
    expect(await crashAndRestart('journaler', at)).toEqual({ ...CLEAN, charge: 2 });
    expect(await crashAndRestart('reconciler', at)).toEqual(CLEAN);
    expect(await crashAndRestart('phoenix', at)).toEqual(CLEAN);
  });

  it('A3 crash at payment after_journal: Journaler does not repeat', async () => {
    const at = { point: 'after_journal' as const, stage: 'payment' };
    expect(await crashAndRestart('journaler', at)).toEqual(CLEAN);
    expect(await crashAndRestart('retrier', at)).toEqual({ ...CLEAN, account: 2, charge: 2 });
  });

  it('A5 crash at intake mid_stage repeats nothing', async () => {
    for (const t of TIERS) expect(await crashAndRestart(t.id, { point: 'mid_stage', stage: 'intake' })).toEqual(CLEAN);
  });

  it('A6 crash at tracking mid_stage: Rookie repeats all five kinds, Journaler none', async () => {
    const at = { point: 'mid_stage' as const, stage: 'tracking' };
    expect(await crashAndRestart('rookie', at)).toEqual({ account: 2, charge: 2, email: 2, dispatch: 2, notify: 4 });
    expect(await crashAndRestart('retrier', at)).toEqual({ account: 2, charge: 2, email: 2, dispatch: 2, notify: 4 });
    expect(await crashAndRestart('journaler', at)).toEqual(CLEAN);
  });

  it('resumes tracking with the journaled shipment after a restart (replay-skipped dispatch)', async () => {
    for (const tier of ['journaler', 'reconciler', 'phoenix']) {
      const w = new World();
      const polled: string[] = [];
      const t = tierById(tier);
      w.killAt = { point: 'mid_stage', stage: 'tracking' };
      await expect((await w.start(t)).run(ID)).rejects.toBeInstanceOf(ProcessKilled);
      const p = await w.start(t);
      const inner = (p as unknown as { d: { pollTracking(s: string): Promise<boolean> } }).d;
      const poll = inner.pollTracking;
      inner.pollTracking = async (s) => { polled.push(s); return poll(s); };
      expect(await p.run(ID)).toBe('done');
      expect(polled.length).toBeGreaterThan(0);
      expect(polled.every((s) => s === 'sh_1')).toBe(true);
      expect(w.rows()).toEqual(CLEAN);
    }
  });
  it('A10 http_404 at payment (2 calls): Rookie fails, Retrier recovers', async () => {
    const rookie = new World();
    rookie.fault({ service: 'charge', value: 404, count: 2 });
    expect(await (await rookie.start(tierById('rookie'))).run(ID)).toBe('failed');
    const retrier = new World();
    retrier.fault({ service: 'charge', value: 404, count: 2 });
    expect(await (await retrier.start(tierById('retrier'))).run(ID)).toBe('done');
    expect(retrier.rows()).toEqual(CLEAN);
  });
});

describe('handoff provider call (PT-C7)', () => {
  it('a handoff_block fault fails the order and a clean handoff delivers it', async () => {
    const w = new World();
    w.fault({ service: 'handoff', mode: 'handoff_block', block: 'gated', count: 1 });
    expect(await (await w.start(tierById('rookie'))).run(ID)).toBe('failed');
    expect(await (await new World().start(tierById('rookie'))).run(ID)).toBe('done');
  });
});

describe('input errors by tier (runtime.md section 7)', () => {
  const missing = (w: World) => { w.readInput = async () => { throw new InputError('missing', 'ENOENT'); }; };
  const malformed = (w: World) => { w.readInput = async () => { throw new InputError('malformed', 'bad json'); }; };

  it('A15 missing file: Rookie halts, Retrier to Reconciler fail, Phoenix parks', async () => {
    const run = async (tier: string) => { const w = new World(); missing(w); return (await w.start(tierById(tier))).run(ID); };
    await expect(run('rookie')).rejects.toBeInstanceOf(LaneHalted);
    for (const t of ['retrier', 'journaler', 'reconciler']) expect(await run(t)).toBe('failed');
    expect(await run('phoenix')).toBe('parked');
  });

  it('A16 malformed payload: Rookie halts, Retrier to Reconciler fail, Phoenix quarantines', async () => {
    const run = async (tier: string) => { const w = new World(); malformed(w); return (await w.start(tierById(tier))).run(ID); };
    await expect(run('rookie')).rejects.toBeInstanceOf(LaneHalted);
    for (const t of ['retrier', 'journaler', 'reconciler']) expect(await run(t)).toBe('failed');
    expect(await run('phoenix')).toBe('quarantined');
  });
});

