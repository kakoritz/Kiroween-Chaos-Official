// SDK: order(), stage(), effect(), journal replay and reconcile.
// Semantics: .kiro/specs/engine/runtime.md sections 1, 3, 6, 7, 28 (they win over design.md).
import {
  Journal, JournalWriteError, applyRecord, readJournal, replay,
  type EffectState, type JournalRecord, type JournalState, type OrderOutcome,
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
    this.ev('order_start', id);
    let outcome: OrderOutcome;
    let result: OrderResult;
    try {
      await fn(this);
      outcome = 'done';
      result = 'done';
      this.ev('order_done', id);
    } catch (e) {
      if (e instanceof ProcessKilled) throw e;
      if (e instanceof ParkSignal) {
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
    this.write({ t: 'order_end', order: id, outcome, ts: this.o.host.now() });
    this.order_ = null;
    return result;
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
      return prior.payload;
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
    return payload;
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
    if (kind === 'charge') payload.amount = row.amount;
    if (kind === 'notify') payload.index = row.index;
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

  private noteFailure(service: string): void {
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

  /** Idempotency key `<order>:<name>`. */
  key(name: string): string {
    return `${this.order}:${name}`;
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
