// The eleven-stage order pipeline (tournament-v3 spec section 2) and the five policy tiers.
// Spec: .kiro/specs/engine/design.md sections 1 and 4; runtime.md sections 5, 7, 21 and 28.
import { fnv1a32, mulberry32, unit } from '../shared';
import { ParkSignal, ProcessKilled, QuarantineError, WrongOrder, type Part, type Sdk } from '../sdk';

export interface StageDef {
  id: string;
  label: string;
  min: number;
  max: number;
}

export const STAGES: readonly StageDef[] = [
  { id: 'account', label: 'Account or login', min: 400, max: 800 },
  { id: 'create', label: 'Create order', min: 300, max: 700 },
  { id: 'submit', label: 'Submit order', min: 200, max: 400 },
  { id: 'payment', label: 'Payment', min: 700, max: 1300 },
  { id: 'confirmation', label: 'Confirmation', min: 300, max: 600 },
  { id: 'receive', label: 'Store receives', min: 200, max: 400 },
  { id: 'process', label: 'Process order', min: 300, max: 600 },
  { id: 'updates', label: 'Order updates', min: 300, max: 600 },
  { id: 'ship', label: 'Ship and pack', min: 500, max: 1000 },
  { id: 'transit', label: 'Delivery updates', min: 1500, max: 3000 },
  { id: 'handoff', label: 'Handoff', min: 300, max: 600 },
];

export type TierId = 'rookie' | 'retrier' | 'journaler' | 'reconciler' | 'phoenix' | 'crew';

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

/** The campaign Crew (CP-C2): lane 1, parts chosen per night via `HAUNT_PARTS`. Not one of the five racing tiers, so it is not in `TIERS`. */
export const CREW_TIER: TierDef = { id: 'crew', lane: 1, label: 'Your Crew', use: [] };

export function tierById(id: string): TierDef {
  if (id === CREW_TIER.id) return CREW_TIER;
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

/**
 * The customer of an order, derived from the order id alone so the `account` stage (first) never needs the input file
 * that `create` reads. Same rule as `generateOrders`: `ord-0007` is `user7@example.test`.
 */
export function customerEmail(id: string): string {
  const m = /(\d+)/.exec(id);
  return m ? `user${Number(m[1])}@example.test` : `${id}@example.test`;
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
    out.push({ id: orderId(i), email: customerEmail(orderId(i)), items, total: items.reduce((a, b) => a + b.qty * b.price, 0) });
  }
  return out;
}

/**
 * `order_typo` (design.md section 8): the same customer and id, but every line is a different product. The file is still
 * valid JSON, so create passes and the wrong cart is charged. Deterministic from the seed.
 */
export function swapItems(order: OrderData, seed: string | number): OrderData {
  const rng = mulberry32(fnv1a32(`${seed}|typo|${order.id}`));
  const items = order.items.map((it) => {
    const pool = SKUS.filter((s) => s.sku !== it.sku && s.price !== it.price);
    const pick = pool[Math.floor(rng() * pool.length)]!;
    return { sku: pick.sku, qty: it.qty, price: pick.price };
  });
  return { ...order, items, total: items.reduce((a, b) => a + b.qty * b.price, 0) };
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
  /** One transit poll (the provider "tracking" endpoint). Resolves to true when delivered. */
  pollTracking(shipment: string): Promise<boolean>;
  /** Live handoff call (stage 11). Throws when the handoff is blocked. Absent in bots that do not call a provider. */
  handoff?(shipment: string): Promise<void>;
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

  /** Runs one order through all eleven stages. Throws LaneHalted when the tier cannot absorb an input error. */
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
    let submitted: unknown;
    let charge: unknown;
    let shipment = '';

    // Account or login comes first: the customer is derived from the order id, not from the input file.
    await sdk.stage('account', async (s) => {
      await s.work(this.work(def('account'), id));
      account = await s.effect('account', { key: this.key(s, 'account'), body: { email: customerEmail(id) } });
    });
    account ??= sdk.recorded('account', 'account');

    await sdk.stage('create', async (s) => {
      await s.work(this.work(def('create'), id));
      await this.d.hook('input_read', { order: id, stage: 'create' });
      try {
        order = await this.d.readOrder(id);
      } catch (e) {
        throw this.inputFailure(e);
      }
    });
    // After a journal replay create is skipped; read the file again for its data only (no effect repeats).
    if (!order) order = await this.d.readOrder(id).catch((e) => { throw this.inputFailure(e); });
    const o = order;

    // Submit: the order number becomes final. One cheap journaled effect of its own kind, so a repeat shows in ORDERS.
    await sdk.stage('submit', async (s) => {
      await s.work(this.work(def('submit'), id));
      submitted = await s.effect('order', { key: this.key(s, 'order'), body: { account: idOf(account), total: o.total } });
    });
    submitted ??= sdk.recorded('submit', 'order');
    await sdk.stage('payment', async (s) => {
      await s.work(this.work(def('payment'), id));
      charge = await s.effect('charge', { key: this.key(s, 'charge'), body: { amount: o.total, account: idOf(account) } });
    });
    charge ??= sdk.recorded('payment', 'charge');
    await sdk.stage('confirmation', async (s) => {
      await s.work(this.work(def('confirmation'), id));
      await s.effect('email', { key: this.key(s, 'email'), body: { charge: idOf(charge) } });
    });
    await sdk.stage('receive', async (s) => {
      await s.work(this.work(def('receive'), id));
      await s.effect('store', { key: this.key(s, 'store:1'), index: 1, body: { step: 'receive', ref: idOf(submitted) } });
    });
    await sdk.stage('process', async (s) => {
      await s.work(this.work(def('process'), id));
      await s.effect('store', { key: this.key(s, 'store:2'), index: 2, body: { step: 'process', lines: o.items.length } });
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
    await sdk.stage('ship', async (s) => {
      await s.work(this.work(def('ship'), id));
      shipment = idOf(await s.effect('dispatch', { key: this.key(s, 'dispatch') }));
    });
    shipment ||= idOf(sdk.recorded('ship', 'dispatch'));
    await sdk.stage('transit', async (s) => {
      await s.work(this.work(def('transit'), id));
      const polls = Math.max(1, Math.ceil(def('transit').min / POLL_EVERY_MS));
      for (let i = 1; i <= polls; i++) {
        const delivered = await this.d.pollTracking(shipment);
        this.d.emit({ type: 'progress', order: id, stage: 'transit', detail: { poll: i } });
        if (delivered) return;
      }
      throw new Error('transit: not delivered');
    });
    await sdk.stage('handoff', async (s) => {
      await s.work(this.work(def('handoff'), id));
      // A wrong order found at handoff (detect: 'handoff'): after a discount the handoff call is made again.
      for (;;) {
        try {
          await this.d.handoff?.(shipment);
          return;
        } catch (e) {
          if (!(e instanceof WrongOrder)) throw e;
          await s.wrongOrder(e.detectedAt);
        }
      }
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
