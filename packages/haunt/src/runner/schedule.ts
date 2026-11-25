// Random chaos tick and boss schedule. Pure and clock-injected: the caller supplies `nowMs`.
// Spec: design.md section 5 (Random chaos mode, Boss schedule); runtime.md section 19.
import { BOSSES, FAULTS, faultFacesStage, type BossId, type Family } from '../chaos/catalog';
import type { ArmRequest } from '../chaos/director';
import { fnv1a32, mulberry32 } from '../shared/rng';

export const TICK_MS = 1000;
export const COOLDOWN_MS = 2500;
export const P_PER_FREQUENCY = 0.08;
export const BOSS_LEAD_MS = 8000;
export const BOSS_WARN_FRACTION = 0.4;
export const ORDER_MS = 7350;
/** A live order takes about this many times ORDER_MS on the wall clock (travel gaps between stages), measured on the plain wave. The show director plans by it. */
export const SHOW_PACE = 3.5;

export interface RandomChaosOptions {
  seed: string | number;
  /** 0..1. Probability per tick is frequency * 0.08. */
  frequency: number;
  speed?: number;
}

/** Per-lane random fault planner. Same seed and same call timing give the same plan. */
export class RandomChaos {
  private readonly rng: () => number;
  private readonly speed: number;
  private readonly frequency: number;
  private readonly last = new Map<string, number>();

  constructor(o: RandomChaosOptions) {
    this.rng = mulberry32(typeof o.seed === 'number' ? o.seed : fnv1a32(o.seed));
    this.speed = o.speed ?? 1;
    this.frequency = Math.min(1, Math.max(0, o.frequency));
  }

  /** Real ms between ticks. */
  get tickMs(): number {
    return TICK_MS / this.speed;
  }

  /** Cooldown is a real-time constant: 2500 ms per lane, not scaled by speed. */
  get cooldownMs(): number {
    return COOLDOWN_MS;
  }

  /** One tick for one lane. Returns the fault to arm, or null. `stage` is the stage in flight, null if idle. */
  tick(lane: string, stage: string | null, nowMs: number): ArmRequest | null {
    if (stage === null) return null;
    const prev = this.last.get(lane);
    if (prev !== undefined && nowMs - prev < COOLDOWN_MS) return null;
    if (this.rng() >= this.frequency * P_PER_FREQUENCY) return null;
    const applicable = FAULTS.filter((f) => faultFacesStage(f, stage));
    const families = [...new Set(applicable.map((f) => f.family))] as Family[];
    if (families.length === 0) return null;
    const fam = families[Math.floor(this.rng() * families.length)]!;
    const inFam = applicable.filter((f) => f.family === fam);
    const pick = inFam[Math.floor(this.rng() * inFam.length)]!;
    this.last.set(lane, nowMs);
    return { fault: pick.id };
  }
}

export interface BossPlan {
  boss: BossId;
  expectedMs: number;
  /** Offsets from wave start, in real ms. */
  warnAtMs: number;
  startAtMs: number;
  startsInMs: number;
}

/** Rotation: Lich, Banshee Queen, Horseman, by wave number (1-based). */
export function bossForWave(wave: number): BossId {
  return BOSSES[(((wave - 1) % BOSSES.length) + BOSSES.length) % BOSSES.length]!;
}

/** One boss per wave. Warning at 40% of expected duration, start 8000 ms later (both divided by speed). */
export function planBoss(o: { wave: number; orders: number; speed?: number; pace?: number }): BossPlan {
  const speed = o.speed ?? 1;
  const expectedMs = (o.orders * ORDER_MS * (o.pace ?? 1)) / speed;
  const warnAtMs = Math.round(BOSS_WARN_FRACTION * expectedMs);
  const startsInMs = Math.round(BOSS_LEAD_MS / speed);
  return { boss: bossForWave(o.wave), expectedMs, warnAtMs, startAtMs: warnAtMs + startsInMs, startsInMs };
}
