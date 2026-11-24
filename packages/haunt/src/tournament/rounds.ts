// Tournament rounds and the seeded storm every live lane meets in a round (spec 3.1: "same storm for all").
import { TIER_ORDER, type TierId } from '../shared/catalog';
import { fnv1a32, mulberry32 } from '../shared/rng';
import { FAULTS } from '../chaos/catalog';
import { drawOutageMs, fuzzFromRng, intensityRow, isLevel, OUTAGE_FAULTS, type FuzzFault } from '../runner/intensity';

export interface RoundCfg { lanes: number; orders: number; intensity: number }

/** R1 = 5 lanes, 6 orders, intensity 3; R2 = 4, 8, 5; R3 = 3, 10, 7; R4 final = 2, 12, 9. */
export const DEFAULT_ROUNDS: readonly RoundCfg[] = [
  { lanes: 5, orders: 6, intensity: 3 },
  { lanes: 4, orders: 8, intensity: 5 },
  { lanes: 3, orders: 10, intensity: 7 },
  { lanes: 2, orders: 12, intensity: 9 },
];

/** Lane n always runs tier n, so a corpse keeps its place on the board. */
export const LANE_TIERS: readonly TierId[] = TIER_ORDER;
export const tierOfLane = (lane: number): TierId => LANE_TIERS[lane - 1]!;

/** Validates `rounds` from a request body. Throws a readable message. */
export function parseRounds(raw: unknown): RoundCfg[] {
  if (raw === undefined) return DEFAULT_ROUNDS.map((r) => ({ ...r }));
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 10) throw new Error('rounds must be a list of 1 to 10 rounds');
  return raw.map((r, i) => {
    const x = r as Partial<RoundCfg> | null;
    const lanes = x?.lanes ?? DEFAULT_ROUNDS[i]?.lanes ?? 2;
    const orders = x?.orders ?? DEFAULT_ROUNDS[i]?.orders ?? 6;
    const intensity = x?.intensity ?? DEFAULT_ROUNDS[i]?.intensity ?? 3;
    if (!Number.isInteger(lanes) || lanes < 1 || lanes > 5) throw new Error(`round ${i + 1}: lanes must be 1 to 5`);
    if (!Number.isInteger(orders) || orders < 1 || orders > 40) throw new Error(`round ${i + 1}: orders must be 1 to 40`);
    if (!isLevel(intensity)) throw new Error(`round ${i + 1}: intensity must be 1 to 11`);
    return { lanes, orders, intensity };
  });
}

export interface PlanPress {
  /** 1-based order of the lane the press waits for. */
  order: number;
  stage: string;
  fault: string;
  point?: string;
  /** Window at 1x ms for outage and window faults (drawn once, so every lane gets the same length). */
  outageMs?: number;
  fuzz?: FuzzFault;
}

const STAGES = ['account', 'submit', 'payment', 'confirmation', 'receive', 'process', 'ship'];
const POOL = ['crash', 'timeout', 'http_404', 'http_429', 'http_500', 'endpoint_down', 'slow_link'];
/** The Ticket Desk's storm: every stage a fault can land on, the generic faults plus the desk's own six (packs spec section 4). */
const INBOX_PLAN_STAGES = ['login', 'ingest', 'validate', 'dedupe', 'triage', 'assign', 'sla', 'notify', 'escalate'];
const INBOX_POOL = [...POOL, 'sso_expired', 'field_mapping_error', 'webhook_retry_storm', 'duplicate_storm', 'wrong_queue', 'sla_breach', 'assignee_deleted', 'rate_limited'];
/** The Stream app's storm: the provider-call stages and the generic faults. */
const STREAM_PLAN_STAGES = ['fetch', 'draft', 'reply', 'archive'];
const HEAVY = ['internet_outage', 'power_outage'];
const POINTS = ['before_effect', 'after_effect_before_journal', 'after_journal'];

/**
 * The storm of one round: for each order, `rate` faults (the level's fault rate per order, so 0.7 is a 70 percent chance and 2.5 is
 * two or three), at random effect stages. One plan for the whole round: every live lane meets the same presses at the same orders and
 * stages, so ranking is fair. Seeded by (seed, round).
 */
export function roundPlan(seed: string | number, round: number, cfg: RoundCfg, app: 'orders' | 'inbox' | 'stream' = 'orders'): PlanPress[] {
  const stages = app === 'stream' ? STREAM_PLAN_STAGES : app === 'inbox' ? INBOX_PLAN_STAGES : STAGES;
  const basePool = app === 'inbox' ? INBOX_POOL : POOL;
  const rng = mulberry32(fnv1a32(`${seed}|plan|${round}`));
  const row = intensityRow(cfg.intensity);
  const presses: PlanPress[] = [];
  for (let order = 1; order <= cfg.orders; order++) {
    const n = Math.floor(row.rate) + (rng() < row.rate - Math.floor(row.rate) ? 1 : 0);
    for (let i = 0; i < Math.min(n, row.continuous ? 4 : row.simultaneous); i++) {
      const stage = stages[Math.floor(rng() * stages.length)]!;
      const unknown = rng() < row.unknown ? fuzzFromRng(rng, stage) : null;
      const pool = [...basePool, ...(cfg.intensity >= 6 ? HEAVY : [])].filter((id) => FAULTS.some((f) => f.id === id && f.stages.includes(stage)));
      const fault = unknown ? unknown.fault : pool[Math.floor(rng() * pool.length)]!;
      const press: PlanPress = { order, stage, fault };
      if (fault === 'crash' || fault === 'power_outage') press.point = POINTS[Math.floor(rng() * POINTS.length)]!;
      if (unknown) {
        press.fuzz = unknown;
        if (unknown.forMs !== undefined) press.outageMs = unknown.forMs;
      } else if (OUTAGE_FAULTS.has(fault)) press.outageMs = drawOutageMs(seed, 'plan', `r${round}-o${order}-${i}`, cfg.intensity);
      presses.push(press);
    }
  }
  return presses;
}
