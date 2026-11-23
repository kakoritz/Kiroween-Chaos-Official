// Turns lane plans into a contract event stream (hello, wave_start, lane_ready, lane events, bosses, wave_end).
// Shared by the fixture generator and the mock server. All times here are plan time at 1x.
import { TIERS, TIMING, orderId, type AppId, type PartId, type TierId, type HauntEvent } from '@haunt/shared';
import { planLane, type ArmSpec, type LanePlan, type LaneCfg } from './plan';
import { gremlinVariant, laneIssues } from '../../../haunt/src/runner/floor';
import { unit } from '../../../haunt/src/shared/rng';
import type { Policy } from '../../../haunt/src/sdk/policy';

export const LANE_START_MS = 1000;
export const BASE_TS = 1_760_000_000_000;

export interface WaveSpec {
  app: AppId;
  /** Tier of each lane, lane 1 first. */
  tiers: TierId[];
  tiersMode?: 'race' | 'allPhoenix';
  orders: number;
  seed: number;
  pace: 1 | 2 | 3;
  waveNo?: number;
  progressMs?: number;
  /** Override what lane_ready shows (a hardened Rookie keeps its name but gains parts). */
  laneReady?: { tier: string; label: string; parts: string[] }[];
  /** Parts per lane that replace the tier's own (campaign Crew on lane 1). */
  laneParts?: (PartId[] | undefined)[];
  /** Never perfect (spec 5.3, P19): a lane whose plan has no issue gets a gremlin at the middle of the round, and `wave_end` carries `issues` per lane. */
  floor?: boolean;
  /** Learned policy overlay per lane (see `LaneCfg.policy`). */
  policies?: (Policy | undefined)[];
}

export interface BossSpec {
  fault: string;
  /** Plan ms (lane time) of boss_warning. boss_start comes startsInMs later. */
  warnAt: number;
}

export interface ResolvedBoss extends BossSpec {
  startAt: number;
  endAt: number;
}

export interface PlannedWave {
  spec: WaveSpec;
  plans: LanePlan[];
  bosses: ResolvedBoss[];
  endAt: number;
}

const GREMLIN_STAGES = ['account', 'submit', 'payment', 'confirmation', 'receive', 'process', 'ship'];

/** Floor rule: if the lane has no issue, plan it again with one gremlin (slow call, one 500 or a duplicate delivery). Asserts the floor holds. */
function withFloor(spec: WaveSpec, cfg: LaneCfg, arms: ArmSpec[], plan: LanePlan): LanePlan {
  if (laneIssues(plan.events) > 0) return plan;
  const variant = gremlinVariant(spec.seed, cfg.lane, spec.waveNo ?? 1);
  const stage = variant === 'duplicate_request' ? 'create' : GREMLIN_STAGES[Math.floor(unit(spec.seed, 'gremlin-stage', cfg.lane) * GREMLIN_STAGES.length)]!;
  const mid = Math.max(1, Math.ceil(spec.orders / 2));
  for (const order of [...new Set([mid, 1, spec.orders])]) {
    const gremlin: ArmSpec = { id: `gremlin-${cfg.lane}`, fault: variant, source: 'gremlin', creature: 'gremlin', extra: { fault: 'gremlin', variant }, when: { order, stage, attempt: 1, delay: 100 } };
    const p = planLane(cfg, [...arms, gremlin]);
    if (laneIssues(p.events) > 0) return p;
  }
  throw new Error(`floor rule: lane ${cfg.lane} ended with zero issues`);
}

export function planWave(spec: WaveSpec, armsByLane: Record<number, ArmSpec[]> = {}, bosses: BossSpec[] = []): PlannedWave {
  const resolved: ResolvedBoss[] = bosses.map((b) => ({ ...b, startAt: b.warnAt + TIMING.bossWarnMs, endAt: 0 }));
  const plans = spec.tiers.map((tier, i) => {
    const lane = i + 1;
    const cfg: LaneCfg = { lane, tier, app: spec.app, seed: spec.seed, orders: spec.orders, pace: spec.pace, progressMs: spec.progressMs, parts: spec.laneParts?.[i], ...(spec.policies?.[i] ? { policy: spec.policies[i] } : {}) };
    const arms = [...(armsByLane[lane] ?? [])];
    for (const b of resolved) arms.push({ id: `boss-${b.fault}`, fault: b.fault, source: 'boss', at: b.startAt });
    const plan = planLane(cfg, arms);
    return spec.floor ? withFloor(spec, cfg, arms, plan) : plan;
  });
  for (const b of resolved) {
    let end = b.startAt + 500;
    for (const p of plans) {
      const info = p.arms.get(`boss-${b.fault}`);
      if (info && info.status === 'ok' && info.settledAt !== undefined) end = Math.max(end, info.settledAt + 300);
    }
    b.endAt = end;
  }
  const endAt = Math.max(0, ...plans.map((p) => p.endT), ...resolved.map((b) => b.endAt));
  return { spec, plans, bosses: resolved, endAt };
}

function laneEvents(plan: LanePlan, lane: number, wave: number, ts0: number): HauntEvent[] {
  return plan.events.map((e) => {
    const ev: HauntEvent = { seq: 0, ts: ts0 + LANE_START_MS + e.t, type: e.type, wave, lane, ...(e.order ? { order: e.order } : {}), ...(e.stage ? { stage: e.stage } : {}), detail: e.detail };
    return ev;
  });
}

/** Events of one wave with seq 0 (assign with `assignSeq`). `ts0` is the epoch ms of wave_start. */
export function assembleWave(pw: PlannedWave, ts0: number, includeHello = true): HauntEvent[] {
  const { spec } = pw;
  const wave = spec.waveNo ?? 1;
  const out: { ev: HauntEvent; key: [number, number, number, number] }[] = [];
  const add = (ev: HauntEvent, prio: number, lane: number, n: number): void => { out.push({ ev, key: [ev.ts, prio, lane, n] }); };
  if (includeHello) add({ seq: 0, ts: ts0, type: 'hello', contractVersion: 1, mode: 'mock', app: spec.app }, -2, 0, 0);
  add({
    seq: 0, ts: ts0 + 100, type: 'wave_start', wave,
    detail: { orders: spec.orders, seed: spec.seed, tiers: spec.tiersMode ?? 'race', lanes: spec.tiers.length, speed: 1, app: spec.app, pace: spec.pace === 3 ? 'slow' : spec.pace === 2 ? 'show' : 'normal' },
  }, -1, 0, 0);
  spec.tiers.forEach((tier, i) => {
    const lr = spec.laneReady?.[i] ?? { tier, label: TIERS[tier].label, parts: [...TIERS[tier].parts] };
    add({ seq: 0, ts: ts0 + 150 + i * 5, type: 'lane_ready', wave, lane: i + 1, detail: { tier: lr.tier, label: lr.label, parts: lr.parts } }, 0, i + 1, 0);
  });
  pw.plans.forEach((p, i) => laneEvents(p, i + 1, wave, ts0).forEach((ev, k) => add(ev, 1, i + 1, k)));
  const base = ts0 + LANE_START_MS;
  pw.bosses.forEach((b, k) => {
    add({ seq: 0, ts: Math.round(base + b.warnAt), type: 'boss_warning', wave, detail: { boss: b.fault, startsInMs: TIMING.bossWarnMs } }, 0, 0, k);
    add({ seq: 0, ts: Math.round(base + b.startAt), type: 'boss_start', wave, detail: { boss: b.fault } }, 0, 0, k);
    add({ seq: 0, ts: Math.round(base + b.endAt), type: 'boss_end', wave, detail: { boss: b.fault, durationMs: Math.round(b.endAt - b.startAt) } }, 2, 0, k);
  });
  const summary: Record<string, any> = {};
  pw.plans.forEach((p, i) => {
    const s = p.summary;
    summary[String(i + 1)] = { score: s.score, grade: s.grade, completed: s.completed, failed: s.failed, parked: s.parked, quarantined: s.quarantined, repeats: s.repeats, ...(spec.floor ? { issues: laneIssues(p.events) } : {}) };
  });
  add({ seq: 0, ts: Math.round(base + pw.endAt + 500), type: 'wave_end', wave, detail: { summary } }, 9, 0, 0);
  out.sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2] || a.key[3] - b.key[3]);
  return out.map((o) => o.ev);
}

/** Assigns increasing seq numbers starting at `start` (in place). */
export function assignSeq(events: HauntEvent[], start = 1): HauntEvent[] {
  events.forEach((e, i) => { e.seq = start + i; });
  return events;
}

/** Test helper: one lane plan as a complete, valid stream. */
export function toHauntEvents(plan: LanePlan, o: { app: AppId; tier: TierId; lane: number }): HauntEvent[] {
  const orders = new Set(plan.events.map((e) => e.order).filter(Boolean)).size;
  void orderId;
  const spec: WaveSpec = { app: o.app, tiers: [o.tier], orders: Math.max(1, orders), seed: 7, pace: 1 };
  return assignSeq(assembleWave({ spec, plans: [plan], bosses: [], endAt: plan.endT }, BASE_TS));
}
