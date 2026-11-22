// Lane planner: computes every event of one lane for a whole wave, as a pure function of
// (lane config, armed faults). Used by the fixture generator (virtual time) and the mock server
// (real time, re-planned whenever the user presses chaos).
//
// This follows the rules of .kiro/specs/engine/runtime.md (rounds 3 and 4) closely enough that the
// outcomes match acceptance table A. The tests prove it against `outcomes.ts`.
//
// All times are plan time: milliseconds at speed 1x since the lane started.
import {
  APPS, TIERS, TIMING, FAULT_PARAMS, RESTART_MS, RESTART_CAP_MS, creatureForFault, isCrashFault, isBossFault,
  faultApplies, TIER_DECISION_DEFAULT, DECISION_TIMEOUT_MS, gradeFor, capGrade, orderId, unit,
  type AppId, type TierId, type StageDef, type EffectDef, type Grade, type PartId,
} from '@haunt/shared';

export interface LaneCfg {
  lane: number;
  tier: TierId;
  app: AppId;
  seed: number;
  orders: number;
  /** 1 normal, 2 show pace. */
  pace: number;
  /** Progress event cadence in ms (at least every 300 ms by contract). */
  progressMs?: number;
  /** Parts to use instead of the tier's own (the campaign Crew lane). */
  parts?: PartId[];
}

export interface ArmSpec {
  id: string;
  fault: string;
  creature?: string;
  source: 'user' | 'random' | 'boss' | 'demo' | 'sweep' | 'gremlin' | 'fuzz';
  /** A drawn outage window in ms at 1x (TV3-C5). Replaces the fixed window of an `endpoint_down` or service-down fault and adds an `outage` event. */
  outageMs?: number;
  /** Extra fields copied into the `chaos` detail (`unknown`, `fingerprint`, `variant`). */
  extra?: Record<string, unknown>;
  scope?: 'inner' | 'outer';
  point?: string;
  /** order_typo: the stage that finds the wrong order (default confirmation) and the decision (default: tier policy). */
  detect?: 'confirmation' | 'process' | 'transit' | 'handoff';
  choice?: 'refund' | 'discount' | 'redo';
  /** Press time, plan ms since the lane started. */
  at?: number;
  /** Press when a stage starts: `delay` ms after the first stage_start with that attempt number. */
  when?: { order: number; stage: string; attempt?: number; delay: number };
}

export interface PlanEv {
  t: number;
  n: number;
  type: string;
  order?: string;
  stage?: string;
  detail: Record<string, any>;
}

export type ArmStatus = 'ok' | 'lane_not_active' | 'depth_limit';
export interface ArmInfo {
  id: string;
  status: ArmStatus;
  depth: number;
  scope: 'inner' | 'outer';
  injectedAt: string;
  deferred: boolean;
  pressAt?: number;
  settledAt?: number;
  fired: boolean;
}

export interface LaneSummary {
  score: number;
  grade: Grade;
  reliability: number;
  completed: number;
  failed: number;
  parked: number;
  quarantined: number;
  repeats: number;
  halted: boolean;
  lost: number;
  extraCharge: boolean;
}

export interface LanePlan {
  events: PlanEv[];
  arms: Map<string, ArmInfo>;
  endT: number;
  summary: LaneSummary;
}

type StageRes =
  | { k: 'done' }
  | { k: 'degraded' }
  | { k: 'killed'; arm: ArmRt; tk: number }
  | { k: 'fail'; error: string; stage: string }
  | { k: 'park'; reason: string; readyAt?: number; service?: string; stage: string; idx: number }
  | { k: 'quar'; reason: string; stage: string }
  | { k: 'halt'; reason: string }
  | { k: 'resume'; s: number; effFrom: number };

const LOCKS_SERVICE: ReadonlySet<string> = new Set(['endpoint_down', 'sms_down', 'app_down', 'updates_down', 'timeout', 'comm_timeout', 'http_404', 'http_500', 'http_429']);

interface Sub {
  fault: string;
  /** Which calls it matches. */
  match: 'effect' | 'all' | 'tracking' | 'dispatch' | 'handoff';
  mode: 'latency' | 'status' | 'drop' | 'stall' | 'no_driver' | 'slow' | 'handoff_block';
  block?: string;
  count?: number;
  forMs?: number;
  latency?: number;
  status?: number;
  retryAfter?: number;
  used: number;
  start?: number;
  lockedService?: string;
}

interface ArmRt {
  spec: ArmSpec;
  pressAt?: number;
  activated: boolean;
  fired: boolean;
  closed: boolean;
  invalid?: ArmStatus;
  scope: 'inner' | 'outer';
  depth: number;
  point?: string;
  crashKind?: string;
  isCrash: boolean;
  isDup: boolean;
  isInput: boolean;
  isDisk: boolean;
  persistent: boolean;
  subs: Sub[];
  order: number;
  deferred: boolean;
  injectedAt: string;
  settledAt?: number;
  bossFault?: string;
  creature: string;
  paid?: boolean;
}

interface Journal {
  done: Set<number>;
  intent: Set<string>;
  result: Set<string>;
}

interface ParkedItem {
  order: number;
  idx: number;
  kind: 'breaker' | 'file';
  service?: string;
  readyAt?: number;
}

const HTTP_TEXT: Record<number, string> = { 404: 'Not Found', 429: 'Too Many Requests', 500: 'Internal Server Error', 503: 'Service Unavailable' };
const DEAD_REASON: Record<string, string> = { crash: 'process killed (crash)', out_of_memory: 'process killed (out of memory)', power_outage: 'power outage' };

class Planner {
  readonly stages: StageDef[];
  readonly parts: Set<PartId>;
  readonly journalOn: boolean;
  evs: PlanEv[] = [];
  n = 0;
  t = 0;
  score = 0;
  procAttempt = 1;
  workDone = new Set<string>();
  redoN = new Map<string, number>();
  localRun = new Map<string, number>();
  starts = new Map<string, number>();
  rows = new Map<string, number>();
  keyed = new Set<string>();
  extra = new Map<string, number>();
  journals = new Map<string, Journal>();
  arms: ArmRt[];
  depth = 0;
  deaths = 0;
  intervals: [number, number][] = [];
  cur?: { order: string; idx: number; def: StageDef; t0: number };
  curOrder = 0;
  nextFresh = 1;
  parkedQ: ParkedItem[] = [];
  brk = new Map<string, { state: 'closed' | 'open' | 'half_open'; openedAt: number; fails: number }>();
  halted = false;
  callN = 0;
  attacks: number[] = [];
  bossArms: ArmRt[] = [];
  stats = { completed: 0, failed: 0, parked: 0, quarantined: 0, repeats: 0, clean: 0, parkedResumed: 0 };
  orderOutcome = new Map<number, 'done' | 'failed' | 'quarantined' | 'abandoned' | 'parked'>();
  resumedOrders = new Set<number>();

  constructor(readonly cfg: LaneCfg, specs: ArmSpec[]) {
    this.stages = APPS[cfg.app].stages;
    this.parts = new Set(cfg.parts ?? TIERS[cfg.tier].parts);
    this.journalOn = this.parts.has('journal');
    this.arms = specs.map((spec) => this.makeArm(spec));
  }

  // ---------------------------------------------------------------- arms
  private makeArm(spec: ArmSpec): ArmRt {
    const boss = isBossFault(spec.fault);
    const creature = spec.creature ?? creatureForFault(spec.fault)?.id ?? 'reaper';
    let eff = spec.fault;
    if (spec.fault === 'boss_power_outage') eff = 'power_outage';
    const subs: Sub[] = [];
    const p = (f: string): { count?: number; forMs?: number; latency?: number; status?: number; retryAfterMs?: number } => FAULT_PARAMS[f] ?? {};
    const add = (fault: string, match: Sub['match'], mode: Sub['mode'], over: Partial<Sub> = {}): void => {
      const fp = p(fault);
      subs.push({ fault, match, mode, count: fp.count, forMs: fp.forMs, latency: fp.latency, status: fp.status, retryAfter: fp.retryAfterMs, used: 0, ...over });
    };
    switch (spec.fault) {
      case 'timeout': case 'comm_timeout': add(spec.fault, 'effect', 'latency'); break;
      case 'http_404': case 'http_500': case 'http_429': add(spec.fault, 'effect', 'status'); break;
      case 'endpoint_down': case 'sms_down': case 'app_down': case 'updates_down': add(spec.fault, 'effect', 'status', spec.outageMs !== undefined ? { forMs: spec.outageMs } : {}); break;
      case 'internet_outage': add(spec.fault, 'all', 'drop'); break;
      case 'boss_internet_outage': add('internet_outage', 'all', 'drop', { forMs: 12000 }); break;
      case 'slow_link': add(spec.fault, 'all', 'slow'); break;
      case 'hazard_event': add(spec.fault, 'tracking', 'stall'); break;
      case 'driver_unreachable': add(spec.fault, 'tracking', 'no_driver'); break;
      case 'wrong_address': case 'weather': case 'road_hazard': case 'delay': case 'out_of_gas': add(spec.fault, 'tracking', 'stall'); break;
      case 'not_on_truck': add(spec.fault, 'tracking', 'no_driver'); break;
      case 'no_answer': add(spec.fault, 'handoff', 'handoff_block', { block: 'no_answer' }); break;
      case 'gated_house': add(spec.fault, 'handoff', 'handoff_block', { block: 'gated' }); break;
      case 'car_accident': add(spec.fault, 'handoff', 'handoff_block', { block: 'accident' }); break;
      case 'boss_hazard_storm':
        add('hazard_event', 'tracking', 'stall', { forMs: 6000 });
        add('http_429', 'dispatch', 'status');
        break;
      default:
    }
    return {
      spec, pressAt: spec.at, activated: false, fired: false, closed: false, scope: spec.scope ?? 'outer', depth: 0, point: spec.point,
      crashKind: isCrashFault(eff) ? eff : undefined, isCrash: isCrashFault(eff), isDup: spec.fault === 'duplicate_request',
      isInput: spec.fault === 'missing_file' || spec.fault === 'malformed_payload', isDisk: spec.fault === 'disk_full',
      persistent: subs.some((s) => s.forMs !== undefined), subs, order: 0, deferred: false, injectedAt: 'during', creature,
      bossFault: boss ? spec.fault : undefined,
    };
  }

  private resolveWhen(order: number, stage: string, attempt: number, t: number): void {
    for (const a of this.arms) {
      const w = a.spec.when;
      if (!w || a.pressAt !== undefined) continue;
      if (w.order === order && w.stage === stage && (w.attempt ?? 1) === attempt) a.pressAt = t + w.delay;
    }
  }

  private inRecovery(t: number): boolean {
    return this.intervals.some(([a, b]) => t >= a && t < b);
  }

  private catchUp(t: number): void {
    for (;;) {
      let next: ArmRt | undefined;
      for (const a of this.arms) {
        if (a.activated || a.pressAt === undefined || a.pressAt > t) continue;
        if (!next || a.pressAt < next.pressAt!) next = a;
      }
      if (!next) return;
      this.activate(next);
    }
  }

  private activate(a: ArmRt): void {
    a.activated = true;
    const press = a.pressAt!;
    if (this.halted || (!this.curOrder && this.nextFresh > this.cfg.orders && this.parkedQ.length === 0)) { a.invalid = 'lane_not_active'; return; }
    if (this.depth >= 5) { a.invalid = 'depth_limit'; return; }
    this.depth++;
    a.depth = this.depth;
    const spec = a.spec;
    a.scope = spec.scope ?? (this.inRecovery(press) ? 'inner' : 'outer');
    const cur = this.cur;
    a.order = this.curOrder || this.nextFresh;
    if (a.isInput) {
      const beforeRead = !!cur && cur.def.role === 'input' && press < cur.t0 + 20;
      a.order = beforeRead ? this.curOrder : (this.curOrder ? this.curOrder + 1 : this.nextFresh);
      a.deferred = !!cur && !beforeRead;
    }
    if (a.isCrash) {
      if (a.bossFault) a.point = cur && cur.def.role === 'effect' ? 'after_effect_before_journal' : 'mid_stage';
      const hasHook = (pt: string): boolean => !cur || (pt === 'mid_stage' ? cur.def.role !== 'effect' : cur.def.role === 'effect');
      a.deferred = a.point ? !hasHook(a.point) : false;
      a.injectedAt = a.scope === 'inner' ? 'recovery' : a.point === 'before_effect' ? 'before' : a.point === 'mid_stage' ? 'during' : a.point ? 'after_effect' : cur && cur.def.role === 'effect' ? 'before' : 'during';
    } else {
      a.injectedAt = a.scope === 'inner' ? 'recovery' : 'during';
      if (!a.isInput && !a.isDup && !a.isDisk && spec.fault !== 'duplicate_request') {
        const role = cur?.def.role;
        a.deferred = role !== undefined && !(a.bossFault === 'boss_hazard_storm' ? role === 'poll' || cur!.def.id === 'ship' : faultApplies(spec.fault === 'boss_internet_outage' ? 'internet_outage' : spec.fault, role));
      }
      if (a.isDup) a.deferred = false;
    }
    const detail: Record<string, any> = {
      creature: a.creature, fault: spec.fault, scope: a.scope, depth: a.depth, injectedAt: a.injectedAt, source: spec.source,
    };
    if (a.point) detail.point = a.point;
    if (a.deferred) detail.deferred = true;
    if (spec.extra) Object.assign(detail, spec.extra);
    this.push(press, 'chaos', undefined, undefined, detail);
    if (spec.outageMs !== undefined) this.push(press, 'outage', undefined, cur?.def.id, { outageMs: spec.outageMs, seed: this.cfg.seed, fault: spec.fault });
    if (this.curOrder) this.attacks.push(a.depth);
    if (a.bossFault) this.bossArms.push(a);
    if (a.isDisk && !this.journalOn) {
      a.closed = true; a.fired = true;
      this.push(press + 30, 'chaos_absorbed', undefined, undefined, { creature: a.creature, fault: spec.fault, reason: 'no journal to write' });
    }
  }

  private hookCrash(hook: string, tHook: number): ArmRt | null {
    this.catchUp(tHook);
    const inner = ['startup', 'during_replay', 'during_backoff', 'during_reconcile'].includes(hook);
    let best: ArmRt | null = null;
    for (const a of this.arms) {
      if (!a.isCrash || !a.activated || a.invalid || a.fired || a.pressAt! > tHook) continue;
      if (inner) { if (a.scope !== 'inner') continue; }
      else { if (a.scope === 'inner') continue; if (a.point && a.point !== hook) continue; }
      if (!best || a.pressAt! < best.pressAt!) best = a;
    }
    return best;
  }

  /** disk_full: the next journal write fails once and is retried. */
  private jw(t: number): void {
    if (!this.journalOn) return;
    this.catchUp(t);
    for (const a of this.arms) {
      if (a.isDisk && a.activated && !a.invalid && !a.fired && a.pressAt! <= t) {
        a.fired = true; a.closed = true;
        this.push(t, 'chaos_absorbed', undefined, undefined, { creature: a.creature, fault: a.spec.fault, reason: 'journal write retried' });
      }
    }
  }

  // ---------------------------------------------------------------- events
  private push(t: number, type: string, order: string | undefined, stage: string | undefined, detail: Record<string, any>): void {
    const ev: PlanEv = { t: Math.round(t), n: this.n++, type, detail };
    if (order) ev.order = order;
    if (stage) ev.stage = stage;
    this.evs.push(ev);
  }

  private emit(type: string, order: string | undefined, stage: string | undefined, detail: Record<string, any>, t = this.t): void {
    this.catchUp(t);
    this.push(t, type, order, stage, detail);
  }

  private scoreEv(delta: number, reason: string, t = this.t): void {
    this.score += delta;
    this.emit('score', undefined, undefined, { delta, total: this.score, reason }, t);
  }

  private sleep(order: string, def: StageDef, t0: number, t1: number, p0: number, p1: number, label: string): void {
    const step = this.cfg.progressMs ?? TIMING.progressMs;
    const total = t1 - t0;
    if (total > 0) {
      for (let k = 1; t0 + k * step < t1; k++) {
        const tt = t0 + k * step;
        this.emit('stage_progress', order, def.id, { pct: Math.min(99, Math.round(p0 + ((p1 - p0) * (tt - t0)) / total)), label }, tt);
      }
    }
    this.t = Math.max(this.t, t1);
  }

  private duration(order: string, def: StageDef, run: number): number {
    const u = unit(this.cfg.seed, this.cfg.lane, order, def.id, this.procAttempt, run);
    return (def.min + u * (def.max - def.min)) * this.cfg.pace;
  }

  private latency(order: string, service: string): number {
    return Math.round(TIMING.latencyMin + unit(this.cfg.seed, this.cfg.lane, order, service, 'lat', this.callN++) * (TIMING.latencyMax - TIMING.latencyMin));
  }

  private jOf(order: string): Journal {
    let j = this.journals.get(order);
    if (!j) { j = { done: new Set(), intent: new Set(), result: new Set() }; this.journals.set(order, j); }
    return j;
  }

  // ---------------------------------------------------------------- provider
  private matchSub(service: string, role: 'effect' | 'poll', recovery: boolean, t: number): { arm: ArmRt; sub: Sub } | null {
    this.catchUp(t);
    for (const arm of [...this.arms].sort((x, y) => (x.pressAt ?? 0) - (y.pressAt ?? 0))) {
      if (!arm.activated || arm.invalid || arm.pressAt! > t) continue;
      for (const sub of arm.subs) {
        if (sub.match === 'effect' && role !== 'effect') continue;
        if (sub.match === 'tracking' && service !== 'tracking') continue;
        if (sub.match === 'dispatch' && service !== 'dispatch') continue;
        if ((sub.match === 'handoff') !== (service === 'handoff')) continue;
        if (arm.scope === 'inner' && !recovery) continue;
        if (sub.lockedService && sub.lockedService !== service) continue;
        if (sub.count !== undefined) { if (sub.used >= sub.count) continue; }
        else if (sub.forMs !== undefined && sub.start !== undefined && t >= sub.start + sub.forMs) continue;
        // The provider arms a fault on the service of the stage it was pressed at, so a count fault that is only partly used in a
        // non-critical stage (updates) cannot spill into the next stage's service.
        if (LOCKS_SERVICE.has(sub.fault) && !sub.lockedService) sub.lockedService = service;
        if (sub.forMs !== undefined && sub.start === undefined) sub.start = t;
        sub.used++;
        arm.fired = true;
        return { arm, sub };
      }
    }
    return null;
  }

  /** One provider call. Returns how it went and when the client sees the answer. */
  private providerCall(order: string, service: string, role: 'effect' | 'poll', recovery: boolean, callT: number): { ok: boolean; processed: boolean; respMs: number; writeMs: number; error: string; retryAfter: number; arm?: ArmRt; slow?: boolean } {
    const lat = this.latency(order, service);
    const m = this.matchSub(service, role, recovery, callT);
    if (!m) return { ok: true, processed: true, respMs: lat, writeMs: lat, error: '', retryAfter: 0 };
    const { arm, sub } = m;
    switch (sub.mode) {
      case 'status':
        return { ok: false, processed: false, respMs: lat, writeMs: lat, error: `HTTP ${sub.status} ${HTTP_TEXT[sub.status!] ?? ''}`.trim(), retryAfter: sub.retryAfter ?? 0, arm };
      case 'latency':
        return { ok: false, processed: true, respMs: TIMING.clientTimeoutMs, writeMs: lat, error: `timeout after ${TIMING.clientTimeoutMs} ms`, retryAfter: 0, arm };
      case 'drop':
        return { ok: false, processed: false, respMs: lat, writeMs: lat, error: 'connection dropped', retryAfter: 0, arm };
      case 'stall':
        return { ok: false, processed: false, respMs: TIMING.pollTimeoutMs, writeMs: lat, error: `poll timeout after ${TIMING.pollTimeoutMs} ms`, retryAfter: 0, arm };
      case 'handoff_block':
        return { ok: false, processed: false, respMs: lat, writeMs: lat, error: `handoff blocked: ${sub.block ?? 'no_answer'}`, retryAfter: 0, arm };
      case 'no_driver':
        return { ok: false, processed: false, respMs: lat, writeMs: lat, error: 'no driver available', retryAfter: 0, arm };
      case 'slow':
        return { ok: true, processed: true, respMs: lat + (sub.latency ?? 600), writeMs: lat + (sub.latency ?? 600), error: '', retryAfter: 0, arm, slow: true };
      default:
        return { ok: true, processed: true, respMs: lat, writeMs: lat, error: '', retryAfter: 0 };
    }
  }

  /** True while an activated arm carries a handoff block (the handoff call only exists then, so other runs are unchanged). */
  private handoffArmed(): boolean {
    return this.arms.some((a) => a.activated && !a.invalid && a.subs.some((s) => s.match === 'handoff'));
  }

  private brkSync(service: string, t: number): 'closed' | 'open' | 'half_open' {
    const b = this.brk.get(service);
    if (!b) return 'closed';
    if (b.state === 'open' && t >= b.openedAt + TIMING.breakerOpenMs) {
      b.state = 'half_open';
      this.push(b.openedAt + TIMING.breakerOpenMs, 'breaker', undefined, undefined, { service, state: 'half_open' });
    }
    return b.state;
  }

  private brkOpen(service: string, t: number): void {
    const b = this.brk.get(service) ?? { state: 'closed' as const, openedAt: 0, fails: 0 };
    b.state = 'open'; b.openedAt = t; b.fails = 0;
    this.brk.set(service, b);
    this.emit('breaker', undefined, undefined, { service, state: 'open' }, t);
  }

  // ---------------------------------------------------------------- effects
  /** Key suffix of a redone order (':r1', ':r2'), empty for the first run. */
  private sfx(order: string): string {
    const n = this.redoN.get(order) ?? 0;
    return n > 0 ? `:r${n}` : '';
  }

  /** The armed order_typo that finds the wrong order at stage `s` of order `i`, if any. */
  private typoPending(i: number, s: number): ArmRt | undefined {
    this.catchUp(this.t);
    return this.arms.find((a) => a.spec.fault === 'order_typo' && a.activated && !a.invalid && !a.fired && !a.deferred && a.order === i
      && this.stages[s].id === (a.spec.detect ?? 'confirmation'));
  }

  /** Wrong-order decision flow (design section 8, contract V1_1 section 7). */
  private wrongOrder(i: number, order: string, s: number, a: ArmRt): 'continue' | 'redo' | 'cancelled' {
    a.fired = true; a.closed = true;
    const def = this.stages[s];
    const choice = a.spec.choice ?? TIER_DECISION_DEFAULT[this.cfg.tier] ?? 'refund';
    const sk = `${order}|${def.id}`;
    const attempt = (this.starts.get(sk) ?? 0) + 1;
    this.starts.set(sk, attempt);
    this.emit('stage_start', order, def.id, { attempt });
    this.t += 700;
    this.emit('stage_fail', order, def.id, { error: 'wrong_order', retryable: false, attempt });
    this.emit('decision_needed', order, undefined, { order, kind: 'wrong_order', detectedAt: def.id, options: ['refund', 'discount', 'redo'], defaultChoice: choice, timeoutMs: DECISION_TIMEOUT_MS });
    this.t += DECISION_TIMEOUT_MS / this.cfg.pace;
    this.emit('decision_made', order, undefined, { order, choice, source: 'timeout' });
    const refund = (): void => {
      this.t += 150;
      this.emit('effect', order, undefined, { kind: 'refund', key: `${order}:refund${this.sfx(order)}`, replayed: false, amount: 1200 + Math.floor(unit(this.cfg.seed, 'amount', order) * 8800) });
      this.t += 150;
    };
    if (choice === 'refund') {
      refund();
      this.scoreEv(-150, 'refund');
      this.emit('order_failed', order, undefined, { stage: def.id, error: 'wrong_order', outcome: 'cancelled', reason: 'refunded' });
      this.stats.failed++;
      this.orderOutcome.set(i, 'failed');
      return 'cancelled';
    }
    if (choice === 'discount') {
      this.t += 150;
      this.emit('effect', order, undefined, { kind: 'discount', key: `${order}:discount${this.sfx(order)}`, replayed: false, amount: 600 });
      this.t += 150;
      this.scoreEv(-60, 'discount');
      this.extra.set(order, (this.extra.get(order) ?? 0) + 1);
      for (const e of def.effects) this.recordEffect(order, e, this.t, false);
      this.finishStage(order, def, this.t - 1000, false);
      return 'continue';
    }
    refund();
    this.redoN.set(order, (this.redoN.get(order) ?? 0) + 1);
    for (const k of [...this.workDone]) if (k.startsWith(`${order}|`)) this.workDone.delete(k);
    for (const k of [...this.starts.keys()]) if (k.startsWith(`${order}|`)) this.starts.delete(k);
    for (const k of [...this.localRun.keys()]) if (k.startsWith(`${order}|`)) this.localRun.delete(k);
    this.journals.delete(order);
    this.t += 300;
    this.emit('order_start', order, undefined, { index: i, total: this.cfg.orders, redo: true });
    return 'redo';
  }

  private recordEffect(order: string, e: EffectDef, writeT: number, replayed: boolean): void {
    const full = `${order}:${e.key}${this.sfx(order)}`;
    const rk = `${order}|${e.key}${this.sfx(order)}`;
    const useKey = this.parts.has('idempotency');
    let isReplay = false;
    if (replayed || (useKey && this.keyed.has(rk))) isReplay = true;
    const detail: Record<string, any> = { kind: e.kind, key: full, replayed: isReplay };
    if (e.kind === 'charge') detail.amount = 1200 + Math.floor(unit(this.cfg.seed, 'amount', order) * 8800);
    this.emit('effect', order, undefined, detail, writeT);
    if (!isReplay) {
      const rows = (this.rows.get(rk) ?? 0) + 1;
      this.rows.set(rk, rows);
      if (useKey) this.keyed.add(rk);
      if (rows > 1) {
        this.extra.set(order, (this.extra.get(order) ?? 0) + 1);
        this.stats.repeats++;
        this.emit('repeat', order, undefined, { kind: e.kind, key: full, count: rows }, writeT);
        this.scoreEv(-150, `duplicate ${e.kind}`, writeT);
      }
    }
  }

  /**
   * Failure policy of the tier after a failed call or poll (runtime.md sections 7 and 28).
   * Returns 'retry' after emitting stage_fail, recover_start and recover_done, or a terminal result.
   */
  private afterFailure(order: string, def: StageDef, service: string, attemptNo: number, error: string, retryAfter: number, blocked = false): 'retry' | StageRes {
    const degradable = def.id === 'updates';
    const hasRetry = this.parts.has('retry');
    const hasBreaker = this.parts.has('breaker');
    const maxAttempts = hasBreaker ? TIMING.breakerAttempts : TIMING.retryAttempts;
    let terminal: 'fail' | 'park' | null = null;
    let opened = false;
    if (blocked) terminal = 'park';
    else if (hasBreaker) {
      const b = this.brk.get(service) ?? { state: 'closed' as const, openedAt: 0, fails: 0 };
      this.brk.set(service, b);
      b.fails++;
      if (b.state === 'half_open' || b.fails >= TIMING.breakerFailures) { terminal = 'park'; opened = true; }
      else if (attemptNo >= maxAttempts) terminal = 'fail';
    } else if (!hasRetry || attemptNo >= maxAttempts) terminal = 'fail';

    if (terminal) {
      const degraded = degradable;
      this.emit('stage_fail', order, def.id, { error, retryable: true, attempt: attemptNo, ...(degraded ? { degraded: true } : {}) });
      if (opened) this.brkOpen(service, this.t);
      if (degraded) { this.cur = undefined; return { k: 'degraded' }; }
      if (terminal === 'park') return { k: 'park', reason: blocked ? 'circuit open' : 'breaker open', service, stage: def.id, idx: this.stages.indexOf(def) };
      return { k: 'fail', error, stage: def.id };
    }
    this.emit('stage_fail', order, def.id, { error, retryable: true, attempt: attemptNo });
    const wait = hasBreaker ? Math.max(TIMING.backoffBaseMs * 2 ** (attemptNo - 1), retryAfter) : TIMING.retryDelayMs;
    const action = hasBreaker ? 'backoff' : 'retry';
    const t0 = this.t;
    this.emit('recover_start', undefined, undefined, { action, depth: this.depth });
    this.intervals.push([t0, t0 + wait]);
    const arm = this.hookCrash('during_backoff', t0 + wait - 1);
    if (arm) {
      const tk = Math.max(arm.pressAt!, t0 + 1);
      this.sleep(order, def, t0, tk, 90, 90, 'Waiting to retry');
      return this.kill(arm, tk);
    }
    this.sleep(order, def, t0, t0 + wait, 90, 90, 'Waiting to retry');
    this.t = t0 + wait;
    this.emit('recover_done', undefined, undefined, { action, ms: wait, depth: this.depth });
    return 'retry';
  }

  private kill(arm: ArmRt, tk: number): StageRes {
    arm.fired = true; arm.closed = true;
    this.t = tk;
    return { k: 'killed', arm, tk };
  }

  /** One effect with the tier's retry, backoff and breaker policy. `lookup` first checks the provider by key (reconcile). */
  private callEffect(order: string, def: StageDef, e: EffectDef, lookup: boolean): { k: 'ok' } | StageRes {
    const rk = `${order}|${e.key}${this.sfx(order)}`;
    let attemptNo = 1;
    for (;;) {
      const callT = this.t;
      if (this.parts.has('breaker')) {
        const st = this.brkSync(e.service, callT);
        if (st === 'open') {
          const r = this.afterFailure(order, def, e.service, attemptNo, 'circuit open', 0, true);
          if (r === 'retry') { attemptNo++; continue; }
          return r;
        }
      }
      if (lookup) {
        this.emit('recover_start', undefined, undefined, { action: 'reconcile', depth: this.depth });
        this.intervals.push([callT, callT + 400]);
        const k = this.hookCrash('during_reconcile', callT + 5);
        if (k) return this.kill(k, Math.max(callT + 5, k.pressAt!));
      }
      const res = this.providerCall(order, e.service, 'effect', attemptNo > 1 || lookup, callT);
      const respT = callT + res.respMs;
      if (!res.ok) {
        if (res.processed && !lookup) this.recordEffect(order, e, callT + res.writeMs, false);
        this.sleep(order, def, callT, respT, 60, 90, def.verb);
        this.t = respT;
        if (lookup) this.emit('recover_done', undefined, undefined, { action: 'reconcile', ms: Math.round(res.respMs), depth: this.depth });
        const r = this.afterFailure(order, def, e.service, attemptNo, res.error, res.retryAfter);
        if (r === 'retry') { attemptNo++; continue; }
        return r;
      }
      this.sleep(order, def, callT, respT, 60, 90, def.verb);
      this.t = respT;
      if (lookup) {
        const exists = this.keyed.has(rk);
        if (exists) this.recordEffect(order, e, callT + 30, true);
        else this.recordEffect(order, e, respT, false);
        this.emit('recover_done', undefined, undefined, { action: 'reconcile', ms: Math.round(res.respMs), depth: this.depth });
      } else {
        this.recordEffect(order, e, callT + res.writeMs, false);
      }
      if (res.slow && res.arm && !res.arm.closed) {
        res.arm.closed = true;
        this.emit('chaos_absorbed', undefined, undefined, { creature: res.arm.creature, fault: res.arm.spec.fault, reason: 'slow link under the timeout' });
      }
      if (this.parts.has('breaker')) {
        const b = this.brk.get(e.service);
        if (b) {
          const was = b.state;
          b.fails = 0;
          if (was === 'half_open') { b.state = 'closed'; this.emit('breaker', undefined, undefined, { service: e.service, state: 'closed' }); }
        }
      }
      return { k: 'ok' };
    }
  }

  // ---------------------------------------------------------------- stages
  private finishStage(order: string, def: StageDef, t0: number, reconciled: boolean): StageRes {
    this.t += TIMING.journalWriteMs;
    this.jw(this.t);
    const idx = this.stages.indexOf(def);
    if (this.journalOn) this.jOf(order).done.add(idx);
    this.emit('stage_done', order, def.id, { ms: Math.round(this.t - t0), skipped: false, ...(reconciled ? { reconciled: true } : {}) });
    this.cur = undefined;
    this.depth = 0; this.deaths = 0;
    return { k: 'done' };
  }

  private work(order: string, def: StageDef, D: number, mid: boolean, p1: number): StageRes | null {
    const sk = `${order}|${def.id}`;
    if (this.workDone.has(sk)) return null;
    const t0 = this.t;
    if (mid) {
      const tm = t0 + D / 2;
      this.sleep(order, def, t0, tm, 0, p1 / 2, def.verb);
      const a = this.hookCrash('mid_stage', tm);
      if (a) return this.kill(a, tm);
      this.sleep(order, def, tm, t0 + D, p1 / 2, p1, def.verb);
    } else {
      this.sleep(order, def, t0, t0 + D, 0, p1, def.verb);
    }
    this.workDone.add(sk);
    return null;
  }

  private execStage(order: string, idx: number, o: { effFrom?: number; reconcile?: boolean } = {}): StageRes {
    const def = this.stages[idx];
    const sk = `${order}|${def.id}`;
    const attempt = (this.starts.get(sk) ?? 0) + 1;
    this.starts.set(sk, attempt);
    this.emit('stage_start', order, def.id, { attempt });
    const t0 = this.t;
    this.cur = { order, idx, def, t0 };
    this.resolveWhen(this.curOrder, def.id, attempt, t0);
    this.jw(t0);
    const run = (this.localRun.get(sk) ?? 0) + 1;
    this.localRun.set(sk, run);
    const D = this.duration(order, def, run);

    if (def.role === 'input') {
      this.t = t0 + 20;
      this.catchUp(this.t);
      const arm = this.arms.find((a) => a.isInput && a.activated && !a.invalid && !a.fired && a.pressAt! <= this.t && a.order <= this.curOrder);
      if (arm) {
        arm.fired = true; arm.closed = true;
        const missing = arm.spec.fault === 'missing_file';
        const error = missing ? `ENOENT: no such file or directory, open 'orders/${order}.json'` : 'SyntaxError: Unexpected end of JSON input';
        this.emit('stage_fail', order, def.id, { error, retryable: false, attempt: 1 });
        if (!this.parts.has('retry')) return { k: 'halt', reason: missing ? 'unhandled ENOENT reading the input file' : 'unhandled JSON parse error in the input file' };
        if (!this.parts.has('offline_queue')) return { k: 'fail', error, stage: def.id };
        if (missing) return { k: 'park', reason: 'input file missing', readyAt: this.t + 6000 + 500, stage: def.id, idx };
        return { k: 'quar', reason: 'malformed payload', stage: def.id };
      }
      const r = this.work(order, def, D, true, 100);
      if (r) return r;
      return this.finishStage(order, def, t0, false);
    }

    if (def.role === 'effect') {
      if (!o.reconcile) {
        const r = this.work(order, def, D, false, 60);
        if (r) return r;
      }
      let ei = o.effFrom ?? 0;
      for (; ei < def.effects.length; ei++) {
        const e = def.effects[ei];
        let a = this.hookCrash('before_effect', this.t);
        if (a) return this.kill(a, this.t);
        this.jw(this.t);
        if (this.journalOn) this.jOf(order).intent.add(`${idx}:${ei}`);
        const res = this.callEffect(order, def, e, !!o.reconcile && ei === (o.effFrom ?? 0));
        if (res.k !== 'ok') return res;
        const tr = this.t + 3;
        a = this.hookCrash('after_effect_before_journal', tr);
        if (a) return this.kill(a, tr);
        this.t = tr + TIMING.journalWriteMs;
        this.jw(this.t);
        if (this.journalOn) this.jOf(order).result.add(`${idx}:${ei}`);
        a = this.hookCrash('after_journal', this.t + 2);
        if (a) return this.kill(a, this.t + 2);
      }
      return this.finishStage(order, def, t0, !!o.reconcile);
    }

    if (def.role === 'poll') {
      let delivered = 0;
      let attemptNo = 1;
      let midDone = false;
      for (;;) {
        const pollT = this.t;
        if (!midDone && pollT >= t0 + D / 2) {
          midDone = true;
          const a = this.hookCrash('mid_stage', pollT);
          if (a) return this.kill(a, pollT);
        }
        const res = this.providerCall(order, 'tracking', 'poll', attemptNo > 1, pollT);
        if (!res.ok) {
          this.sleep(order, def, pollT, pollT + res.respMs, 0, 0, 'Polling');
          this.t = pollT + res.respMs;
          const r = this.afterFailure(order, def, 'tracking', attemptNo, res.error, 0);
          if (r === 'retry') { attemptNo++; continue; }
          return r;
        }
        delivered++;
        this.t = pollT + res.respMs;
        const pct = Math.min(99, Math.round(((this.t - t0) / D) * 100));
        this.emit('stage_progress', order, def.id, { pct, label: delivered >= TIMING.deliveredOnPoll ? 'Delivered' : `In transit (poll ${delivered})` });
        if (res.slow && res.arm && !res.arm.closed) {
          res.arm.closed = true;
          this.emit('chaos_absorbed', undefined, undefined, { creature: res.arm.creature, fault: res.arm.spec.fault, reason: 'slow link under the timeout' });
        }
        if (delivered >= TIMING.deliveredOnPoll) {
          if (!midDone) { midDone = true; }
          if (this.t < t0 + D) this.sleep(order, def, this.t, t0 + D, pct, 99, 'Delivered');
          break;
        }
        this.t = Math.max(this.t, pollT + TIMING.pollIntervalMs);
      }
      return this.finishStage(order, def, t0, false);
    }

    // work and final
    const r = this.work(order, def, D, true, 100);
    if (r) return r;
    if (def.role === 'final' && this.handoffArmed()) {
      let attemptNo = 1;
      for (;;) {
        const callT = this.t;
        const res = this.providerCall(order, 'handoff', 'poll', attemptNo > 1, callT);
        this.t = callT + res.respMs;
        if (res.ok) break;
        this.sleep(order, def, callT, this.t, 100, 100, 'Handing off');
        const f = this.afterFailure(order, def, 'handoff', attemptNo, res.error, 0);
        if (f === 'retry') { attemptNo++; continue; }
        return f;
      }
    }
    return this.finishStage(order, def, t0, false);
  }

  // ---------------------------------------------------------------- recovery
  /** Emits the death, restart and recovery of a killed process. Returns where the order continues. */
  private afterKill(order: string, first: Extract<StageRes, { k: 'killed' }>): StageRes {
    let { arm, tk } = first;
    for (;;) {
      this.deaths++;
      const base = arm.crashKind ?? 'crash';
      const delay = Math.min(RESTART_CAP_MS, (RESTART_MS[base] ?? 1000) * 2 ** (this.deaths - 1));
      this.emit('process_dead', undefined, undefined, { reason: DEAD_REASON[base] ?? 'killed', restartInMs: delay }, tk);
      this.intervals.push([tk, tk + delay + 400]);
      this.cur = undefined;
      this.t = tk + delay;
      this.procAttempt++;
      this.workDone.clear(); this.localRun.clear();
      this.depth = 0;
      this.emit('process_up', undefined, undefined, { attempt: this.procAttempt });
      if (!this.journalOn) {
        const b = this.hookCrash('startup', this.t + 5);
        if (b) { b.fired = true; b.closed = true; arm = b; tk = this.t + 5; continue; }
        this.emit('recover_start', undefined, undefined, { action: 'restart', depth: this.depth });
        this.t += 20;
        this.emit('recover_done', undefined, undefined, { action: 'restart', ms: 20, depth: this.depth });
        return { k: 'resume', s: 0, effFrom: 0 };
      }
      this.emit('recover_start', undefined, undefined, { action: 'replay', depth: this.depth });
      const b = this.hookCrash('during_replay', this.t + 5);
      if (b) { b.fired = true; b.closed = true; arm = b; tk = this.t + 5; continue; }
      // Where does the order resume? First stage whose effects are not all journaled.
      const j = this.jOf(order);
      let s = 0;
      const stageDone = (i: number): boolean => j.done.has(i) || (this.stages[i].effects.length > 0 && this.stages[i].effects.every((_, ei) => j.result.has(`${i}:${ei}`)));
      while (s < this.stages.length && stageDone(s)) s++;
      for (let i = 0; i < s; i++) {
        const sk = `${order}|${this.stages[i].id}`;
        const attempt = (this.starts.get(sk) ?? 0) + 1;
        this.starts.set(sk, attempt);
        this.emit('stage_start', order, this.stages[i].id, { attempt });
        this.t += 6;
        this.emit('stage_done', order, this.stages[i].id, { ms: 6, skipped: true });
        this.t += 6;
      }
      let effFrom = 0;
      let pendingIntent = false;
      const def = this.stages[s];
      if (def) {
        while (effFrom < def.effects.length && j.result.has(`${s}:${effFrom}`)) effFrom++;
        pendingIntent = effFrom < def.effects.length && j.intent.has(`${s}:${effFrom}`);
      }
      if (pendingIntent && this.parts.has('idempotency')) {
        const r = this.execStage(order, s, { effFrom, reconcile: true });
        if (r.k === 'killed') { arm = r.arm; tk = r.tk; continue; }
        if (r.k === 'done' || r.k === 'degraded') {
          this.emit('recover_done', undefined, undefined, { action: 'replay', ms: Math.round(this.t - (tk + delay)), depth: this.depth });
          return { k: 'resume', s: s + 1, effFrom: 0 };
        }
        return r;
      }
      this.emit('recover_done', undefined, undefined, { action: 'replay', ms: Math.round(this.t - (tk + delay)), depth: this.depth });
      return { k: 'resume', s, effFrom };
    }
  }

  // ---------------------------------------------------------------- orders
  private expireArms(i: number): void {
    for (const a of this.arms) {
      if (!a.activated || a.invalid || a.closed || a.persistent || a.isDup || a.order > i) continue;
      a.closed = true;
      if (!a.fired) this.emit('chaos_absorbed', undefined, undefined, { creature: a.creature, fault: a.spec.fault, reason: 'fault expired unused' });
      a.fired = true;
    }
    for (const a of this.arms) {
      if (!a.activated || a.invalid || a.order > i) continue;
      // A window fault keeps hitting later orders until its window ends.
      const windowEnd = Math.max(0, ...a.subs.map((s) => (s.start !== undefined && s.forMs !== undefined ? s.start + s.forMs : 0)));
      if (a.persistent) a.settledAt = Math.max(this.t, windowEnd, a.settledAt ?? 0);
      else if (a.settledAt === undefined) a.settledAt = this.t;
    }
  }

  private baseline(order: string): number {
    return this.stages.reduce((sum, def) => sum + (def.min + unit(this.cfg.seed, this.cfg.lane, order, def.id, 1, 1) * (def.max - def.min)) * this.cfg.pace, 0);
  }

  private runOrder(i: number, kind: 'fresh' | 'dup' | 'resume', item?: ParkedItem): void {
    const order = orderId(this.cfg.app, i);
    this.curOrder = i;
    const resumedStage = item ? this.stages[item.idx].id : '';
    if (kind === 'resume') { this.emit('order_resumed', order, undefined, { stage: resumedStage }); this.t += 1; }
    this.emit('order_start', order, undefined, { index: i, total: this.cfg.orders });
    const tStart = this.t;
    if (kind !== 'resume') this.attacks = this.attacks.filter(() => false);
    this.catchUp(this.t);
    let s = kind === 'resume' ? item!.idx : 0;
    let effFrom = 0;
    for (;;) {
      if (kind !== 'resume') {
        const ty = this.typoPending(i, s);
        if (ty) {
          const r = this.wrongOrder(i, order, s, ty);
          if (r === 'redo') { s = 0; effFrom = 0; continue; }
          if (r === 'continue') {
            s++;
            if (s >= this.stages.length) { this.completeOrder(i, order, tStart, kind); return; }
            continue;
          }
          if (r === 'cancelled') {
            this.cur = undefined; this.depth = 0; this.deaths = 0; this.attacks = [];
            this.expireArms(i); this.curOrder = 0;
            return;
          }
        }
      }
      let res: StageRes = this.execStage(order, s, { effFrom });
      effFrom = 0;
      while (res.k === 'killed') res = this.afterKill(order, res);
      if (res.k === 'resume') {
        s = res.s; effFrom = res.effFrom;
        if (s >= this.stages.length) { this.completeOrder(i, order, tStart, kind); return; }
        continue;
      }
      if (res.k === 'done' || res.k === 'degraded') {
        if (this.stages[s].role === 'final' && res.k === 'done') { this.completeOrder(i, order, tStart, kind); return; }
        s++;
        if (s >= this.stages.length) { this.completeOrder(i, order, tStart, kind); return; }
        continue;
      }      switch (res.k) {
        case 'fail':
          this.emit('order_failed', order, undefined, { stage: res.stage, error: res.error });
          this.scoreEv(-50, 'order failed');
          this.stats.failed++;
          this.orderOutcome.set(i, 'failed');
          break;
        case 'park':
          this.emit('order_parked', order, undefined, { stage: res.stage, reason: res.reason });
          this.stats.parked++;
          this.orderOutcome.set(i, 'parked');
          this.parkedQ.push({ order: i, idx: res.idx, kind: res.service ? 'breaker' : 'file', service: res.service, readyAt: res.readyAt });
          break;
        case 'quar':
          this.emit('order_quarantined', order, undefined, { stage: res.stage, reason: res.reason });
          this.scoreEv(30, 'order quarantined');
          this.stats.quarantined++;
          this.orderOutcome.set(i, 'quarantined');
          break;
        case 'halt':
          this.emit('lane_halted', undefined, undefined, { reason: res.reason });
          this.scoreEv(-200, 'lane halted');
          this.halted = true;
          this.orderOutcome.set(i, 'failed');
          for (let k = i + 1; k <= this.cfg.orders; k++) {
            this.t += 1;
            this.emit('order_abandoned', orderId(this.cfg.app, k), undefined, {});
            this.orderOutcome.set(k, 'abandoned');
          }
          break;
        default:
      }
      this.cur = undefined;
      this.depth = 0; this.deaths = 0;
      this.attacks = [];
      this.expireArms(i);
      this.curOrder = 0;
      return;
    }
  }

  private completeOrder(i: number, order: string, tStart: number, kind: 'fresh' | 'dup' | 'resume'): void {
    const extra = this.extra.get(order) ?? 0;
    const clean = extra === 0;
    const ms = Math.round(this.t - tStart);
    this.t += 1;
    this.emit('order_done', order, undefined, { clean, ms, repeats: extra });
    this.stats.completed++;
    if (clean) this.stats.clean++;
    this.orderOutcome.set(i, 'done');
    if (kind === 'resume') { this.stats.parkedResumed++; this.resumedOrders.add(i); }
    this.scoreEv(clean ? 100 : 40, clean ? 'order clean' : 'order with repeats');
    if (clean) {
      for (const d of this.attacks) this.scoreEv(25 * d, `survived depth ${d}`);
      for (const a of this.bossArms) if (a.order === i && !a.paid) { a.paid = true; this.scoreEv(100, 'boss survived'); }
      if (ms <= 1.25 * this.baseline(order) + 600) this.scoreEv(20, 'speed bonus');
      if (kind === 'resume') this.scoreEv(40, 'parked then resumed');
    }
    this.attacks = [];
    // Duplicate requests: a journal skips the copy, a bot with no journal processes it again.
    const dups = this.arms.filter((a) => a.isDup && a.activated && !a.invalid && !a.closed && a.order === i && a.pressAt! <= this.t);
    this.cur = undefined;
    this.depth = 0; this.deaths = 0;
    this.expireArms(i);
    this.curOrder = 0;
    if (kind === 'dup') return;
    for (const a of dups) {
      a.fired = true; a.closed = true;
      if (this.journalOn) {
        this.t += 25;
        this.emit('chaos_absorbed', undefined, undefined, { creature: a.creature, fault: a.spec.fault, reason: 'duplicate skipped by journal' });
      } else {
        this.runOrder(i, 'dup');
        this.emit('chaos_absorbed', undefined, undefined, { creature: a.creature, fault: a.spec.fault, reason: 'processed twice' });
      }
    }
  }

  private resumeReady(item: ParkedItem, drain: boolean): boolean {
    if (item.kind === 'file') {
      if (item.readyAt! <= this.t) return true;
      if (drain) { this.t = item.readyAt!; return true; }
      return false;
    }
    const st = this.brkSync(item.service!, this.t);
    if (st === 'half_open') return true;
    if (st === 'open' && drain) {
      this.t = this.brk.get(item.service!)!.openedAt + TIMING.breakerOpenMs;
      this.brkSync(item.service!, this.t);
      return true;
    }
    return st === 'closed';
  }

  private tryResume(drain: boolean): boolean {
    for (let k = 0; k < this.parkedQ.length; k++) {
      const item = this.parkedQ[k];
      if (this.resumeReady(item, drain)) {
        this.parkedQ.splice(k, 1);
        this.runOrder(item.order, 'resume', item);
        return true;
      }
    }
    return false;
  }

  run(): LanePlan {
    for (let i = 1; i <= this.cfg.orders && !this.halted; i++) {
      this.nextFresh = i;
      while (this.tryResume(false) && !this.halted) { /* resume everything that is ready */ }
      if (this.halted) break;
      this.runOrder(i, 'fresh');
      this.nextFresh = i + 1;
    }
    this.nextFresh = this.cfg.orders + 1;
    while (this.parkedQ.length && !this.halted) {
      if (!this.tryResume(true)) break;
    }
    const endT = this.t;
    for (const a of this.arms) {
      if (!a.activated && a.pressAt !== undefined && a.pressAt <= endT) this.catchUp(a.pressAt);
    }
    for (const a of this.arms) {
      if (a.activated && !a.invalid && !a.closed) {
        a.closed = true;
        if (!a.fired) this.push(endT + 1, 'chaos_absorbed', undefined, undefined, { creature: a.creature, fault: a.spec.fault, reason: a.isDup ? 'duplicate skipped' : 'never fired' });
      }
    }
    this.evs.sort((x, y) => x.t - y.t || x.n - y.n);
    return { events: this.evs, arms: this.armInfo(endT), endT, summary: this.summarize() };
  }

  private armInfo(endT: number): Map<string, ArmInfo> {
    const m = new Map<string, ArmInfo>();
    for (const a of this.arms) {
      const notActive = !a.activated || a.invalid === 'lane_not_active' || (a.pressAt !== undefined && a.pressAt > endT);
      m.set(a.spec.id, {
        id: a.spec.id,
        status: a.invalid ?? (notActive ? 'lane_not_active' : 'ok'),
        depth: a.depth, scope: a.scope, injectedAt: a.injectedAt, deferred: a.deferred, pressAt: a.pressAt, settledAt: a.settledAt, fired: a.fired,
      });
    }
    return m;
  }

  private summarize(): LaneSummary {
    const n = this.cfg.orders;
    const extraRows = [...this.extra.values()].reduce((x, y) => x + y, 0);
    const parkedOk = this.stats.parkedResumed;
    const cleanOnly = this.stats.clean - [...this.resumedOrders].filter((i) => (this.extra.get(orderId(this.cfg.app, i)) ?? 0) === 0).length;
    let reliability = (100 * (cleanOnly + 0.5 * parkedOk + 0.5 * this.stats.quarantined)) / n - 15 * extraRows;
    reliability = Math.max(0, Math.round(reliability * 10) / 10);
    let grade = gradeFor(reliability);
    const chargeRepeat = [...this.rows.entries()].some(([k, v]) => k.endsWith('|charge') && v > 1);
    if (chargeRepeat) grade = capGrade(grade, 'C');
    let lost = 0;
    for (let i = 1; i <= n; i++) {
      const o = orderId(this.cfg.app, i);
      const paid = this.cfg.app === 'orders' ? (this.rows.get(`${o}|charge`) ?? 0) > 0 && (this.rows.get(`${o}|dispatch`) ?? 0) === 0 : (this.rows.get(`${o}|ticket`) ?? 0) > 0 && (this.rows.get(`${o}|reply`) ?? 0) === 0;
      const outcome = this.orderOutcome.get(i);
      if ((outcome === 'failed' || outcome === 'parked') && paid) lost++;
      if (outcome === 'abandoned') lost++;
    }
    if (this.halted || lost > 0) grade = capGrade(grade, 'D');
    return {
      score: this.score, grade, reliability, completed: this.stats.completed, failed: this.stats.failed, parked: this.stats.parked,
      quarantined: this.stats.quarantined, repeats: extraRows, halted: this.halted, lost, extraCharge: chargeRepeat,
    };
  }
}

/** Plans a whole wave for one lane. Pure and deterministic. */
export function planLane(cfg: LaneCfg, arms: ArmSpec[] = []): LanePlan {
  return new Planner(cfg, arms).run();
}
