// Ramp analysis: knee, break point and scalability grade. Spec: engine design.md (Ramp), tasks.md H3.4.

export interface RampStep {
  concurrency: number;
  throughputPerMin: number;
  p50: number;
  p95: number;
  errorRate: number;
}

export interface RampAnalysis {
  /** Concurrency of the first step meeting a knee rule, if any. */
  knee?: number;
  /** Concurrency of the first step meeting a break rule, if any. */
  breakPoint?: number;
}

export type ScalabilityGrade = 'A' | 'B' | 'C' | 'D';

const KNEE_LATENCY_FACTOR = 2;
const KNEE_ERROR_RATE = 0.02;
const BREAK_ERROR_RATE = 0.2;
const BREAK_THROUGHPUT_FRACTION = 0.5;

/** Knee: first step where p95 > 2 x step-1 p95, or error rate > 2%. */
export function findKnee(steps: RampStep[]): number | undefined {
  if (steps.length === 0) return undefined;
  const base = steps[0].p95;
  for (const s of steps) {
    if (s.p95 > KNEE_LATENCY_FACTOR * base || s.errorRate > KNEE_ERROR_RATE) return s.concurrency;
  }
  return undefined;
}

/** Break point: first step where error rate > 20% or throughput < 50% of the best step so far. */
export function findBreakPoint(steps: RampStep[]): number | undefined {
  if (steps.length === 0) return undefined;
  let best = 0;
  for (const s of steps) {
    if (s.errorRate > BREAK_ERROR_RATE || s.throughputPerMin < BREAK_THROUGHPUT_FRACTION * best) return s.concurrency;
    best = Math.max(best, s.throughputPerMin);
  }
  return undefined;
}

export function analyzeRamp(steps: RampStep[]): RampAnalysis {
  const out: RampAnalysis = {};
  const knee = findKnee(steps);
  const brk = findBreakPoint(steps);
  if (knee !== undefined) out.knee = knee;
  if (brk !== undefined) out.breakPoint = brk;
  return out;
}

/** Grade from knee concurrency vs target: >= target A; >= target/2 B; >= target/4 C; else D. No knee is A. */
export function scalabilityGrade(knee: number | undefined, target = 8): ScalabilityGrade {
  if (knee === undefined) return 'A';
  if (knee >= target) return 'A';
  if (knee >= target / 2) return 'B';
  if (knee >= target / 4) return 'C';
  return 'D';
}
