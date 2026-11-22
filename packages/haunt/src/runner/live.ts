// Live wiring: a wave clock that drives random chaos and the boss schedule, and a ledger callback that turns
// repeated provider rows into `repeat` events. The clock is stepped with elapsed ms so tests need no timers;
// `start` attaches it to setInterval. Spec: design.md section 5; runtime.md sections 19, 22.
import type { LaneInfo } from '../chaos/director';
import type { LedgerRow } from '../../../core/src/provider';
import type { HauntEvent } from '../score/score';
import type { RunnerEngine } from './engine';
import { RepeatDetector } from './provider';
import { RandomChaos, planBoss, TICK_MS, type BossPlan } from './schedule';
import { DialChaos } from './intensity';
import { FLOOR_FRACTION } from './floor';

/** Boss window length at 1x; real ms is this divided by speed. */
export const BOSS_DURATION_MS = 17000;

export interface WaveClockOptions {
  engine: RunnerEngine;
  record: (ev: HauntEvent) => void;
  wave: number;
  orders: number;
  seed: number;
  /** 0..1 random chaos frequency; ignored unless `randomEnabled()` is true. */
  frequency: number;
  speed?: number;
  /** Live lane state from the runner loop. Defaults to a working lane in `ship`. */
  laneInfo?: (lane: string) => LaneInfo;
  /** Random chaos only fires while this returns true (mode === 'random'). Defaults to the engine's chaos mode. */
  randomEnabled?: () => boolean;
  /** Boss schedule runs in random and demo mode. Defaults to the same test as random chaos. */
  bossEnabled?: () => boolean;
  /** Floor rule (spec 5.3): inject a gremlin for a lane that has had no issue by mid-round. Default true. */
  floor?: boolean;
}

export class WaveClock {
  readonly boss: BossPlan;
  private readonly random: RandomChaos;
  private readonly dial: DialChaos;
  private elapsed = 0;
  private nextTick = 0;
  private phase: 'idle' | 'warned' | 'live' | 'done' = 'idle';
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly o: WaveClockOptions) {
    const speed = o.speed ?? o.engine.speed;
    this.random = new RandomChaos({ seed: o.seed, frequency: o.frequency, speed });
    this.dial = new DialChaos(`${o.seed}|dial`);
    this.boss = planBoss({ wave: o.wave, orders: o.orders, speed });
  }

  private info(lane: string): LaneInfo {
    return this.o.laneInfo?.(lane) ?? { state: 'working', stage: 'ship' };
  }

  private randomOn(): boolean {
    return this.o.randomEnabled ? this.o.randomEnabled() : this.o.engine.chaosMode.mode === 'random';
  }

  /** Advance to `elapsedMs` since wave start, firing every random tick and boss phase that is due. */
  step(elapsedMs: number): void {
    const { engine, record } = this.o;
    const speed = this.o.speed ?? engine.speed;
    const tickMs = TICK_MS / speed;
    if (this.o.floor !== false && elapsedMs >= this.boss.expectedMs * FLOOR_FRACTION) {
      for (const lane of engine.lanes) {
        if (engine.floor.count(lane) > 0 || engine.floor.gremlined(lane)) continue;
        const info = this.info(lane);
        if (info.stage === null || info.state === 'dead') continue;
        try { engine.gremlin(lane); } catch { /* depth limit: try again next tick */ }
      }
    }
    while (this.nextTick <= elapsedMs) {
      const at = this.nextTick;
      this.nextTick += tickMs;
      if (!this.randomOn()) continue;
      if (engine.dialTouched) {
        // The intensity dial drives the plan (spec 5.1): rate, simultaneous faults, unknown share and depth come from the level.
        for (const lane of engine.lanes) {
          const info = this.info(lane);
          for (const p of this.dial.tick(lane, info.stage, at, engine.level, engine.director.depth(lane))) {
            try { engine.chaos({ lane: Number(lane), fault: p.fault, source: p.fuzz ? 'fuzz' : 'random', ...(p.fuzz ? { fuzz: p.fuzz } : {}) }); } catch { /* lane at depth limit */ }
          }
        }
        continue;
      }
      for (const lane of engine.lanes) {
        const info = this.info(lane);
        const req = this.random.tick(lane, info.stage, at);
        if (!req) continue;
        try { engine.chaos({ lane: Number(lane), fault: req.fault, source: 'random' }); } catch { /* lane at depth limit */ }
      }
    }
    this.elapsed = elapsedMs;
    if (!(this.o.bossEnabled ? this.o.bossEnabled() : this.randomOn())) return;
    const b = this.boss;
    if (this.phase === 'idle' && elapsedMs >= b.warnAtMs) {
      this.phase = 'warned';
      record({ type: 'boss_warning', detail: { boss: b.boss, startsInMs: b.startsInMs } });
    }
    if (this.phase === 'warned' && elapsedMs >= b.startAtMs) {
      this.phase = 'live';
      record({ type: 'boss_start', detail: { boss: b.boss } });
      const lanes = Object.fromEntries(engine.lanes.map((l) => [l, this.info(l)]));
      for (const { lane, req } of engine.director.bossArms(b.boss, lanes)) {
        try { engine.chaos({ lane: Number(lane), fault: req.fault, point: req.point, forMs: req.forMs, source: 'boss' }); } catch { /* depth limit */ }
      }
    }
    if (this.phase === 'live' && elapsedMs >= b.startAtMs + BOSS_DURATION_MS / speed) {
      this.phase = 'done';
      record({ type: 'boss_end', detail: { boss: b.boss, durationMs: Math.round(BOSS_DURATION_MS / speed) } });
    }
  }

  get elapsedMs(): number {
    return this.elapsed;
  }

  /** Attach to the wall clock. Safe to call once; `stop` detaches. */
  start(now: () => number = Date.now, setIv: typeof setInterval = setInterval): void {
    if (this.timer) return;
    const t0 = now();
    const speed = this.o.speed ?? this.o.engine.speed;
    this.timer = setIv(() => this.step(now() - t0), Math.max(50, Math.round(TICK_MS / speed / 4)));
    (this.timer as { unref?: () => void }).unref?.();
  }

  stop(clear: typeof clearInterval = clearInterval): void {
    if (this.timer) clear(this.timer);
    this.timer = undefined;
  }
}

/** Live ledger callback: pass each new provider row; emits one `repeat` event per extra row. */
export function ledgerCallback(record: (ev: HauntEvent) => void, detector = new RepeatDetector()): (row: LedgerRow) => void {
  return (row) => {
    const r = detector.add(row);
    if (r) record({ type: 'repeat', lane: row.lane, order: row.order, detail: { kind: r.kind, key: r.key, count: r.count } });
  };
}
