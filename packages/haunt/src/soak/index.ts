// Soak mode: run the bot for a set time with random chaos at a set rate, then check for drift.
// Spec: engine design.md section 8 (soak pass rule), runtime.md (haunt soak), harness tasks.md H3.5.
import type { CreaturePlugin } from '../creatures/plugin';
import { gradeOf, type Grade } from '../score/grade';
import { cellSeed, type CellDetail } from '../sweep/executor';
import { createLiveCellRunner, type LiveCellOptions } from '../sweep/live';
import type { CellOutcome, SweepCell } from '../sweep/matrix';

export const SOAK_MIN_RELIABILITY = 90;
export const SOAK_MIN_THROUGHPUT_RATIO = 0.8;
export const DEFAULT_SOAK_MINUTES = 5;
export const DEFAULT_SOAK_FREQUENCY = 0.3;

/** One soak segment: a short lane run, with one chaos cell or none (calm). */
export type RunSoakSegment = (cell: SweepCell | null, seed: number) => Promise<CellOutcome | CellDetail> | CellOutcome | CellDetail;

export interface SoakOptions {
  /** Total time to soak. Default 5 minutes. */
  durationMs?: number;
  /** Chance that a segment carries a chaos fault, 0..1. Default 0.3. */
  frequency?: number;
  seed?: number;
  /** Orders each segment runs (used for throughput). Default 2. */
  ordersPerSegment?: number;
  /** Window used to compare early and late throughput. Default min(60 s, duration / 3). */
  windowMs?: number;
  /** Faults the soak draws from. */
  cells: SweepCell[];
  /** Hard stop on segment count, so a stalled clock cannot loop forever. Default 100000. */
  maxSegments?: number;
  now?: () => number;
}

export interface SoakSegmentResult {
  index: number;
  startMs: number;
  durationMs: number;
  cell: SweepCell | null;
  outcome: CellOutcome;
  error?: string;
}

export interface SoakWindow { segments: number; orders: number; throughputPerMin: number }

export interface SoakReport {
  seed: number;
  frequency: number;
  durationMs: number;
  segments: SoakSegmentResult[];
  chaosSegments: number;
  reliability: number;
  grade: Grade;
  first: SoakWindow;
  last: SoakWindow;
  /** last / first throughput; 1 when the first window has none. */
  throughputRatio: number;
  /** Segments that repeated a side effect or lost an order (journal and ledger disagree). */
  disagreements: number;
  noDrift: boolean;
  passed: boolean;
}

/** Small seeded generator (mulberry32) so a soak replays the same chaos draw. */
export function soakRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clean = (o: CellOutcome): boolean => o === 'pass' || o === 'recovered_late';

function windowOf(segs: SoakSegmentResult[], orders: number): SoakWindow {
  const ms = segs.reduce((n, s) => n + s.durationMs, 0);
  const done = segs.filter((s) => clean(s.outcome)).length * orders;
  const minutes = ms / 60000;
  return { segments: segs.length, orders: done, throughputPerMin: minutes > 0 ? Math.round((done / minutes) * 100) / 100 : 0 };
}

export async function runSoak(run: RunSoakSegment, opts: SoakOptions): Promise<SoakReport> {
  const now = opts.now ?? Date.now;
  const durationMs = opts.durationMs ?? DEFAULT_SOAK_MINUTES * 60000;
  const frequency = Math.min(1, Math.max(0, opts.frequency ?? DEFAULT_SOAK_FREQUENCY));
  const seed = opts.seed ?? 1;
  const orders = opts.ordersPerSegment ?? 2;
  const maxSegments = opts.maxSegments ?? 100000;
  const rng = soakRng(seed);
  const segments: SoakSegmentResult[] = [];
  const repeats: boolean[] = [];
  const t0 = now();
  while (now() - t0 < durationMs && segments.length < maxSegments) {
    const i = segments.length;
    const draw = rng();
    const pick = rng();
    const cell = opts.cells.length > 0 && draw < frequency ? opts.cells[Math.floor(pick * opts.cells.length)] : null;
    const start = now();
    let outcome: CellOutcome;
    let detail: Partial<CellDetail> = {};
    let error: string | undefined;
    try {
      const r = await run(cell, cellSeed(seed, i));
      if (typeof r === 'string') outcome = r;
      else { outcome = r.outcome; detail = r; }
    } catch (e) {
      outcome = 'fail';
      error = e instanceof Error ? e.message : String(e);
    }
    repeats.push(outcome === 'repeat' || (detail.repeatedKinds?.length ?? 0) > 0 || detail.lost === true);
    segments.push({ index: i, startMs: start - t0, durationMs: Math.max(0, now() - start), cell, outcome, ...(error ? { error } : {}) });
  }

  const windowMs = opts.windowMs ?? Math.min(60000, Math.floor(durationMs / 3));
  const firstSegs: SoakSegmentResult[] = [];
  const lastSegs: SoakSegmentResult[] = [];
  const total = segments.length === 0 ? 0 : segments[segments.length - 1].startMs + segments[segments.length - 1].durationMs;
  for (const s of segments) {
    if (s.startMs < windowMs) firstSegs.push(s);
    if (s.startMs + s.durationMs > total - windowMs) lastSegs.push(s);
  }
  // Calm throughput is the drift signal: chaos segments are slow on purpose.
  const calm = (xs: SoakSegmentResult[]) => xs.filter((s) => s.cell === null);
  const first = windowOf(calm(firstSegs).length > 0 ? calm(firstSegs) : firstSegs, orders);
  const last = windowOf(calm(lastSegs).length > 0 ? calm(lastSegs) : lastSegs, orders);
  const throughputRatio = first.throughputPerMin > 0 ? Math.round((last.throughputPerMin / first.throughputPerMin) * 1000) / 1000 : 1;

  const counts = { orders: 0, clean: 0 };
  for (const s of segments) { counts.orders += orders; if (clean(s.outcome)) counts.clean += orders; }
  const disagreements = repeats.filter(Boolean).length;
  const { reliability, grade } = gradeOf({
    orders: counts.orders, clean: counts.clean, parkedResumed: 0, quarantined: 0, extraRows: disagreements,
    chargeRepeated: false, halted: segments.some((s) => s.outcome === 'halt'), lostOrders: 0,
  });
  const noDrift = throughputRatio >= SOAK_MIN_THROUGHPUT_RATIO;
  const passed = segments.length > 0 && reliability >= SOAK_MIN_RELIABILITY && noDrift && disagreements === 0;
  return {
    seed, frequency, durationMs, segments, chaosSegments: segments.filter((s) => s.cell).length,
    reliability, grade, first, last, throughputRatio, disagreements, noDrift, passed,
  };
}

/** Deterministic JSON for the structure (timings come from the clock, so reports differ run to run). */
export function soakReportJson(r: SoakReport): string {
  return JSON.stringify(r, null, 2) + '\n';
}

export function renderSoak(r: SoakReport): string {
  return [
    `segments ${r.segments.length} (${r.chaosSegments} with chaos), reliability ${r.reliability}, grade ${r.grade}`,
    `throughput first ${r.first.throughputPerMin}/min, last ${r.last.throughputPerMin}/min, ratio ${r.throughputRatio} (${r.noDrift ? 'no drift' : 'DRIFT'})`,
    `journal and ledger disagreements ${r.disagreements}`,
    r.passed ? 'soak PASS' : 'soak FAIL',
  ].join('\n');
}

const calmCreature: CreaturePlugin = { id: 'calm', label: 'Calm', family: 'process', faults: ['none'], inject: () => undefined };

/** Live runner: a calm segment injects nothing; a chaos segment runs its creature fault via the cell adapter. */
export function createLiveSoakRunner(o: LiveCellOptions): RunSoakSegment {
  const cell = createLiveCellRunner({ ...o, creatures: [...o.creatures, calmCreature] });
  return (c, seed) => cell(c ?? { stage: 'create', creature: calmCreature.id, fault: 'none' }, seed);
}
