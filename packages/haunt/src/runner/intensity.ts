// Intensity dial and outage timer. Spec: .kiro/specs/tournament-v3/spec.md sections 5.1 and 5.4; contract V1_2.md section 5.
// Pure and seeded: the same seed gives the same draws.
import { unit } from '../shared/rng';

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
