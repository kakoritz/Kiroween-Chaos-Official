// SDK: order(), stage(), effect(), journal replay and reconcile.
// Semantics: .kiro/specs/engine/runtime.md sections 1, 3, 6, 7, 28 (they win over design.md).
import { TIER_DECISION_DEFAULT } from '../shared/catalog';
import {
  Journal, JournalWriteError, applyRecord, readJournal, replay,
  type DecisionChoice, type EffectState, type JournalRecord, type JournalState, type OrderOutcome,
} from './journal';

export type Part = 'retry' | 'journal' | 'idempotency' | 'breaker' | 'offline_queue';
export const PARTS: readonly Part[] = ['retry', 'journal', 'idempotency', 'breaker', 'offline_queue'];

export type HookPoint =
  | 'startup' | 'input_read' | 'before_effect' | 'after_effect_before_journal' | 'after_journal'
  | 'mid_stage' | 'during_replay' | 'during_reconcile' | 'during_backoff';

export const RETRY = { attempts: 3, delayMs: 500 } as const;
export const BREAKER = { attempts: 5, baseMs: 500, openAfter: 4, openMs: 5000 } as const;

/** The host owns time, the control channel and the kill rendezvous. */
export interface Host {
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Awaited at every hook. The host may block here (the runner kills the process at an armed point). */
  hook(point: HookPoint, ctx: { order?: string; stage?: string }): Promise<void>;
  /** Contract events (`type`) and control messages (`k`). */
  emit(msg: Record<string, unknown>): void;
  /**
   * Wrong order found (design.md section 8): ask who decides and wait. A host without `decide` (in-process runs, tests)
   * gets the bot's own policy at once with source `default`. The bot runtime sends `{k:'decision_needed'}` and waits
   * for the runner's `{k:'decision'}`.
   */
  decide?(q: DecisionQuestion): Promise<{ choice: DecisionChoice; source: DecisionSource }>;
}

export type DecisionSource = 'user' | 'default' | 'timeout';
export type DetectedAt = 'confirmation' | 'handoff';

export interface DecisionQuestion {
  order: string;
  stage: string;
  detectedAt: DetectedAt;
  /** The bot's own policy (`onWrongOrder`): what happens if nobody answers. */
  defaultChoice: DecisionChoice;
}

export interface TransportResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

/** Throws on a client timeout or a dropped connection. Any non-2xx status is a transient error. */
export interface Transport {
  post(kind: string, body: Record<string, unknown>, o: { key: string | null; recovery: boolean }): Promise<TransportResponse>;
  lookup(kind: string, key: string): Promise<{ found: boolean; row?: Record<string, unknown> }>;
}

/** The order cannot proceed now. `offline_queue` parks it and the lane moves on. */
export class ParkSignal extends Error {
  constructor(readonly reason: string) {
    super(`parked: ${reason}`);
  }
}

/** In-process stand-in for SIGKILL: a host hook throws it. Nothing in the SDK catches it. */
export class ProcessKilled extends Error {}

/** Poison input. Never retried. */
export class QuarantineError extends Error {}

/**
 * The order the customer got is not the order that was placed. Raised by the SDK when the confirmation email answers
 * with a complaint, and by a bot's handoff call that sees `wrong_order`. The SDK resolves it (refund, discount or
 * redo) from the decision; a bot only throws it itself from a call the SDK does not make.
 */
export class WrongOrder extends Error {
  constructor(readonly detectedAt: DetectedAt) {
    super(`wrong order detected at ${detectedAt}`);
  }
}

/** The wrong order was refunded: the order is cancelled. Unwinds to `order()`. */
class OrderCancelled extends Error {
  constructor(readonly stage: string) {
    super('wrong order refunded');
  }
}
/** The wrong order was refunded and starts again from the first stage. Unwinds to `order()`. */
class OrderRedo extends Error {}

/** Journal home of the refund and discount effects: they belong to no pipeline stage. */
const RESOLUTION_STAGE = 'wrong_order';

export class CallError extends Error {
  constructor(readonly status: number | null, readonly retryAfterMs: number | null, msg: string) {
    super(msg);
  }
}

export interface SdkOptions {
  tier: string;
  lane: string;
  use: readonly Part[];
  host: Host;
  transport: Transport;
  /** Required with the `journal` part. */
  journalPath?: string;
  /** Browser target: an injected store replaces the node file journal. */
  journalStore?: JournalStore;
  /** Records folded into state at start (the browser target replays the page-owned journal). */
  initialRecords?: readonly JournalRecord[];
  /** Process id for the hello message. Defaults to process.pid when available. */
  pid?: number;
  /** What the bot does when nobody answers a wrong order (`defineBot` option). Defaults to the tier policy. */
  onWrongOrder?: DecisionChoice;
}

/** Append-only record sink. The node Journal and the browser worker store both fit. */
export interface JournalStore {
  append(rec: JournalRecord): void;
  failNextWrite(): void;
  close?(): void;
}

export interface EffectOptions {
  key?: string;
  /** Extra request body fields (amount, template, email...). */
  body?: Record<string, unknown>;
  /** Index for repeated effects in one stage (the two notifications). */
  index?: number;
}

export type OrderResult = 'done' | 'skipped' | 'failed' | 'parked' | 'quarantined';

interface BreakerState { fails: number; openUntil: number | null }

export class Sdk {
  private readonly use: ReadonlySet<Part>;
  private readonly journal: JournalStore | null;
  private state: JournalState = new Map();
  private readonly breakers = new Map<string, BreakerState>();
  private readonly slept = new Set<string>();
  private readonly runs = new Map<string, number>();
  private keyUsed = false;
  private order_: string | null = null;
  private replaying = false;
  /** Redo generation of the order in flight: 0 first, n after the nth redo. Drives the `:rN` key suffix. */
  private gen = 0;
  /** Amount of the last charge per order, for the refund. */
  private readonly charged = new Map<string, number>();

  constructor(private readonly o: SdkOptions) {
    this.use = new Set(o.use);
    if (this.use.has('journal')) {
      if (o.journalStore) this.journal = o.journalStore;
      else if (o.journalPath) this.journal = new Journal(o.journalPath);
      else throw new Error('the journal part needs journalPath');
    } else {
      this.journal = null;
    }
  }

  /** Parts the bot actually used: from `use` and from `key:` presence. */
  parts(): Part[] {
    const p = new Set(this.use);
    if (this.keyUsed) p.add('idempotency');
    return PARTS.filter((x) => p.has(x));
  }

  /** `startup` hook, journal load, `hello`. Call once per process before the first order. */
  async start(): Promise<void> {
    await this.o.host.hook('startup', {});
    if (this.journal) this.state = replay(this.o.initialRecords ?? readJournal(this.o.journalPath ?? ''));
    const pid = this.o.pid ?? (typeof process !== 'undefined' ? process.pid : 0);
    this.o.host.emit({ k: 'hello', tier: this.o.tier, parts: this.parts(), pid });
  }

  /** `disk_full`: the journal's next write throws ENOSPC once. A bot without `journal` ignores it. */
  armDiskFull(): boolean {
    if (!this.journal) return false;
    this.journal.failNextWrite();
    return true;
  }

  /** When the breaker for a service closes to a probe, or null if it is not open. */
  breakerOpenUntil(service: string): number | null {
    return this.breakers.get(service)?.openUntil ?? null;
  }

  close(): void {
    this.journal?.close?.();
  }

  async order(id: string, fn: (sdk: Sdk) => Promise<void>): Promise<OrderResult> {
    const prior = this.state.get(id)?.outcome;
    if (this.journal && (prior === 'done' || prior === 'failed' || prior === 'quarantined')) {
      this.o.host.emit({ k: 'duplicate_skipped', order: id });
      return 'skipped';
    }
    this.order_ = id;
    this.replaying = false;
    this.gen = this.state.get(id)?.redo ?? 0;
    this.ev('order_start', id);
    let outcome: OrderOutcome;
    let result: OrderResult;
    for (;;) {
      try {
        // A wrong order found before a restart is settled first: a decision already made is applied, an unanswered one is asked again.
        const w = this.pendingWrong(id);
        if (w) await this.wrongOrder(id, w.stage, w.detectedAt);
        await fn(this);
        outcome = 'done';
        result = 'done';
        this.ev('order_done', id);
      } catch (e) {
        if (e instanceof ProcessKilled) throw e;
        if (e instanceof OrderRedo) continue;
        if (e instanceof OrderCancelled) {
          outcome = 'failed';
          result = 'failed';
          this.ev('order_failed', id, undefined, { stage: e.stage, error: 'wrong_order', outcome: 'cancelled', reason: 'refunded' });
        } else if (e instanceof ParkSignal) {
          outcome = 'parked';
          result = 'parked';
          this.ev('order_parked', id, undefined, { reason: e.reason });
        } else if (e instanceof QuarantineError) {
          outcome = 'quarantined';
          result = 'quarantined';
          this.ev('order_quarantined', id, undefined, { reason: e.message });
        } else {
          outcome = 'failed';
          result = 'failed';
          this.ev('order_failed', id, undefined, { reason: e instanceof Error ? e.message : String(e) });
        }
      }
      break;
    }
    this.write({ t: 'order_end', order: id, outcome, ts: this.o.host.now() });
    this.order_ = null;
    return result;
  }

  /** Payload journaled for an effect of the current order (what a replay-skipped stage would have returned). */
  recorded(stage: string, kind: string): unknown {
    if (!this.journal) return undefined;
    const e = this.state.get(this.need())?.stages.get(stage)?.effects.get(kind);
    return e?.result ? e.payload : undefined;
  }

  async stage(name: string, fn: (s: StageCtx) => Promise<void>): Promise<void> {
    const order = this.need();
    if (this.journal && this.state.get(order)?.stages.get(name)?.done) {
      await this.o.host.hook('during_replay', { order, stage: name });
      if (!this.replaying) {
        this.replaying = true;
        this.ev('recover_start', order, name, { action: 'replay' });
      }
      this.ev('stage_done', order, name, { skipped: true });
      return;
    }
    this.endReplay(order, name);
    const runKey = `${order}|${name}`;
    const attempt = (this.runs.get(runKey) ?? 0) + 1;
    this.runs.set(runKey, attempt);
    this.write({ t: 'stage_start', order, stage: name, attempt, ts: this.o.host.now() });
    this.ev('stage_start', order, name, { attempt });
    const ctx = new StageCtx(this, order, name);
    await fn(ctx);
    this.write({ t: 'stage_done', order, stage: name, ts: this.o.host.now() });
    this.ev('stage_done', order, name, ctx.onlyReplayed() ? { skipped: true } : undefined);
  }

  // ---- internals used by StageCtx ----

  /** Work sleep: once per (order, stage) per process, with the `mid_stage` hook halfway. */
  async work(order: string, stage: string, ms: number): Promise<void> {
    const k = `${order}|${stage}`;
    if (this.slept.has(k)) return;
    this.slept.add(k);
    await this.o.host.sleep(ms / 2);
    await this.o.host.hook('mid_stage', { order, stage });
    await this.o.host.sleep(ms / 2);
  }

  async effect(order: string, stage: string, kind: string, opts: EffectOptions, seen: { replayed: number; ran: number }): Promise<unknown> {
    const { host } = this.o;
    const key = opts.key ?? null;
    if (key !== null) this.keyUsed = true;
    const eid = opts.index === undefined ? kind : `${kind}:${opts.index}`;
    const prior: EffectState | undefined = this.journal ? this.state.get(order)?.stages.get(stage)?.effects.get(eid) : undefined;
    // A result without stage_done (crash at after_journal) counts as done.
    if (prior?.result) {
      await host.hook('during_replay', { order, stage });
      seen.replayed++;
      return this.checked(order, stage, kind, prior.payload);
    }
    seen.ran++;
    await host.hook('before_effect', { order, stage });
    const body: Record<string, unknown> = { lane: this.o.lane, order, ...opts.body };
    if (opts.index !== undefined) body.index = opts.index;
    let recovery = false;
    if (prior?.intent) {
      if (this.use.has('idempotency') && key !== null) {
        const found = await this.reconcile(order, stage, kind, key);
        if (found !== undefined) {
          this.write({ t: 'result', order, stage, kind, key, eid, payload: found, ts: host.now() });
          await host.hook('after_journal', { order, stage });
          return found;
        }
      }
      recovery = true;
    } else {
      this.write({ t: 'intent', order, stage, kind, key, eid, ts: host.now() });
    }
    const payload = await this.call(order, stage, kind, body, key, recovery);
    await host.hook('after_effect_before_journal', { order, stage });
    this.write({ t: 'result', order, stage, kind, key, eid, payload, ts: host.now() });
    await host.hook('after_journal', { order, stage });
    return this.checked(order, stage, kind, payload);
  }

  /** Settles what a finished effect reports: a confirmation email that carries a wrong-order complaint raises `WrongOrder`. */
  private async checked(order: string, stage: string, kind: string, payload: unknown): Promise<unknown> {
    const p = payload as { amount?: unknown; complaint?: unknown } | null | undefined;
    if (kind === 'charge' && typeof p?.amount === 'number') this.charged.set(order, p.amount);
    if (kind === 'email' && p?.complaint === 'wrong_order') await this.wrongOrder(order, stage, 'confirmation');
    return payload;
  }

  /** Key suffix of the current redo generation (`:r1`, `:r2`, ...), empty for the first run. */
  suffix(): string {
    return this.gen > 0 ? `:r${this.gen}` : '';
  }

  /** The detection already journaled for an order whose decision is not fully applied yet (restart in the middle). */
  private pendingWrong(order: string): { stage: string; detectedAt: DetectedAt } | null {
    if (!this.journal) return null;
    const st = this.state.get(order);
    if (!st || this.discounted(order)) return null;
    for (const [stage, s] of st.stages) {
      const c = s.effects.get('complaint');
      if (c?.result) return { stage, detectedAt: (c.payload as { detectedAt?: DetectedAt } | undefined)?.detectedAt ?? 'confirmation' };
    }
    return null;
  }

  private discounted(order: string): boolean {
    const st = this.state.get(order);
    return st?.decision === 'discount' && st.stages.get(RESOLUTION_STAGE)?.effects.get('discount')?.result === true;
  }

  /**
   * Wrong order found (design.md section 8): journal the detection, ask for the decision once, journal it, then apply it.
   * `discount` returns so the stage carries on; `refund` and `redo` unwind to `order()`. Calling it again for an order
   * whose discount is already applied does nothing, so a replayed stage does not ask twice.
   */
  async wrongOrder(order: string, stage: string, detectedAt: DetectedAt): Promise<void> {
    const { host } = this.o;
    if (this.discounted(order)) return;
    const st = this.state.get(order);
    const logged = st?.stages.get(stage)?.effects.get('complaint')?.result === true;
    if (!logged) {
      this.write({ t: 'result', order, stage, kind: 'complaint', key: null, eid: 'complaint', payload: { detectedAt }, ts: host.now() });
      this.ev('stage_fail', order, stage, { error: 'wrong_order', retryable: false });
    }
    let choice: DecisionChoice | null = st?.decision ?? null;
    if (choice === null) {
      const defaultChoice = this.o.onWrongOrder ?? TIER_DECISION_DEFAULT[this.o.tier] ?? 'refund';
      const answer = host.decide ? await host.decide({ order, stage, detectedAt, defaultChoice }) : { choice: defaultChoice };
      choice = answer.choice;
      this.write({ t: 'decision', order, choice, ts: host.now() });
    }
    if (choice === 'discount') {
      await this.resolution(order, 'discount');
      return;
    }
    await this.resolution(order, 'refund');
    if (choice === 'refund') throw new OrderCancelled(stage);
    const n = this.gen + 1;
    this.write({ t: 'order_redo', order, n, ts: host.now() });
    this.gen = n;
    for (const k of [...this.slept]) if (k.startsWith(`${order}|`)) this.slept.delete(k);
    for (const k of [...this.runs.keys()]) if (k.startsWith(`${order}|`)) this.runs.delete(k);
    this.replaying = false;
    this.ev('order_start', order, undefined, { redo: true });
    throw new OrderRedo();
  }

  /** The refund or discount for the wrong order, keyed `<order>:refund` / `<order>:discount` (plus `:rN` in a redo). */
  private resolution(order: string, kind: 'refund' | 'discount'): Promise<unknown> {
    const journaled = (this.state.get(order)?.stages.get('payment')?.effects.get('charge')?.payload as { amount?: unknown } | undefined)?.amount;
    const charge = this.charged.get(order) ?? (typeof journaled === 'number' ? journaled : 0);
    const amount = kind === 'refund' ? charge : Math.round(charge / 5);
    const key = this.use.has('idempotency') ? `${order}:${kind}${this.suffix()}` : undefined;
    return this.effect(order, RESOLUTION_STAGE, kind, { ...(key !== undefined ? { key } : {}), body: { amount } }, { replayed: 0, ran: 0 });
  }

  private async reconcile(order: string, stage: string, kind: string, key: string): Promise<Record<string, unknown> | undefined> {
    const { host } = this.o;
    this.ev('recover_start', order, stage, { action: 'reconcile' });
    await host.hook('during_reconcile', { order, stage });
    const r = await this.o.transport.lookup(kind, key);
    if (!r.found || !r.row) {
      this.ev('recover_done', order, stage, { action: 'reexecute' });
      return undefined;
    }
    host.emit({ k: 'reconciled', kind, key });
    this.ev('recover_done', order, stage, { action: 'reconciled' });
    const row = r.row;
    const payload: Record<string, unknown> = { id: row.id };
    if (kind === 'charge' || kind === 'refund' || kind === 'discount') payload.amount = row.amount;
    if (kind === 'notify' || kind === 'store') payload.index = row.index;
    return payload;
  }

  /** Retry (3 attempts, fixed 500 ms) or breaker (5 attempts, backoff, circuit). runtime.md section 7. */
  private async call(order: string, stage: string, kind: string, body: Record<string, unknown>, key: string | null, recovery: boolean): Promise<unknown> {
    const { host } = this.o;
    const breaker = this.use.has('breaker');
    const max = breaker ? BREAKER.attempts : this.use.has('retry') ? RETRY.attempts : 1;
    for (let attempt = 1; ; attempt++) {
      if (breaker) this.checkBreaker(kind);
      let err: CallError;
      try {
        const res = await this.o.transport.post(kind, body, { key, recovery });
        if (res.status >= 200 && res.status < 300) {
          if (breaker) this.breakerFor(kind).fails = 0;
          return res.body;
        }
        const ra = res.headers['Retry-After'] ?? res.headers['retry-after'];
        err = new CallError(res.status, ra !== undefined && Number.isFinite(Number(ra)) ? Number(ra) * 1000 : null, `${kind} returned ${res.status}`);
      } catch (e) {
        err = new CallError(null, null, `${kind} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (breaker) this.noteFailure(kind);
      this.ev('stage_fail', order, stage, { attempt, status: err.status });
      if (attempt >= max) throw err;
      if (breaker && this.use.has('offline_queue') && this.isOpen(kind)) throw new ParkSignal('breaker_open');
      const delay = breaker ? Math.max(BREAKER.baseMs * 2 ** (attempt - 1), err.retryAfterMs ?? 0) : RETRY.delayMs;
      recovery = true;
      this.ev('recover_start', order, stage, { action: breaker ? 'backoff' : 'retry', attempt });
      await host.hook('during_backoff', { order, stage });
      await host.sleep(delay);
      this.ev('recover_done', order, stage, { action: breaker ? 'backoff' : 'retry', attempt });
    }
  }

  private breakerFor(service: string): BreakerState {
    let b = this.breakers.get(service);
    if (!b) this.breakers.set(service, (b = { fails: 0, openUntil: null }));
    return b;
  }

  noteSuccess(service: string): void {
    this.breakerFor(service).fails = 0;
  }

  private isOpen(service: string): boolean {
    const b = this.breakerFor(service);
    return b.openUntil !== null && this.o.host.now() < b.openUntil;
  }

  /** Open: do not call (park or fail). After the open time one probe goes through (half-open). */
  private checkBreaker(service: string): void {
    const b = this.breakerFor(service);
    if (b.openUntil === null) return;
    if (this.o.host.now() < b.openUntil) {
      if (this.use.has('offline_queue')) throw new ParkSignal('breaker_open');
      throw new CallError(null, null, `breaker open for ${service}`);
    }
    b.openUntil = null;
    b.fails = BREAKER.openAfter - 1; // one more failure re-opens it
    this.o.host.emit({ type: 'breaker', order: this.order_, detail: { service, state: 'half_open' } });
  }

  /** Counts a failed call against the service breaker (also used for transit polls, which sit outside effect()). */
  noteFailure(service: string): void {
    const b = this.breakerFor(service);
    b.fails++;
    if (b.fails >= BREAKER.openAfter && b.openUntil === null) {
      b.openUntil = this.o.host.now() + BREAKER.openMs;
      this.o.host.emit({ type: 'breaker', order: this.order_, detail: { service, state: 'open' } });
    }
  }

  private endReplay(order: string, stage: string): void {
    if (!this.replaying) return;
    this.replaying = false;
    this.ev('recover_done', order, stage, { action: 'replay' });
  }

  private write(rec: JournalRecord): void {
    if (!this.journal) return;
    try {
      this.journal.append(rec);
    } catch (e) {
      if (!(e instanceof JournalWriteError)) throw e;
      // `journal` retries a failed write once (covers disk_full).
      this.o.host.emit({ k: 'absorbed', reason: 'journal write retried' });
      this.journal.append(rec);
    }
    applyRecord(this.state, rec);
  }

  private ev(type: string, order: string, stage?: string, detail?: Record<string, unknown>): void {
    const msg: Record<string, unknown> = { type, order };
    if (stage !== undefined) msg.stage = stage;
    if (detail !== undefined) msg.detail = detail;
    this.o.host.emit(msg);
  }

  private need(): string {
    if (this.order_ === null) throw new Error('stage() called outside order()');
    return this.order_;
  }
}

export class StageCtx {
  private seen = { replayed: 0, ran: 0 };

  constructor(private readonly sdk: Sdk, readonly order: string, readonly stage: string) {}

  /** Idempotency key `<order>:<name>`, with `:rN` after a wrong-order redo. */
  key(name: string): string {
    return `${this.order}:${name}${this.sdk.suffix()}`;
  }

  /** The bot found a wrong order itself (the handoff call). Returns after a discount; refund and redo unwind the order. */
  wrongOrder(detectedAt: DetectedAt): Promise<void> {
    return this.sdk.wrongOrder(this.order, this.stage, detectedAt);
  }

  work(ms: number): Promise<void> {
    return this.sdk.work(this.order, this.stage, ms);
  }

  effect(kind: string, opts: EffectOptions = {}): Promise<unknown> {
    return this.sdk.effect(this.order, this.stage, kind, opts, this.seen);
  }

  /** True when the stage made calls only through the journal (nothing re-ran). */
  onlyReplayed(): boolean {
    return this.seen.replayed > 0 && this.seen.ran === 0;
  }
}
