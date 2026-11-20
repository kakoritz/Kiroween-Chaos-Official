// The eight-stage order pipeline and the five policy tiers.
// Spec: .kiro/specs/engine/design.md sections 1 and 4; runtime.md sections 5, 7, 21 and 28.
import { fnv1a32, mulberry32, unit } from '../shared';
import { ParkSignal, ProcessKilled, QuarantineError, type Part, type Sdk } from '../sdk';

export interface StageDef {
  id: string;
  label: string;
  min: number;
  max: number;
}

export const STAGES: readonly StageDef[] = [
  { id: 'intake', label: 'Order intake', min: 400, max: 900 },
  { id: 'account', label: 'Account creation', min: 500, max: 1000 },
  { id: 'payment', label: 'Payment processing', min: 800, max: 1500 },
  { id: 'confirmation', label: 'Confirmation', min: 400, max: 800 },
  { id: 'dispatch', label: 'Dispatch to delivery', min: 600, max: 1200 },
  { id: 'updates', label: 'Order updates', min: 400, max: 800 },
  { id: 'tracking', label: 'Delivery tracking', min: 1500, max: 3000 },
  { id: 'handoff', label: 'Handoff', min: 300, max: 600 },
];

export type TierId = 'rookie' | 'retrier' | 'journaler' | 'reconciler' | 'phoenix';

export interface TierDef {
  id: TierId;
  lane: number;
  label: string;
  use: readonly Part[];
}

export const TIERS: readonly TierDef[] = [
  { id: 'rookie', lane: 1, label: 'Rookie', use: [] },
  { id: 'retrier', lane: 2, label: 'Retrier', use: ['retry'] },
  { id: 'journaler', lane: 3, label: 'Journaler', use: ['retry', 'journal'] },
  { id: 'reconciler', lane: 4, label: 'Reconciler', use: ['retry', 'journal', 'idempotency'] },
  { id: 'phoenix', lane: 5, label: 'Phoenix', use: ['retry', 'journal', 'idempotency', 'breaker', 'offline_queue'] },
];

export function tierById(id: string): TierDef {
  const t = TIERS.find((x) => x.id === id);
  if (!t) throw new Error(`unknown tier ${id}`);
  return t;
}

export interface Item { sku: string; qty: number; price: number }
export interface OrderData { id: string; email: string; items: Item[]; total: number }

const SKUS: readonly { sku: string; price: number }[] = [
  { sku: 'cursed-candle', price: 1200 }, { sku: 'bone-chime', price: 1800 },
  { sku: 'ghost-lantern', price: 2500 }, { sku: 'raven-quill', price: 900 },
  { sku: 'moth-jar', price: 1500 }, { sku: 'grave-soil', price: 700 },
  { sku: 'spider-silk', price: 2200 }, { sku: 'witch-hazel', price: 1100 },
  { sku: 'toad-stool', price: 600 }, { sku: 'crypt-key', price: 3000 },
  { sku: 'bat-wing', price: 1400 }, { sku: 'mirror-shard', price: 2000 },
];

export function orderId(i: number): string {
  return `ord-${String(i).padStart(4, '0')}`;
}

/** Same seed gives the same orders. Emails are unique. */
export function generateOrders(seed: string | number, n: number): OrderData[] {
  const rng = mulberry32(fnv1a32(`${seed}|orders`));
  const out: OrderData[] = [];
  for (let i = 1; i <= n; i++) {
    const count = 1 + Math.floor(rng() * 3);
    const items: Item[] = [];
    for (let k = 0; k < count; k++) {
      const s = SKUS[Math.floor(rng() * SKUS.length)]!;
      items.push({ sku: s.sku, qty: 1 + Math.floor(rng() * 3), price: s.price });
    }
    out.push({ id: orderId(i), email: `user${i}@example.test`, items, total: items.reduce((a, b) => a + b.qty * b.price, 0) });
  }
  return out;
}

/** Work duration in ms before the speed divisor: `min + u * (max - min)`. */
export function stageDuration(def: StageDef, seed: string | number, lane: string, order: string, attempt: number, localRun: number): number {
  return def.min + unit(seed, lane, order, def.id, attempt, localRun) * (def.max - def.min);
}

/** Baseline for the speed bonus: attempt-1 durations of all stages, divided by speed. */
export function baselineMs(seed: string | number, lane: string, order: string, speed = 1): number {
  return STAGES.reduce((a, d) => a + stageDuration(d, seed, lane, order, 1, 1), 0) / speed;
}

/** Input errors are never retried (runtime.md section 7). */
export class InputError extends Error {
  constructor(readonly kind: 'missing' | 'malformed', msg: string) {
    super(msg);
  }
}

/** The lane stops: unhandled input error in a bot with no `retry`. */
export class LaneHalted extends Error {}

export interface PipelineDeps {
  sdk: Sdk;
  tier: TierDef;
  seed: string | number;
  lane: string;
  speed?: number;
  /** HAUNT_ATTEMPT: process start count. */
  attempt?: number;
  /** Reads and validates the input file for an order. Throws InputError. */
  readOrder(id: string): Promise<OrderData>;
  /** One tracking poll. Resolves to true when delivered. */
  pollTracking(shipment: string): Promise<boolean>;
  hook(point: 'input_read', ctx: { order: string; stage: string }): Promise<void>;
  emit(msg: Record<string, unknown>): void;
}

const NOTIFY_COUNT = 2;
const POLL_EVERY_MS = 300;

export type PipelineResult = 'done' | 'skipped' | 'failed' | 'parked' | 'quarantined';

export class Pipeline {
  private readonly runs = new Map<string, number>();
  private readonly idem: boolean;
  private readonly retry: boolean;
  private readonly queue: boolean;

  constructor(private readonly d: PipelineDeps) {
    const use = new Set(d.tier.use);
    this.idem = use.has('idempotency');
    this.retry = use.has('retry');
    this.queue = use.has('offline_queue');
  }

  /** Runs one order through all eight stages. Throws LaneHalted when the tier cannot absorb an input error. */
  async run(id: string): Promise<PipelineResult> {
    let halted = false;
    const res = await this.d.sdk.order(id, async () => {
      try {
        await this.stages(id);
      } catch (e) {
        if (e instanceof LaneHalted) halted = true;
        throw e;
      }
    });
    if (halted) throw new LaneHalted(`lane ${this.d.lane} halted on ${id}`);
    return res;
  }

  private work(def: StageDef, order: string): number {
    const k = `${order}|${def.id}`;
    const n = (this.runs.get(k) ?? 0) + 1;
    this.runs.set(k, n);
    return stageDuration(def, this.d.seed, this.d.lane, order, this.d.attempt ?? 1, n) / (this.d.speed ?? 1);
  }

  private key(s: { key(n: string): string }, name: string): string | undefined {
    return this.idem ? s.key(name) : undefined;
  }

  private async stages(id: string): Promise<void> {
    const { sdk } = this.d;
    const def = (n: string) => STAGES.find((s) => s.id === n)!;
    let order: OrderData | undefined;
    let account: unknown;
    let charge: unknown;
    let shipment = '';

    await sdk.stage('intake', async (s) => {
      await s.work(this.work(def('intake'), id));
      await this.d.hook('input_read', { order: id, stage: 'intake' });
      try {
        order = await this.d.readOrder(id);
      } catch (e) {
        throw this.inputFailure(e);
      }
    });
    // After a journal replay intake is skipped; read the file again for its data only (no effect repeats).
    if (!order) order = await this.d.readOrder(id).catch((e) => { throw this.inputFailure(e); });
    const o = order;

    await sdk.stage('account', async (s) => {
      await s.work(this.work(def('account'), id));
      account = await s.effect('account', { key: this.key(s, 'account'), body: { email: o.email } });
    });
    await sdk.stage('payment', async (s) => {
      await s.work(this.work(def('payment'), id));
      charge = await s.effect('charge', { key: this.key(s, 'charge'), body: { amount: o.total, account: idOf(account) } });
    });
    await sdk.stage('confirmation', async (s) => {
      await s.work(this.work(def('confirmation'), id));
      await s.effect('email', { key: this.key(s, 'email'), body: { charge: idOf(charge) } });
    });
    await sdk.stage('dispatch', async (s) => {
      await s.work(this.work(def('dispatch'), id));
      shipment = idOf(await s.effect('dispatch', { key: this.key(s, 'dispatch') }));
    });
    await sdk.stage('updates', async (s) => {
      await s.work(this.work(def('updates'), id));
      // Non-critical: a failure after retries is degraded and the pipeline continues (runtime.md section 21).
      try {
        for (let i = 1; i <= NOTIFY_COUNT; i++) {
          await s.effect('notify', { key: this.key(s, `notify:${i}`), index: i });
        }
      } catch (e) {
        if (isControl(e)) throw e;
        this.d.emit({ type: 'stage_fail', order: id, stage: 'updates', detail: { degraded: true } });
      }
    });
    await sdk.stage('tracking', async (s) => {
      await s.work(this.work(def('tracking'), id));
      const polls = Math.max(1, Math.ceil(def('tracking').min / POLL_EVERY_MS));
      for (let i = 1; i <= polls; i++) {
        const delivered = await this.d.pollTracking(shipment);
        this.d.emit({ type: 'progress', order: id, stage: 'tracking', detail: { poll: i } });
        if (delivered) return;
      }
      throw new Error('tracking: not delivered');
    });
    await sdk.stage('handoff', async (s) => {
      await s.work(this.work(def('handoff'), id));
    });
  }

  /** Maps an input error to the tier's behavior (design.md section 4, runtime.md section 7). */
  private inputFailure(e: unknown): Error {
    if (!(e instanceof InputError)) return e instanceof Error ? e : new Error(String(e));
    if (this.queue) return e.kind === 'malformed' ? new QuarantineError(e.message) : new ParkSignal('missing_file');
    if (this.retry) return e;
    return new LaneHalted(e.message);
  }
}

function idOf(v: unknown): string {
  const id = (v as { id?: unknown } | null | undefined)?.id;
  return id === undefined ? '' : String(id);
}

function isControl(e: unknown): boolean {
  return e instanceof ParkSignal || e instanceof QuarantineError || e instanceof LaneHalted || e instanceof ProcessKilled;
}
