// Intensity dial and outage timer. Spec: .kiro/specs/tournament-v3/spec.md sections 5.1 and 5.4; contract V1_2.md section 5.
// Pure and seeded: the same seed gives the same draws.
import { faultById, FAULTS, MAX_DEPTH } from '../chaos/catalog';
import { fnv1a32, mulberry32, unit } from '../shared/rng';
import { COOLDOWN_MS, ORDER_MS, TICK_MS } from './schedule';

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 11;
export const DEFAULT_LEVEL = 3;

export interface IntensityRow {
  level: number;
  /** Faults per order per lane. Level 11 is "every stage, every order" (rate is the tick rate cap, see `continuous`). */
  rate: number;
  /** Faults pressed together. Level 11 is every fault the stage takes (`Infinity`). */
  simultaneous: number;
  /** Share of faults drawn from the unknown (fuzz) pool, 0 to 1. */
  unknown: number;
  /** Nested chaos depth cap (director MAX_DEPTH is 5). */
  depth: number;
  /** Curses per lane (reserved for TV3-C9). Level 11 is all five. */
  curses: number;
  /** Longest random outage at 1x, ms. The shortest is always 1000. */
  outageMaxMs: number;
  /** Level 11: a fault on every stage of every order, overlapping, no cooldown. */
  continuous: boolean;
}

const ROW = (level: number, rate: number, simultaneous: number, unknownPct: number, depth: number, curses: number, outageS: number, continuous = false): IntensityRow =>
  ({ level, rate, simultaneous, unknown: unknownPct / 100, depth, curses, outageMaxMs: outageS * 1000, continuous });

/** Spec 5.1 table. Index is level minus one. */
export const INTENSITY_TABLE: readonly IntensityRow[] = [
  ROW(1, 0.3, 1, 0, 1, 0, 5),
  ROW(2, 0.5, 1, 0, 1, 0, 8),
  ROW(3, 0.7, 1, 5, 1, 0, 10),
  ROW(4, 0.9, 1, 10, 2, 1, 12),
  ROW(5, 1.1, 2, 15, 2, 1, 15),
  ROW(6, 1.4, 2, 20, 3, 1, 18),
  ROW(7, 1.7, 2, 25, 3, 2, 22),
  ROW(8, 2.0, 3, 30, 4, 2, 25),
  ROW(9, 2.5, 3, 35, 4, 2, 28),
  ROW(10, 3.0, 4, 40, 5, 3, 30),
  ROW(11, 3.0, Infinity, 50, 5, 5, 30, true),
];

export const clampLevel = (n: number): number => Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.round(n)));
export const isLevel = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= MIN_LEVEL && n <= MAX_LEVEL;
export const intensityRow = (level: number): IntensityRow => INTENSITY_TABLE[clampLevel(level) - 1]!;

/** Faults that are an outage of a service window: the window length is drawn from the dial (spec 5.4). */
export const OUTAGE_FAULTS: ReadonlySet<string> = new Set(['endpoint_down', 'sms_down', 'app_down', 'updates_down']);

export const OUTAGE_MIN_MS = 1000;

/**
 * `outageMs` at 1x: uniform in 1000 to the level's maximum, seeded by (seed, lane, key) so a replay draws the same length.
 * `key` is anything stable for the fault, the chaos id for a live press.
 */
export function drawOutageMs(seed: string | number, lane: string | number, key: string, level: number = DEFAULT_LEVEL): number {
  const max = intensityRow(level).outageMaxMs;
  return Math.round(OUTAGE_MIN_MS + unit(seed, 'outage', lane, key) * (max - OUTAGE_MIN_MS));
}

// ---------------------------------------------------------------------------------------------------------- unknown faults

/** A fault the player and the bots have not seen: a known provider fault with a strange shape. Tagged `unknown` on the chaos event. */
export interface FuzzFault {
  /** The known fault it is built on (it decides where it can land and which provider mode acts). */
  fault: string;
  /** Odd window in ms at 1x, for window faults. */
  forMs?: number;
  /** Odd call count, for count faults. */
  count?: number;
  /** Odd HTTP status (418, 507, 522, ...). */
  status?: number;
  /** The answer is cut off mid-body. */
  truncated?: boolean;
  /** The provider clock jumps by this many ms (a header on the answer). */
  clockJumpMs?: number;
  /** Stable id of the shape, `fz-xxxxxxxx`, so the Casebook can recognise a repeat of the same unknown. */
  fingerprint: string;
}

export const ODD_STATUS: readonly number[] = [402, 409, 418, 422, 451, 499, 502, 504, 507, 508, 520, 522, 599];
const FUZZ_BASES: readonly string[] = ['timeout', 'slow_link', 'http_404', 'http_429', 'http_500', 'endpoint_down', 'internet_outage'];
const STATUS_FAULTS: ReadonlySet<string> = new Set(['http_404', 'http_429', 'http_500', 'endpoint_down']);
const WINDOW_FAULTS: ReadonlySet<string> = new Set(['slow_link', 'endpoint_down', 'internet_outage']);

/** One fuzz fault for `stage`, drawn from `rng`. Null when no provider fault can land on that stage (create, handoff). */
export function fuzzFromRng(rng: () => number, stage: string): FuzzFault | null {
  const pool = FUZZ_BASES.filter((id) => faultById(id)?.stages.includes(stage));
  if (pool.length === 0) return null;
  const fault = pool[Math.floor(rng() * pool.length)]!;
  const f: Omit<FuzzFault, 'fingerprint'> = { fault };
  if (STATUS_FAULTS.has(fault)) f.status = ODD_STATUS[Math.floor(rng() * ODD_STATUS.length)]!;
  if (WINDOW_FAULTS.has(fault)) f.forMs = 80 + Math.floor(rng() * 6000);
  else f.count = 1 + Math.floor(rng() * 4);
  if (rng() < 0.4) f.truncated = true;
  if (rng() < 0.3) f.clockJumpMs = (rng() < 0.5 ? -1 : 1) * (60_000 + Math.floor(rng() * 86_000_000));
  const shape = `${f.fault}|${f.status ?? ''}|${f.forMs ?? ''}|${f.count ?? ''}|${f.truncated ? 1 : 0}|${f.clockJumpMs ?? ''}`;
  return { ...f, fingerprint: `fz-${fnv1a32(shape).toString(16).padStart(8, '0')}` };
}

/** Seeded: the same (seed, lane, key, stage) always gives the same unknown fault. */
export function fuzzFault(seed: string | number, lane: string | number, key: string, stage: string): FuzzFault | null {
  return fuzzFromRng(mulberry32(fnv1a32([seed, 'fuzz', lane, key].join('|'))), stage);
}

// ---------------------------------------------------------------------------------------------------------- dial chaos

export interface DialPress {
  fault: string;
  /** Set when the press is an unknown (fuzz) fault; `fault` is then its base. */
  fuzz?: FuzzFault;
}

/** Ticks per order at any speed: an order is ORDER_MS long and a tick is TICK_MS, both divided by speed. */
const TICKS_PER_ORDER = ORDER_MS / TICK_MS;

/**
 * The chaos plan scaled by the dial (spec 5.1). One `tick` per lane per clock tick returns the faults to press now:
 * rate per order, simultaneous faults, unknown share and nested depth come from the level's row; level 11 presses every
 * fault the stage takes on every tick, with no cooldown. Same seed and same call timing give the same plan.
 */
export class DialChaos {
  private readonly rng: () => number;
  private readonly last = new Map<string, number>();

  constructor(seed: string | number) {
    this.rng = mulberry32(typeof seed === 'number' ? seed : fnv1a32(seed));
  }

  /** `depth` is the chaos stack depth of the lane now. */
  tick(lane: string, stage: string | null, nowMs: number, level: number, depth = 0): DialPress[] {
    if (stage === null) return [];
    const row = intensityRow(level);
    const prev = this.last.get(lane);
    if (!row.continuous && prev !== undefined && nowMs - prev < COOLDOWN_MS) return [];
    const p = row.continuous ? 1 : Math.min(1, row.rate / TICKS_PER_ORDER);
    if (this.rng() >= p) return [];
    const room = Math.max(0, Math.min(row.depth, MAX_DEPTH) - depth);
    const applicable = FAULTS.filter((f) => f.stages.includes(stage) && f.id !== 'order_typo');
    const n = Math.min(row.continuous ? applicable.length : row.simultaneous, room, applicable.length);
    if (n <= 0) return [];
    // Partial seeded shuffle: n distinct faults.
    const pool = [...applicable];
    const out: DialPress[] = [];
    for (let i = 0; i < n; i++) {
      const pick = pool.splice(Math.floor(this.rng() * pool.length), 1)[0]!;
      if (this.rng() < row.unknown) {
        const fuzz = fuzzFromRng(this.rng, stage);
        if (fuzz) { out.push({ fault: fuzz.fault, fuzz }); continue; }
      }
      out.push({ fault: pick.id });
    }
    this.last.set(lane, nowMs);
    return out;
  }
}

// ---------------------------------------------------------------------------------------------------------- dial state

export interface DialState {
  level: number;
  /** Raise the level by one every `everyN` finished orders until `max`. */
  autoRamp: boolean;
  everyN: number;
  max: number;
}

export const DEFAULT_RAMP_EVERY = 4;

export const initialDial = (): DialState => ({ level: DEFAULT_LEVEL, autoRamp: false, everyN: DEFAULT_RAMP_EVERY, max: MAX_LEVEL });
