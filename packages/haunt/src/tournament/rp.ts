// Tournament scoring (spec 3.2): Resilience Points per lane and round, cumulative ranking, tie-breaks, the halt rule, walls and epitaphs.
// Pure: it reads a wave's event list, never a clock.
import { APPS, TIERS, type TierId } from '../shared/catalog';
import { laneIssues } from '../runner/floor';
import { fallbackStage } from './fallback-stage';

export interface Ev { seq?: number; type?: string; lane?: unknown; order?: unknown; stage?: unknown; detail?: Record<string, any> | undefined; ts?: number }

export const RP = { ok: 100, lost: 300, repeat: 150, abandoned: 150, lessonCap: 200, lessonEach: 25 } as const;

export interface LaneRound {
  lane: number;
  tier: TierId;
  /** Orders the lane was given this round. */
  orders: number;
  ok: number;
  lost: number;
  repeats: number;
  abandoned: number;
  downtimeMs: number;
  downtimePenalty: number;
  reviewPoints: number;
  lessonsBonus: number;
  /** ok x 100 - lost x 300 - repeats x 150 - abandoned x 150 - downtime_penalty + review_points + lessons_bonus */
  rp: number;
  stars: { sum: number; count: number };
  issues: number;
  halted: boolean;
  /** Failed orders by the stage they died at. */
  failStages: Record<string, number>;
  /** Distinct orders that had a failed attempt at a stage, by stage (a wall is every order at one stage). */
  stageFailOrders: Record<string, number>;
  /** Faults pressed on the lane, in order. */
  faults: string[];
  /** Median recovery time of the round in ms (Fastest Recovery). */
  recoveryMs: number[];
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Everything the round's events say about one lane, turned into RP. `lessonsBonus` is +25 per new case overcome, capped at +200 (the caller counts them). */
export function laneRound(events: readonly Ev[], lane: number, tier: TierId, orders: number, lessonsBonus = 0): LaneRound {
  const mine = events.filter((e) => String(e.lane) === String(lane));
  let curStage = '';
  let ok = 0, lost = 0, repeats = 0, abandoned = 0, downtimePenalty = 0, reviewPoints = 0, downtimeMs = 0, halted = false;
  const stars = { sum: 0, count: 0 };
  const failStages: Record<string, number> = {};
  const failSeen = new Set<string>();
  const stageFailOrders: Record<string, number> = {};
  const faults: string[] = [];
  const recoveryMs: number[] = [];
  for (const e of mine) {
    const d = (e.detail ?? {}) as Record<string, any>;
    switch (e.type) {
      case 'stage_start': if (typeof e.stage === 'string') curStage = e.stage; break;
      case 'order_done': ok++; downtimeMs += num(d.lap?.downtimeMs); break;
      case 'order_failed': {
        // Live order_failed events carry only a reason: the stage is the one the lane was in.
        lost++;
        const st = String(d.stage ?? e.stage ?? (curStage || 'unknown'));
        failStages[st] = (failStages[st] ?? 0) + 1;
        downtimeMs += num(d.lap?.downtimeMs);
        break;
      }
      case 'stage_fail': {
        const k = String(e.stage) + '|' + String(e.order);
        if (e.stage && e.order && !failSeen.has(k)) { failSeen.add(k); stageFailOrders[String(e.stage)] = (stageFailOrders[String(e.stage)] ?? 0) + 1; }
        break;
      }
      case 'repeat': repeats++; break;
      case 'order_abandoned': abandoned++; break;
      case 'lane_halted': halted = true; break;
      case 'score':
        if (d.reason === 'downtime') downtimePenalty += -num(d.delta);
        else if (d.reason === 'review') reviewPoints += num(d.delta);
        break;
      case 'review': if (typeof d.stars === 'number') { stars.sum += d.stars; stars.count++; } break;
      case 'chaos': faults.push(String(d.fault)); break;
      case 'recover_done': if (typeof d.ms === 'number') recoveryMs.push(d.ms); break;
      default: break;
    }
  }
  // A lane that failed every order it was given is halted too (guard: all orders cancelled).
  if (orders > 0 && ok === 0 && lost + abandoned >= orders) halted = true;
  const bonus = Math.min(RP.lessonCap, Math.max(0, lessonsBonus));
  const rp = ok * RP.ok - lost * RP.lost - repeats * RP.repeat - abandoned * RP.abandoned - downtimePenalty + reviewPoints + bonus;
  return { lane, tier, orders, ok, lost, repeats, abandoned, downtimeMs, downtimePenalty, reviewPoints, lessonsBonus: bonus, rp, stars, issues: laneIssues(mine), halted, failStages, stageFailOrders, faults, recoveryMs };
}

/** Running totals of a lane across rounds. */
export interface Cum { lane: number; tier: TierId; rp: number; lost: number; repeats: number; starsSum: number; reviews: number; downtimeMs: number }

export const newCum = (lane: number, tier: TierId): Cum => ({ lane, tier, rp: 0, lost: 0, repeats: 0, starsSum: 0, reviews: 0, downtimeMs: 0 });

export function addRound(c: Cum, r: LaneRound): void {
  c.rp += r.rp; c.lost += r.lost; c.repeats += r.repeats; c.starsSum += r.stars.sum; c.reviews += r.stars.count; c.downtimeMs += r.downtimeMs;
}

export const avgStars = (c: Pick<Cum, 'starsSum' | 'reviews'>): number => (c.reviews ? c.starsSum / c.reviews : 0);

/**
 * Standing order, best first. The last lane of the list is the one that drops: lowest cumulative RP; on a tie the tie-break order
 * of spec 3.2 decides who is worse: more lost orders, more repeats, lower average stars, higher downtime, lower lane number.
 */
export function standingOrder(cums: readonly Cum[]): Cum[] {
  const worse = (a: Cum, b: Cum): number =>
    a.rp - b.rp || b.lost - a.lost || b.repeats - a.repeats || avgStars(a) - avgStars(b) || b.downtimeMs - a.downtimeMs || a.lane - b.lane;
  // `worse(a, b) < 0` means a is worse, so the best comes first when sorting by the opposite sign.
  return [...cums].sort((a, b) => -worse(a, b));
}

/**
 * Who drops this round: halted lanes at once (even if not lowest), else the worst of the standing. Never the whole field: with only
 * halted lanes left alive the best of them stays.
 */
export function pickEliminated(order: readonly Cum[], halted: ReadonlySet<number>): number[] {
  const alive = order.length;
  const dead = order.filter((c) => halted.has(c.lane)).map((c) => c.lane);
  if (dead.length > 0) return dead.length >= alive ? dead.slice(1) : dead;
  return alive > 1 ? [order[alive - 1]!.lane] : [];
}

/** A wall: every one of the lane's orders failed an attempt at the same stage this round (the lane may still have got through). */
export function wallOf(r: LaneRound): string | null {
  if (r.orders < 2) return null;
  for (const [stage, n] of Object.entries(r.stageFailOrders)) if (n >= r.orders) return stage;
  return null;
}

/** The stage a lane died at: where most of its failed orders died, else the last stage with trouble. */
export function diedAt(r: LaneRound, events: readonly Ev[]): string {
  const top = Object.entries(r.failStages).sort((a, b) => b[1] - a[1])[0];
  if (top) return top[0];
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (String(e.lane) === String(r.lane) && (e.type === 'stage_fail' || e.type === 'lane_halted') && typeof e.stage === 'string') return e.stage;
  }
  return fallbackStage(events);
}

const stageLabel = (id: string): string => APPS.orders.stages.find((s) => s.id === id)?.label ?? id;

/** "Rookie, died at Payment, round 2: 3 repeated charges, 2 cancelled orders. Cause: crash." */
export function epitaph(r: LaneRound, stage: string, round: number, cause: string, kind: 'eliminated' | 'wall' = 'eliminated'): string {
  const bits = [r.repeats ? `${r.repeats} repeated ${r.repeats === 1 ? 'effect' : 'effects'}` : '', r.lost ? `${r.lost} cancelled ${r.lost === 1 ? 'order' : 'orders'}` : ''].filter(Boolean);
  const what = kind === 'wall' ? 'hit a wall at' : 'died at';
  return `${TIERS[r.tier].label}, ${what} ${stageLabel(stage)}, round ${round}: ${bits.length ? bits.join(', ') : 'no clean orders'}. Cause: ${cause}.`;
}

/** The fault pressed last on the lane before it fell, as a plain cause. */
export function causeOf(r: LaneRound): string {
  const f = r.faults.at(-1);
  if (f) return f.replace(/_/g, ' ');
  return r.halted ? 'the lane halted' : 'too many lost orders';
}
