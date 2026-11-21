// Contract v1.1 fixtures (contract/V1_1.md section 11). Lanes come from the lane planner where it can express the
// scenario, and from small scripts where it cannot yet (handoff faults and the wrong-order decision flow belong to
// PT-C7 and PT-C8). Both go through `decorateV11`, which adds travel, laps, reviews and the v1.1 summary.
import { APPS, TIER_ORDER, TIERS, gradeFor, type HauntEvent, type TierId } from '@haunt/shared';
import type { ArmSpec } from './plan';
import { assembleWave, assignSeq, BASE_TS, LANE_START_MS, planWave, type BossSpec, type WaveSpec } from './wave';
import { decorateV11 } from './v11';

const SEED = 7;
const PACE = 2;
const when = (order: number, stage: string, delay: number, attempt = 1): ArmSpec['when'] => ({ order, stage, attempt, delay });
const arm = (id: string, fault: string, extra: Partial<ArmSpec> = {}): ArmSpec => ({ id, fault, source: 'demo', ...extra });

/** Stage durations of a clean order at the show pace (2x of the planner midpoints, rounded). */
const DUR: Record<string, number> = { intake: 1300, account: 1500, payment: 2300, confirmation: 1200, dispatch: 1800, updates: 1200, tracking: 4500, handoff: 900 };
const STAGES = APPS.orders.stages;

interface Raw { t: number; type: string; order?: string; stage?: string; detail: Record<string, any> }

export interface Fail { error: string; afterMs: number; action?: 'retry' | 'backoff'; recoverMs: number; chaos?: { creature: string; fault: string }; retryable?: boolean }

/** One scripted lane. Times are plan ms since the lane started, as the planner uses them. */
export class Script {
  t = 0;
  raw: Raw[] = [];
  score = 0;
  counts = { completed: 0, failed: 0, parked: 0, quarantined: 0, repeats: 0 };
  grade?: string;

  constructor(readonly lane: number, readonly tier: TierId, readonly orders: number) {}

  at(t: number, type: string, detail: Record<string, any>, order?: string, stage?: string): void {
    this.raw.push({ t: Math.round(t), type, ...(order ? { order } : {}), ...(stage ? { stage } : {}), detail });
  }

  sc(delta: number, reason: string): void {
    this.score += delta;
    this.at(this.t, 'score', { delta, total: this.score, reason });
  }

  oid(i: number): string { return `ord-${String(i).padStart(4, '0')}`; }

  start(i: number, extra: Record<string, any> = {}): string {
    const o = this.oid(i);
    this.at(this.t, 'order_start', { index: i, total: this.orders, ...extra }, o);
    return o;
  }

  /** One stage, with optional in-stage failures that recover and continue. `suffix` is the redo key suffix. */
  stage(order: string, id: string, o: { ms?: number; fails?: Fail[]; attempt?: number; suffix?: string; progress?: boolean } = {}): void {
    const def = STAGES.find((s) => s.id === id)!;
    const ms = o.ms ?? DUR[id];
    const t0 = this.t;
    this.at(t0, 'stage_start', { attempt: o.attempt ?? 1 }, order, id);
    const fails = o.fails ?? [];
    let cur = t0;
    const ticks = (from: number, to: number, p0: number, p1: number): void => {
      if (o.progress === false) return;
      for (let k = 1; from + k * 600 < to; k++) this.at(from + k * 600, 'stage_progress', { pct: Math.min(99, Math.round(p0 + ((p1 - p0) * (k * 600)) / (to - from))), label: def.verb }, order, id);
    };
    fails.forEach((f, n) => {
      const failT = t0 + f.afterMs;
      if (n === 0) ticks(cur, failT, 5, 40);
      if (f.chaos) this.at(Math.max(cur + 50, failT - 150), 'chaos', { creature: f.chaos.creature, fault: f.chaos.fault, scope: 'outer', depth: 1, injectedAt: 'during', source: 'demo' });
      this.at(failT, 'stage_fail', { error: f.error, retryable: f.retryable ?? true, attempt: n + 1 }, order, id);
      if (f.retryable === false) { cur = failT; return; }
      const action = f.action ?? 'retry';
      this.at(failT, 'recover_start', { action, depth: 0 });
      this.at(failT + f.recoverMs, 'recover_done', { action, ms: f.recoverMs, depth: 0 });
      cur = failT + f.recoverMs;
    });
    const tail = fails.length ? Math.round(ms * 0.35) : ms;
    const end = cur + tail;
    if (!fails.length) ticks(t0, end, 5, 95); else ticks(cur, end, 50, 95);
    const eff = Math.max(cur, end - 120);
    def.effects.forEach((e, k) => {
      const detail: Record<string, any> = { kind: e.kind, key: `${order}:${e.key}${o.suffix ?? ''}`, replayed: false };
      if (e.kind === 'charge') detail.amount = 5800 + (Number(order.slice(-2)) % 7) * 91;
      this.at(eff + k * 30, 'effect', detail, order);
    });
    this.at(end, 'stage_done', { ms: end - t0, skipped: false }, order, id);
    this.t = end;
  }

  /** The stages of a clean order from `from` up to and including `to`. */
  run(order: string, from = 'intake', to = 'handoff', suffix?: string): void {
    const a = STAGES.findIndex((s) => s.id === from);
    const b = STAGES.findIndex((s) => s.id === to);
    for (let i = a; i <= b; i++) this.stage(order, STAGES[i].id, { suffix });
  }

  done(order: string, clean = true): void {
    this.at(this.t, 'order_done', { clean, ms: 0, repeats: 0 }, order);
    this.counts.completed++;
    if (clean) this.sc(100, 'order clean');
  }

  /** A stage that fails for good and cancels the order (a rookie lane has no way to carry on). */
  cancel(order: string, id: string, f: { error: string; afterMs: number; chaos?: { creature: string; fault: string } }): void {
    const t0 = this.t;
    this.at(t0, 'stage_start', { attempt: 1 }, order, id);
    if (f.chaos) this.at(t0 + Math.max(50, f.afterMs - 150), 'chaos', { creature: f.chaos.creature, fault: f.chaos.fault, scope: 'outer', depth: 1, injectedAt: 'during', source: 'demo' });
    this.at(t0 + f.afterMs, 'stage_fail', { error: f.error, retryable: false, attempt: 1 }, order, id);
    this.t = t0 + f.afterMs;
    this.at(this.t, 'order_failed', { stage: id, error: f.error }, order);
    this.counts.failed++;
    this.sc(-50, 'order failed');
  }

  gap(ms: number): void { this.t += ms; }

  summary(): Record<string, any> {
    const n = this.orders;
    const grade = this.grade ?? gradeFor((100 * this.counts.completed) / n);
    return { score: this.score, grade, ...this.counts };
  }
}

const PRIO: Record<string, number> = { hello: -2, wave_start: -1, lane_ready: 0, boss_warning: 0, boss_start: 0, boss_end: 2, wave_end: 9 };

/** Adds scripted lanes to a planner wave (or builds a whole wave from scripts when `base` is empty). */
function withScripts(base: HauntEvent[], app: 'orders', allTiers: TierId[], scripts: Script[], orders: number): HauntEvent[] {
  const events = base.map((e) => ({ ...e, detail: e.detail ? { ...e.detail } : undefined })) as HauntEvent[];
  if (!events.length) {
    events.push({ seq: 0, ts: BASE_TS, type: 'hello', contractVersion: 1, mode: 'mock', app });
    events.push({ seq: 0, ts: BASE_TS + 100, type: 'wave_start', wave: 1, detail: { orders, seed: SEED, tiers: 'race', lanes: allTiers.length, speed: 1, app, pace: 'show' } });
    events.push({ seq: 0, ts: BASE_TS + 1000, type: 'wave_end', wave: 1, detail: { summary: {} } });
  }
  const ws = events.find((e) => e.type === 'wave_start')!;
  ws.detail = { ...ws.detail, lanes: allTiers.length };
  const we = events.find((e) => e.type === 'wave_end')!;
  const summary: Record<string, any> = { ...(we.detail!.summary as Record<string, any>) };
  let last = we.ts;
  for (const s of scripts) {
    events.push({ seq: 0, ts: BASE_TS + 150 + (s.lane - 1) * 5, type: 'lane_ready', wave: 1, lane: s.lane, detail: { tier: s.tier, label: TIERS[s.tier].label, parts: [...TIERS[s.tier].parts] } });
    for (const r of s.raw) {
      const ev: HauntEvent = { seq: 0, ts: BASE_TS + LANE_START_MS + r.t, type: r.type, wave: 1, lane: s.lane, ...(r.order ? { order: r.order } : {}), ...(r.stage ? { stage: r.stage } : {}), detail: r.detail };
      events.push(ev);
      last = Math.max(last, ev.ts + 500);
    }
    summary[String(s.lane)] = s.summary();
  }
  we.detail = { ...we.detail, summary };
  we.ts = Math.max(we.ts, last);
  const keyed = events.map((e, n) => ({ e, n }));
  keyed.sort((a, b) => a.e.ts - b.e.ts || (PRIO[a.e.type] ?? 1) - (PRIO[b.e.type] ?? 1) || (a.e.lane ?? 0) - (b.e.lane ?? 0) || a.n - b.n);
  return keyed.map((k) => k.e);
}

function plan(spec: Partial<WaveSpec> & { orders: number; tiers: TierId[] }, arms: Record<number, ArmSpec[]> = {}, bosses: BossSpec[] = []): HauntEvent[] {
  const s: WaveSpec = { app: 'orders', seed: SEED, pace: 2, ...spec };
  return assembleWave(planWave(s, arms, bosses), BASE_TS);
}

function rename(events: HauntEvent[], lane: number, from: string, to: string): void {
  for (const e of events) if (e.type === 'chaos' && e.lane === lane && e.detail!.fault === from) e.detail!.fault = to;
}

const finish = (events: HauntEvent[]): HauntEvent[] => assignSeq(decorateV11(events, { pace: PACE }));

// ------------------------------------------------------------------------------------------------ fixtures

/** Two lanes, three orders: 5 stars, then a hiccup (4), then a crash that repeats the charge (2). */
function lapsReviews(): HauntEvent[] {
  const lane = (n: number): ArmSpec[] => [
    arm(`lr-${n}a`, 'http_500', { creature: 'imp', when: when(2, 'payment', 500) }),
    arm(`lr-${n}b`, 'crash', { creature: 'reaper', point: 'after_effect_before_journal', when: when(3, 'payment', 600) }),
  ];
  const base = plan({ orders: 3, tiers: ['retrier', 'phoenix'] }, { 1: lane(1), 2: lane(2) });
  return finish(base);
}

/** An order cancelled after a world fault: 1 star, -300 and -80. Lane 5 (Phoenix) rides the same fault out. */
function cancelled(): HauntEvent[] {
  const fault = (id: string): ArmSpec[] => [arm(id, 'endpoint_down', { creature: 'gargoyle', when: when(2, 'confirmation', 300) })];
  const base = plan({ orders: 3, tiers: ['rookie', 'phoenix'] }, { 1: fault('cx-1'), 2: fault('cx-2') });
  rename(base, 1, 'endpoint_down', 'sms_down');
  rename(base, 2, 'endpoint_down', 'sms_down');
  return finish(base);
}

/** Five lanes, five world faults: sms_down, app_down, wrong_address (planner) and car_accident, no_answer (scripted). */
function worldEvents(): HauntEvent[] {
  const base = plan({ orders: 3, tiers: ['rookie', 'retrier', 'journaler'] }, {
    1: [arm('we-1', 'endpoint_down', { creature: 'gargoyle', when: when(1, 'confirmation', 300) })],
    2: [arm('we-2', 'endpoint_down', { creature: 'imp', when: when(1, 'dispatch', 300) })],
    3: [arm('we-3', 'hazard_event', { creature: 'scarecrow', when: when(1, 'tracking', 300) })],
  });
  rename(base, 1, 'endpoint_down', 'sms_down');
  rename(base, 2, 'endpoint_down', 'app_down');
  rename(base, 3, 'hazard_event', 'wrong_address');

  // Lane 4 (Reconciler): a phantom car blocks the handoff for good on order 1, order 2 and 3 go through.
  const s4 = new Script(4, 'reconciler', 3);
  s4.t = 0;
  const o1 = s4.start(1);
  s4.run(o1, 'intake', 'tracking');
  s4.cancel(o1, 'handoff', { error: 'handoff blocked: accident', afterMs: 1600, chaos: { creature: 'phantom_car', fault: 'car_accident' } });
  for (const i of [2, 3]) { s4.gap(600); const o = s4.start(i); s4.run(o); s4.done(o); }

  // Lane 5 (Phoenix): the black cat hides the door, three attempts fail, the fourth lands.
  const s5 = new Script(5, 'phoenix', 3);
  const p1 = s5.start(1);
  s5.run(p1, 'intake', 'tracking');
  s5.stage(p1, 'handoff', {
    ms: 900,
    fails: [
      { error: 'no_answer', afterMs: 500, action: 'backoff', recoverMs: 500, chaos: { creature: 'black_cat', fault: 'no_answer' } },
      { error: 'no_answer', afterMs: 1200, action: 'backoff', recoverMs: 1000 },
      { error: 'no_answer', afterMs: 2400, action: 'backoff', recoverMs: 2000 },
    ],
  });
  s5.done(p1);
  for (const i of [2, 3]) { s5.gap(600); const o = s5.start(i); s5.run(o); s5.done(o); }
  s5.grade = 'A';
  return finish(withScripts(base, 'orders', ['rookie', 'retrier', 'journaler', 'reconciler', 'phoenix'], [s4, s5], 3));
}

type Choice = 'refund' | 'discount' | 'redo';
const DEFAULT_OF: Record<Choice, TierId> = { refund: 'rookie', discount: 'journaler', redo: 'phoenix' };

/** One lane, two orders. Order 2 is keyed wrong (prankster) and the wrong order is found at `detectedAt`. */
function typo(choice: Choice, detectedAt: 'confirmation' | 'handoff'): HauntEvent[] {
  const tier = DEFAULT_OF[choice];
  const s = new Script(1, tier, 2);
  const o1 = s.start(1);
  s.run(o1); s.done(o1);
  s.gap(600);
  const o = s.start(2);
  s.at(s.t + 300, 'chaos', { creature: 'prankster', fault: 'order_typo', scope: 'outer', depth: 1, injectedAt: 'during', source: 'demo' });
  const upTo = detectedAt === 'confirmation' ? 'payment' : 'tracking';
  s.run(o, 'intake', upTo);
  const stage = detectedAt;
  s.at(s.t, 'stage_start', { attempt: 1 }, o, stage);
  const t0 = s.t;
  const failT = t0 + 700;
  s.at(failT, 'stage_fail', { error: 'wrong_order', retryable: false, attempt: 1 }, o, stage);
  s.at(failT, 'decision_needed', { order: o, kind: 'wrong_order', detectedAt, options: ['refund', 'discount', 'redo'], defaultChoice: choice, timeoutMs: 12000 }, o);
  const madeT = failT + 4200;
  s.at(madeT, 'decision_made', { order: o, choice, source: 'user' }, o);
  s.t = madeT;
  if (choice === 'refund') {
    s.at(s.t + 150, 'effect', { kind: 'refund', key: `${o}:refund`, replayed: false, amount: 5800 }, o);
    s.t += 300;
    s.sc(-150, 'refund');
    s.at(s.t, 'order_failed', { stage, error: 'wrong_order', outcome: 'cancelled', reason: 'refunded' }, o);
    s.counts.failed++;
    s.grade = 'D';
  } else if (choice === 'discount') {
    s.at(s.t + 150, 'effect', { kind: 'discount', key: `${o}:discount`, replayed: false, amount: 600 }, o);
    s.t += 300;
    s.sc(-60, 'discount');
    s.at(s.t + 900, 'stage_done', { ms: s.t + 900 - t0, skipped: false }, o, stage);
    s.t += 900;
    if (stage === 'confirmation') s.run(o, 'dispatch', 'handoff');
    s.at(s.t, 'order_done', { clean: false, ms: 0, repeats: 0 }, o);
    s.counts.completed++;
    s.sc(40, 'order with repeats');
    s.grade = 'B';
  } else {
    s.at(s.t + 150, 'effect', { kind: 'refund', key: `${o}:refund`, replayed: false, amount: 5800 }, o);
    s.t += 600;
    s.at(s.t, 'order_start', { index: 2, total: 2, redo: true }, o);
    s.run(o, 'intake', 'handoff', ':r1');
    s.done(o);
    s.grade = 'A';
  }
  return finish(withScripts([], 'orders', [tier], [s], 2));
}

/** The power boss: the in-flight order completes, +150 and the downtime penalties of that lane come back. */
function bossRecovered(): HauntEvent[] {
  const base = plan({ orders: 4, tiers: TIER_ORDER }, {}, [{ fault: 'boss_power_outage', warnAt: 9000 }]);
  return finish(base);
}

/** A long recovery: backoff after backoff at payment and a slow confirmation, each interval ends with its own penalty. */
function downtime(): HauntEvent[] {
  const s = new Script(1, 'retrier', 2);
  const o1 = s.start(1);
  s.run(o1, 'intake', 'account');
  s.stage(o1, 'payment', {
    ms: 2300,
    fails: [
      { error: 'HTTP 503 Service Unavailable', afterMs: 700, action: 'backoff', recoverMs: 900, chaos: { creature: 'imp', fault: 'http_500' } },
      { error: 'HTTP 503 Service Unavailable', afterMs: 2000, action: 'backoff', recoverMs: 1800 },
      { error: 'HTTP 503 Service Unavailable', afterMs: 4300, action: 'backoff', recoverMs: 3600 },
    ],
  });
  s.stage(o1, 'confirmation', {
    ms: 1200,
    fails: [{ error: 'timeout after 2000 ms', afterMs: 800, action: 'retry', recoverMs: 2400, chaos: { creature: 'zombie', fault: 'timeout' } }],
  });
  s.run(o1, 'dispatch', 'handoff');
  s.done(o1);
  s.gap(600);
  const o2 = s.start(2);
  s.run(o2); s.done(o2);
  const s2 = new Script(2, 'phoenix', 2);
  for (const i of [1, 2]) { const o = s2.start(i); s2.run(o); s2.done(o); s2.gap(600); }
  s2.grade = 'A';
  return finish(withScripts([], 'orders', ['retrier', 'phoenix'], [s, s2], 2));
}

export const V11_FIXTURES: Record<string, () => HauntEvent[]> = {
  'laps-reviews': lapsReviews,
  cancelled,
  'world-events': worldEvents,
  'typo-refund': () => typo('refund', 'confirmation'),
  'typo-discount': () => typo('discount', 'handoff'),
  'typo-redo': () => typo('redo', 'confirmation'),
  'boss-recovered': bossRecovered,
  downtime,
};
