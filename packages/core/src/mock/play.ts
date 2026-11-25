// Playback and chaos simulation for the mock server. Fixture timelines are replayed through the hub with the
// server's own seq and clock. Chaos is a small simulator that follows the outcome table (acceptance table A).
import { BOSS_FAULTS, CREATURES, FAULTS, RESTART_MS, TIMING, creatureForFault, isBossFault, isCrashFault, laneTiers, type AppId, type EffectKind, type HauntEvent, type OutcomeRow } from '@haunt/shared';
import { FIXTURES } from '../sim/fixtures';
import { assembleWave, assignSeq, BASE_TS, planWave } from '../sim/wave';
import type { Hub } from './hub';
import type { OutcomeTable } from './outcomes';

export class MockError extends Error {
  constructor(public status: number, public code: string, message = code) { super(message); }
}

/** Demo script name -> fixture name. Any fixture name is also accepted in mock mode. */
export const DEMO_ALIASES: Record<string, string> = { hero: 'hero-crash' };
export const DEMO_SCRIPTS = ['hero', 'full', 'loop'];

/**
 * Offsets (ms at 1x since the first event) where a recorded demo owes a creature: a recorded fixture can go a minute without
 * a `chaos` event, and the hosted page then shows downtime with nothing on the lanes. One entry per `everyMs` inside every
 * stretch longer than `maxGapMs` (the first is `everyMs` after the last chaos, the run's start counts as one).
 */
export function demoFillerTimes(events: { type: string; ts: number }[], maxGapMs = 3000, everyMs = 2000): number[] {
  if (events.length === 0) return [];
  const t0 = events[0]!.ts;
  const end = events[events.length - 1]!.ts - t0;
  const marks = [0, ...events.filter((e) => e.type === 'chaos' || e.type === 'boss_start').map((e) => e.ts - t0), end];
  const out: number[] = [];
  for (let i = 1; i < marks.length; i++) {
    const a = marks[i - 1]!;
    const b = marks[i]!;
    if (b - a <= maxGapMs) continue;
    for (let t = a + everyMs; t < b - 500; t += everyMs) out.push(t);
  }
  return out;
}

export const fixtureFor = (script: string): string | undefined => {
  const name = DEMO_ALIASES[script] ?? script;
  return name in FIXTURES ? name : undefined;
};

export interface WaveParams { orders: number; seed: number; tiers: 'race' | 'allPhoenix'; lanes: number; pace: 'normal' | 'show' | 'slow'; app: AppId }

/** A scaled wave: the lane planner run with the requested orders, lanes, tiers and pace (no faults). */
export function scaledWave(p: WaveParams): HauntEvent[] {
  const spec = { app: p.app, tiers: laneTiers(p.lanes, p.tiers), tiersMode: p.tiers, orders: p.orders, seed: p.seed, pace: (p.pace === 'normal' ? 1 : 2) as 1 | 2 };
  return assignSeq(assembleWave(planWave(spec), BASE_TS));
}

export class Player {
  private timers = new Set<NodeJS.Timeout>();
  private playing: { stop: () => void } | undefined;

  constructor(private hub: Hub) {}

  after(ms: number, fn: () => void): void {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, Math.max(0, ms));
    this.timers.add(t);
  }

  get active(): boolean { return !!this.playing; }

  /** Replay events (hello dropped) as one wave with the hub's seq and clock. */
  play(events: HauntEvent[], wave: number, params: { speed: number; script?: string }): void {
    this.stop();
    const hub = this.hub;
    hub.speed = params.speed;
    const list = events.filter((e) => e.type !== 'hello' && e.type !== 'reset');
    let i = 0;
    let timer: NodeJS.Timeout | undefined;
    const handle = { stop: () => { if (timer) clearTimeout(timer); this.playing = undefined; } };
    this.playing = handle;
    hub.demoRunning = params.script ?? null;
    const step = (): void => {
      if (i >= list.length) { this.playing = undefined; return; }
      const src = list[i++];
      const e: any = { ...src, wave: src.wave === undefined ? undefined : wave };
      if (e.wave === undefined) delete e.wave;
      if (e.type === 'wave_start') e.detail = { ...e.detail, speed: hub.speed };
      hub.emit(e);
      const gap = i < list.length ? Math.max(0, list[i].ts - src.ts) / hub.speed : 0;
      timer = setTimeout(step, gap);
    };
    step();
  }

  stop(): void {
    this.playing?.stop();
    this.playing = undefined;
  }

  clear(): void {
    this.stop();
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
}

const BOSS_UNDERLYING: Record<string, string> = { boss_power_outage: 'power_outage', boss_internet_outage: 'internet_outage', boss_hazard_storm: 'hazard_event' };

export interface ChaosRequest { lane?: number; creature?: string; fault?: string; scope?: 'inner' | 'outer'; point?: string }

let chaosCounter = 0;

export class ChaosSim {
  constructor(private hub: Hub, private player: Player, private table: OutcomeTable) {}

  /** Validate and run one chaos request. Returns the response body of POST /api/chaos. */
  inject(req: ChaosRequest, source: 'user' | 'random' = 'user'): { chaosId: string; creature: string; fault: string; depth: number; deferred: boolean } {
    const hub = this.hub;
    if (!hub.running) throw new MockError(409, 'no_wave', 'no wave is running');
    if (req.scope !== undefined && req.scope !== 'inner' && req.scope !== 'outer') throw new MockError(400, 'bad_request', 'scope must be inner or outer');
    if (req.creature !== undefined && !CREATURES.some((c) => c.id === req.creature)) throw new MockError(400, 'bad_creature', `unknown creature ${req.creature}`);
    if (req.fault !== undefined && ![...FAULTS, ...BOSS_FAULTS].includes(req.fault as any)) throw new MockError(400, 'bad_fault', `unknown fault ${req.fault}`);
    let fault = req.fault;
    let creature = req.creature;
    if (creature && fault && !CREATURES.find((c) => c.id === creature)!.causes.includes(fault)) throw new MockError(400, 'bad_fault', `${creature} does not cause ${fault}`);
    if (creature && !fault) {
      const causes = CREATURES.find((c) => c.id === creature)!.causes;
      fault = causes[chaosCounter % causes.length];
    }
    if (fault && isBossFault(fault)) return this.boss(fault, req);

    const laneNo = req.lane;
    if (laneNo === undefined || !Number.isInteger(laneNo) || laneNo < 1 || laneNo > 5 || !hub.laneAt(laneNo)) throw new MockError(400, 'bad_lane', 'lane must be a running lane from 1 to 5');
    const lane = hub.laneAt(laneNo)!;
    if (lane.state === 'idle' || lane.state === 'done' || lane.state === 'halted' || !lane.stage || !lane.order) throw new MockError(409, 'lane_not_active', 'lane is not active');
    if (lane.depth >= 5) throw new MockError(409, 'depth_limit', 'max chaos depth is 5');

    const app = hub.app;
    const point = req.point ?? (fault && isCrashFault(fault) ? 'after_effect_before_journal' : undefined);
    if (!fault) {
      const options = FAULTS.filter((f) => this.table.lookup(app, lane.tier as any, f, lane.stage!, isCrashFault(f) ? 'after_effect_before_journal' : undefined) && creatureForFault(f));
      if (options.length === 0) throw new MockError(409, 'not_applicable', 'no fault applies here');
      fault = options[chaosCounter % options.length];
    }
    const row = this.table.lookup(app, lane.tier as any, fault, lane.stage, isCrashFault(fault) ? point : undefined);
    if (!row) throw new MockError(409, 'not_applicable', `${fault} does not apply to ${lane.stage}`);
    creature = creature ?? creatureForFault(fault)!.id;
    const id = `chaos-${++chaosCounter}`;
    const depth = lane.depth + 1;
    this.run(laneNo, row, fault, creature, req.scope ?? 'outer', depth, source, id);
    return { chaosId: id, creature, fault, depth, deferred: false };
  }

  private boss(fault: string, req: ChaosRequest): { chaosId: string; creature: string; fault: string; depth: number; deferred: boolean } {
    const hub = this.hub;
    if (req.lane !== undefined && (!Number.isInteger(req.lane) || req.lane < 1 || req.lane > 5)) throw new MockError(400, 'bad_lane', 'lane must be 1 to 5');
    const creature = creatureForFault(fault)!.id;
    const id = `chaos-${++chaosCounter}`;
    const warn = TIMING.bossWarnMs;
    hub.emit({ type: 'boss_warning', detail: { boss: fault, startsInMs: warn } });
    this.player.after(warn / hub.speed, () => {
      if (!hub.running) return;
      hub.emit({ type: 'boss_start', detail: { boss: fault, durationMs: 3000 } });
      const under = BOSS_UNDERLYING[fault];
      let last = 0;
      for (const lane of hub.lanes.values()) {
        if (lane.state === 'idle' || lane.state === 'done' || lane.state === 'halted' || !lane.stage || lane.depth >= 5) continue;
        const row = this.table.lookup(hub.app, lane.tier as any, under, lane.stage);
        if (!row) continue;
        last = Math.max(last, this.run(lane.lane, row, fault, creature, 'outer', lane.depth + 1, 'boss', `${id}-${lane.lane}`));
      }
      this.player.after((last + 300) / hub.speed, () => { if (hub.running) hub.emit({ type: 'boss_end', detail: { boss: fault } }); });
    });
    return { chaosId: id, creature, fault, depth: 0, deferred: false };
  }

  /** Emit the chaos event and its consequence for one lane. Returns the scripted duration in ms at 1x. */
  private run(laneNo: number, row: OutcomeRow, fault: string, creature: string, scope: string, depth: number, source: string, chaosId: string): number {
    const hub = this.hub;
    const lane = hub.laneAt(laneNo)!;
    const order = lane.order!;
    const stage = lane.stage!;
    const emit = (type: string, detail: Record<string, unknown>, withStage = true): void => {
      hub.emit({ type, wave: hub.wave?.n, lane: laneNo, order, ...(withStage ? { stage } : {}), detail } as any);
    };
    let t = 0;
    const at = (ms: number, fn: () => void): void => { t = Math.max(t, ms); this.player.after(ms / hub.speed, () => { if (hub.running) fn(); }); };
    emit('chaos', { creature, fault, scope, depth, injectedAt: stage, source, chaosId });
    const failDetail = (retryable: boolean, degraded = false) => ({ error: fault, retryable, attempt: 1, ...(degraded ? { degraded: true } : {}) });
    const repeats = (): void => {
      for (const [kind, n] of Object.entries(row.extraRows) as [EffectKind, number][]) {
        const key = `${order}-${kind}`;
        emit('effect', { kind, key, replayed: false });
        emit('repeat', { kind, key, count: 1 + n });
      }
    };
    switch (row.template) {
      case 'T_ABSORBED':
        at(200, () => emit('chaos_absorbed', { creature, fault, reason: 'no visible effect' }));
        break;
      case 'T_OK':
      case 'T_REPEAT':
        if (isCrashFault(fault)) {
          const restart = Math.min(RESTART_MS[fault] ?? 1000, 8000);
          if (row.template === 'T_REPEAT') at(0, repeats);
          at(100, () => emit('process_dead', { reason: fault, restartInMs: restart }));
          at(100 + restart, () => { emit('process_up', { attempt: 2 }); emit('recover_start', { action: 'replay', depth }); });
          at(100 + restart + 400, () => emit('recover_done', { action: 'replay', ms: 400, depth }));
        } else {
          if (row.template === 'T_REPEAT') at(0, repeats);
          at(100, () => { emit('stage_fail', failDetail(true)); emit('recover_start', { action: 'retry', depth }); });
          at(700, () => emit('recover_done', { action: 'retry', ms: 600, depth }));
        }
        break;
      case 'T_FAILED':
        at(100, () => { emit('stage_fail', failDetail(false)); emit('order_failed', { stage, error: fault }); });
        break;
      case 'T_HALT':
        at(100, () => { emit('stage_fail', failDetail(false)); emit('lane_halted', { reason: fault }, false); });
        break;
      case 'T_PARKED_OK':
        at(100, () => { emit('stage_fail', failDetail(true)); emit('order_parked', { stage, reason: fault }); });
        break;
      case 'T_QUAR':
        at(100, () => { emit('stage_fail', failDetail(false)); emit('order_quarantined', { stage, reason: fault }); });
        break;
      case 'T_CANCELLED':
      case 'T_DECISION_REFUND':
      case 'T_DECISION_DISCOUNT':
      case 'T_DECISION_REDO': {
        const choice = row.template === 'T_DECISION_DISCOUNT' ? 'discount' : row.template === 'T_DECISION_REDO' ? 'redo' : 'refund';
        const wait = 6000;
        const amount = 1200 + (order.length * 937) % 8800;
        at(100, () => {
          emit('stage_fail', { error: 'wrong_order', retryable: false, attempt: 1 });
          emit('decision_needed', { order, kind: 'wrong_order', detectedAt: stage, options: ['refund', 'discount', 'redo'], defaultChoice: choice, timeoutMs: wait }, false);
        });
        at(100 + wait, () => emit('decision_made', { order, choice, source: 'timeout' }, false));
        if (choice === 'discount') {
          at(100 + wait + 150, () => emit('effect', { kind: 'discount', key: `${order}:discount`, replayed: false, amount: 600 }, false));
        } else {
          at(100 + wait + 150, () => emit('effect', { kind: 'refund', key: `${order}:refund`, replayed: false, amount }, false));
        }
        if (choice === 'refund') at(100 + wait + 300, () => emit('order_failed', { stage, error: 'wrong_order', outcome: 'cancelled', reason: 'refunded' }));
        if (choice === 'redo') at(100 + wait + 600, () => emit('order_start', { index: 1, total: 1, redo: true }, false));
        break;
      }
      case 'T_DEGRADED':
        at(100, () => emit('stage_fail', failDetail(true, true)));
        break;
      default:
        break;
    }
    return t;
  }
}
