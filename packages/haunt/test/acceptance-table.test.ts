// E11: acceptance.md table A (all 21 rows, five tiers, in-process with a fake clock) and properties P1, P2, P6.
// P3, P4, P5, P7, P8 live in sdk.test.ts, provider.test.ts, score.test.ts and sweep-executor.test.ts.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST_ROUTES, Provider, type FaultSpec, type ProviderClock } from '../../core/src/provider';
import { ProcessKilled, Sdk, type HookPoint, type Host, type Transport } from '../src/sdk';
import { faultBody } from '../src/runner/provider';
import { resolveOutcome } from '../../haunt/src/shared/outcomes';
import { InputError, LaneHalted, Pipeline, TIERS, generateOrders, tierById, type OrderData, type PipelineResult } from '../src/pipeline';

/** Lets the worker's timers and RPC run: a fake sleep that only resolves microtasks starves the event loop for the whole file. */
const yieldTurn = (): Promise<void> => new Promise((r) => setImmediate(r));
const LANE = 'L1';
const SEED = 'seed-1';
const ID = 'ord-0001';
const PATHS = Object.fromEntries(Object.entries(POST_ROUTES).map(([p, k]) => [k, p]));
// One row per effect of the 11-step order (submit = order, receive + process = store x2, ship = dispatch).
const CLEAN: Record<string, number> = { account: 1, order: 1, charge: 1, email: 1, store: 2, dispatch: 1, notify: 2 };
const TIER_IDS = ['rookie', 'retrier', 'journaler', 'reconciler', 'phoenix'] as const;
const CLIENT_TIMEOUT_MS = 1500;
type Kill = { point: HookPoint; stage?: string };

class World {
  now = 0;
  readonly provider: Provider;
  kills: Kill[] = [];
  readInput: (id: string) => Promise<OrderData>;
  readonly orders = generateOrders(SEED, 3);
  readonly journalPath = join(mkdtempSync(join(tmpdir(), 'haunt-acc-')), 'lane-1.journal.jsonl');
  sdkOf: Sdk | null = null;

  constructor() {
    const clock: ProviderClock = { now: () => this.now, sleep: async (ms) => { this.now += ms; await yieldTurn(); } };
    this.provider = new Provider({ clock });
    this.readInput = async (id) => this.orders.find((o) => o.id === id)!;
  }

  host: Host = {
    now: () => this.now,
    sleep: async (ms) => { this.now += ms; await yieldTurn(); },
    hook: async (point, ctx) => {
      const k = this.kills[0];
      if (k && k.point === point && (k.stage === undefined || k.stage === ctx.stage)) {
        this.kills.shift();
        throw new ProcessKilled(point);
      }
    },
    emit: () => {},
  };

  transport: Transport = {
    post: async (kind, body, o) => {
      const t0 = this.now;
      const r = await this.provider.handle({
        method: 'POST', path: PATHS[kind]!, body,
        headers: { ...(o.key ? { 'Idempotency-Key': o.key } : {}), 'X-Haunt-Phase': o.recovery ? 'recovery' : 'normal' },
      });
      if (r.drop) throw new Error('dropped');
      if (this.now - t0 > CLIENT_TIMEOUT_MS) { this.now = t0 + CLIENT_TIMEOUT_MS; throw new Error('client timeout'); }
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

  async start(tierId: string): Promise<Pipeline> {
    const tier = tierById(tierId);
    const sdk = new Sdk({ tier: tier.id, lane: LANE, use: tier.use, host: this.host, transport: this.transport, journalPath: this.journalPath });
    this.sdkOf = sdk;
    await sdk.start();
    return new Pipeline({
      sdk, tier, seed: SEED, lane: LANE,
      readOrder: (id) => this.readInput(id),
      pollTracking: (shipment) => this.poll(shipment, tier.use),
      handoff: (shipment) => this.handoffCall(shipment, tier.use),
      hook: (point, ctx) => this.host.hook(point, ctx),
      emit: () => {},
    });
  }

  /** One tracking poll with the retry/backoff rules the bot runtime applies (runtime.md section 7). */
  private async poll(shipment: string, use: readonly string[]): Promise<boolean> {
    const breaker = use.includes('breaker');
    const max = breaker ? 5 : use.includes('retry') ? 3 : 1;
    for (let n = 1; ; n++) {
      let failure = '';
      try {
        const t0 = this.now;
        const r = await this.provider.handle({ method: 'GET', path: ('/tracking/' + shipment), query: { lane: LANE } });
        if (this.now - t0 > 800) { this.now = t0 + 800; throw new Error('poll timeout'); }
        const status = (r.body as { status?: string }).status;
        if (status === 'delivered') return true;
        if (status === 'in_transit' && !(r.body as { reroute?: boolean }).reroute) return false;
        failure = String(status);
      } catch (e) {
        failure = e instanceof Error ? e.message : String(e);
      }
            if (n >= max) throw new Error(`tracking failed: ${failure}`);
      await this.host.sleep(breaker ? 500 * 2 ** (n - 1) : 500);
    }
  }

  /** The handoff call with the retry rules of the bot runtime (bot/runtime.ts): blocked answers retry like tracking, then fail. */
  private async handoffCall(shipment: string, use: readonly string[]): Promise<void> {
    const breaker = use.includes('breaker');
    const max = breaker ? 5 : use.includes('retry') ? 3 : 1;
    for (let n = 1; ; n++) {
      const r = await this.provider.handle({ method: 'GET', path: `/handoff/${shipment}`, query: { lane: LANE } });
      if (r.status === 200 && (r.body as { status?: string }).status === 'delivered') return;
      if (n >= max) throw new Error('handoff blocked');
      await this.host.sleep(breaker ? 500 * 2 ** (n - 1) : 500);
    }
  }

  /** Arms a catalog fault the way the runner does (runner/provider.ts faultBody). */
  armFault(fault: string, stage: string | null): void {
    const body = faultBody(LANE, stage, { id: 1, fault });
    if (!body) throw new Error(`no provider body for ${fault}`);
    this.provider.addFault(body);
  }

  rows(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of this.provider.ledger(LANE)) out[r.kind] = (out[r.kind] ?? 0) + 1;
    return out;
  }

  /** Runs the order; every kill restarts a fresh process over the same journal. Returns the last result. */
  async play(tierId: string, opts: { heal?: () => void; maxRuns?: number } = {}): Promise<PipelineResult | 'halted' | 'parked>done'> {
    let last: PipelineResult | 'halted' | 'parked>done' = 'failed';
    let parked = false;
    for (let i = 0; i < (opts.maxRuns ?? 12); i++) {
      try {
        last = await (await this.start(tierId)).run(ID);
      } catch (e) {
        if (e instanceof ProcessKilled) { last = 'failed'; continue; }
        if (e instanceof LaneHalted) return 'halted';
        throw e;
      }
      if (last === 'parked' && !parked) {
        parked = true;
        opts.heal?.();
        this.now += 6000;
        continue;
      }
      if (last === 'parked') { this.now += 6000; continue; }
      return parked && last === 'done' ? 'parked>done' : last;
    }
    return last;
  }
}

/** Table A cell code: OK, REPEAT <kinds>, FAILED, HALT, PARKED>OK, QUAR. */
function code(result: string, rows: Record<string, number>): string {
  if (result === 'halted') return 'HALT';
  if (result === 'quarantined') return 'QUAR';
  if (result === 'failed') return 'FAILED';
  if (result !== 'done' && result !== 'parked>done') return result.toUpperCase();
  const extra = Object.keys(CLEAN).filter((k) => (rows[k] ?? 0) > CLEAN[k]!);
  const base = result === 'parked>done' ? 'PARKED>' : '';
  if (extra.length === 0) return `${base}OK`;
  if (extra.length === Object.keys(CLEAN).length) return `${base}REPEAT all x2`;
  return `${base}REPEAT ${extra.map((k) => `${k} x${rows[k]! / CLEAN[k]!}`).join(', ')}`;
}

async function cell(tier: string, setup: (w: World) => void, heal?: () => void): Promise<string> {
  const w = new World();
  setup(w);
  const result = await w.play(tier, { heal: heal ? () => heal() : undefined });
  return code(result, w.rows());
}

const crash = (...kills: Kill[]) => (w: World) => { w.kills = [...kills]; };
/** The recovery hook for the tier: a bot without recovery code is hit at startup (acceptance A8). */
const recoveryHook = (tier: string): HookPoint => (tier === 'rookie' || tier === 'retrier' ? 'startup' : 'during_replay');

interface Row { id: string; setup: (tier: string) => (w: World) => void; expect: [string, string, string, string, string]; heal?: (w: World) => void }
const PAY_A2: Kill = { point: 'after_effect_before_journal', stage: 'payment' };
const ALL5 = 'REPEAT all x2';
const A2: Row['expect'] = ['REPEAT account x2, order x2, charge x2', 'REPEAT account x2, order x2, charge x2', 'REPEAT charge x2', 'OK', 'OK'];

const ROWS: Row[] = [
  { id: 'A1', setup: () => crash({ point: 'before_effect', stage: 'payment' }), expect: ['REPEAT account x2, order x2', 'REPEAT account x2, order x2', 'OK', 'OK', 'OK'] },
  { id: 'A2', setup: () => crash(PAY_A2), expect: A2 },
  { id: 'A3', setup: () => crash({ point: 'after_journal', stage: 'payment' }), expect: ['REPEAT account x2, order x2, charge x2', 'REPEAT account x2, order x2, charge x2', 'OK', 'OK', 'OK'] },
  { id: 'A4', setup: () => crash({ point: 'after_effect_before_journal', stage: 'account' }), expect: ['REPEAT account x2', 'REPEAT account x2', 'REPEAT account x2', 'OK', 'OK'] },
  // Account comes first now: a crash while reading the input file repeats it unless there is a journal.
  { id: 'A5', setup: () => crash({ point: 'mid_stage', stage: 'create' }), expect: ['REPEAT account x2', 'REPEAT account x2', 'OK', 'OK', 'OK'] },
  { id: 'A5b', setup: () => crash({ point: 'before_effect', stage: 'account' }), expect: ['OK', 'OK', 'OK', 'OK', 'OK'] },
  { id: 'A6', setup: () => crash({ point: 'mid_stage', stage: 'transit' }), expect: [ALL5, ALL5, 'OK', 'OK', 'OK'] },
  { id: 'A7', setup: () => crash(PAY_A2), expect: A2 },
  { id: 'A8', setup: (t) => crash(PAY_A2, { point: recoveryHook(t) }), expect: A2 },
  {
    id: 'A9', setup: () => (w) => w.fault({ service: 'charge', mode: 'latency', value: 3000, count: 1 }),
    expect: ['FAILED', 'REPEAT charge x2', 'REPEAT charge x2', 'OK', 'OK'],
  },
  { id: 'A10', setup: () => (w) => w.fault({ service: 'charge', value: 404, count: 2 }), expect: ['FAILED', 'OK', 'OK', 'OK', 'OK'] },
  { id: 'A11', setup: () => (w) => w.fault({ service: 'charge', value: 500, count: 2 }), expect: ['FAILED', 'OK', 'OK', 'OK', 'OK'] },
  {
    id: 'A12', setup: () => (w) => w.fault({ service: 'charge', value: 429, count: 3, headers: { 'Retry-After': '2' } }),
    expect: ['FAILED', 'FAILED', 'FAILED', 'FAILED', 'OK'],
  },
  { id: 'A13', setup: () => (w) => w.fault({ mode: 'drop', forMs: 8000 }), expect: ['FAILED', 'FAILED', 'FAILED', 'FAILED', 'PARKED>OK'] },
  { id: 'A14', setup: () => (w) => w.fault({ mode: 'status', value: 503, forMs: 10000 }), expect: ['FAILED', 'FAILED', 'FAILED', 'FAILED', 'PARKED>OK'] },
  {
    id: 'A15', setup: () => (w) => { w.readInput = async () => { throw new InputError('missing', 'ENOENT'); }; },
    heal: (w) => { w.readInput = async (id) => w.orders.find((o) => o.id === id)!; },
    expect: ['HALT', 'FAILED', 'FAILED', 'FAILED', 'PARKED>OK'],
  },
  {
    id: 'A16', setup: () => (w) => { w.readInput = async () => { throw new InputError('malformed', 'bad json'); }; },
    expect: ['HALT', 'FAILED', 'FAILED', 'FAILED', 'QUAR'],
  },
  { id: 'A18', setup: () => () => {}, expect: ['OK', 'OK', 'OK', 'OK', 'OK'] },
  { id: 'A19', setup: () => (w) => w.fault({ service: 'tracking', mode: 'stall', value: 5000, forMs: 5000 }), expect: ['FAILED', 'FAILED', 'FAILED', 'FAILED', 'OK'] },
  { id: 'A20', setup: () => (w) => w.fault({ service: 'tracking', mode: 'no_driver', forMs: 3000 }), expect: ['FAILED', 'FAILED', 'FAILED', 'FAILED', 'OK'] },
  { id: 'A21', setup: () => (w) => w.fault({ mode: 'latency', value: 600, forMs: 6000 }), expect: ['OK', 'OK', 'OK', 'OK', 'OK'] },
];

describe('acceptance table A, all tiers (in-process, fake clock)', () => {
  for (const row of ROWS) {
    it(`${row.id}: ${TIER_IDS.map((t, i) => `${t}=${row.expect[i]}`).join('; ')}`, async () => {
      const got: string[] = [];
      for (const t of TIER_IDS) {
        const w = new World();
        row.setup(t)(w);
        const result = await w.play(t, { heal: row.heal ? () => row.heal!(w) : undefined });
        got.push(code(result, w.rows()));
      }
      expect(got).toEqual(row.expect);
    });
  }

  it('A9 Rookie: the charge landed and no dispatch did (paid, not fulfilled)', async () => {
    const w = new World();
    w.fault({ service: 'charge', mode: 'latency', value: 3000, count: 1 });
    expect(await w.play('rookie')).toBe('failed');
    expect(w.rows().charge).toBe(1);
    expect(w.rows().dispatch).toBeUndefined();
  });

  it('A17 duplicate_request: the same order id arrives twice', async () => {
    const got: string[] = [];
    for (const t of TIER_IDS) {
      const w = new World();
      await (await w.start(t)).run(ID);
      await (await w.start(t)).run(ID);
      got.push(code('done', w.rows()));
    }
    expect(got).toEqual([ALL5, ALL5, 'OK', 'OK', 'OK']);
  });

  it('A18 disk_full: one journal write fails and every tier still completes clean', async () => {
    for (const t of TIER_IDS) {
      const w = new World();
      const p = await w.start(t);
      w.sdkOf!.armDiskFull();
      expect(await p.run(ID)).toBe('done');
      expect(w.rows()).toEqual(CLEAN);
    }
  });

  it('J: the same fault gives the same outcome code regardless of the clock offset (speed independence, in-process)', async () => {
    for (const t of ['journaler', 'phoenix']) {
      const a = await cell(t, crash(PAY_A2));
      const w = new World();
      w.now = 123456;
      w.kills = [PAY_A2];
      expect(code(await w.play(t), w.rows())).toBe(a);
    }
  });
});

const EFFECT_STAGES = ['account', 'submit', 'payment', 'confirmation', 'receive', 'process', 'updates', 'ship'];
const POINTS: HookPoint[] = ['before_effect', 'after_effect_before_journal', 'after_journal', 'mid_stage'];
const RUNS = 200;

describe('property tests (local only, never in CI)', () => {
  it('P1: Reconciler and Phoenix write exactly the expected rows per (kind, order) for any effect stage and crash point', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom('reconciler', 'phoenix'), fc.constantFrom(...EFFECT_STAGES), fc.constantFrom(...POINTS), async (tier, stage, point) => {
        const w = new World();
        w.kills = [{ point, stage }];
        await w.play(tier);
        expect(w.rows()).toEqual(CLEAN);
      }),
      { numRuns: RUNS },
    );
  });

  it('P2: Journaler never repeats a side effect when it crashes at after_journal, at any stage', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...EFFECT_STAGES), async (stage) => {
        const w = new World();
        w.kills = [{ point: 'after_journal', stage }];
        await w.play('journaler');
        for (const [k, n] of Object.entries(w.rows())) expect(n).toBeLessThanOrEqual(CLEAN[k]!);
      }),
      { numRuns: RUNS },
    );
  });

  it('P6: Phoenix under a crash stack of depth 1 to 5 at any stage completes or parks and never repeats', async () => {
    const hooks: HookPoint[] = [...POINTS, 'startup', 'during_replay', 'during_reconcile'];
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...EFFECT_STAGES),
        fc.array(fc.constantFrom(...hooks), { minLength: 1, maxLength: 5 }),
        async (stage, points) => {
          const w = new World();
          w.kills = points.map((point, i) => (i === 0 ? { point, stage } : { point }));
          const result = await w.play('phoenix');
          expect(['done', 'parked', 'parked>done']).toContain(result);
          expect(w.rows()).toEqual(CLEAN);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('the tier list used above matches the pipeline definition', () => {
    expect(TIERS.map((t) => t.id)).toEqual([...TIER_IDS]);
  });
});

// Table L (PT-C9 / P17): the world faults in-process (L3 degrades and L7 parks in the bot runtime, so those two run in apps/haunted-orders/test/table-l-integration.test.ts), checked against the outcome table the mock and the UI use (shared/outcomes.ts).
const L_ROWS = [
  { id: 'L1', fault: 'sms_down', stage: 'confirmation' },
  { id: 'L2', fault: 'app_down', stage: 'ship' },
  { id: 'L5', fault: 'no_answer', stage: 'handoff' },
  { id: 'L6', fault: 'gated_house', stage: 'handoff' },
] as const;
const L_CODE: Record<string, string> = { OK: 'OK', FAILED: 'FAILED', PARKED_OK: 'PARKED>OK' };

describe('acceptance table L, all tiers (in-process, fake clock; P17)', () => {
  for (const row of L_ROWS) {
    it(`${row.id} ${row.fault} at ${row.stage}: the in-process result matches the shared outcome table for every tier`, async () => {
      const got: string[] = [];
      const want: string[] = [];
      for (const t of TIER_IDS) {
        const w = new World();
        w.armFault(row.fault, row.stage);
        got.push(code(await w.play(t, { heal: undefined }), w.rows()));
        want.push(L_CODE[resolveOutcome('orders', t, row.fault, row.stage)!.outcome]!);
      }
      expect(got).toEqual(want);
    });
  }
});
