// Ramp executor: runs each concurrency step through an injected runner and builds a deterministic report.
import { analyzeRamp, scalabilityGrade, type RampAnalysis, type RampStep, type ScalabilityGrade } from './detect';

export const DEFAULT_RAMP_STEPS = [1, 2, 4, 8, 16, 32] as const;
export const DEFAULT_ORDERS_PER_STEP = 30;

/** What one step produced: per-order latency and success, plus the step's wall time. */
export interface RampStepRun {
  latenciesMs: number[];
  failed: number;
  durationMs: number;
}

/** Runs `orders` orders with `concurrency` in flight on one lane, no chaos. Supplied by the runner adapter. */
export type RunRampStep = (concurrency: number, orders: number, seed: number) => Promise<RampStepRun> | RampStepRun;

export interface RampOptions {
  steps?: readonly number[];
  ordersPerStep?: number;
  seed?: number;
  /** Target knee concurrency (targets.concurrency in haunt.yaml). */
  target?: number;
}

export interface RampReport extends RampAnalysis {
  seed: number;
  ordersPerStep: number;
  target: number;
  steps: RampStep[];
  grade: ScalabilityGrade;
}

/** Nearest-rank percentile of a sample; 0 for an empty sample. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export function summarizeStep(concurrency: number, run: RampStepRun, orders: number): RampStep {
  const done = run.latenciesMs.length;
  const total = Math.max(orders, done + run.failed);
  const minutes = run.durationMs / 60000;
  return {
    concurrency,
    throughputPerMin: minutes > 0 ? Math.round(((done / minutes) + Number.EPSILON) * 100) / 100 : 0,
    p50: percentile(run.latenciesMs, 50),
    p95: percentile(run.latenciesMs, 95),
    errorRate: total > 0 ? run.failed / total : 0,
  };
}

/** Derives a per-step seed so the same ramp seed replays the same orders. */
export function stepSeed(seed: number, index: number): number {
  return (Math.imul(seed >>> 0, 2654435761) + Math.imul(index + 1, 40503)) >>> 0;
}

export async function runRamp(runStep: RunRampStep, opts: RampOptions = {}): Promise<RampReport> {
  const concurrencies = opts.steps ?? DEFAULT_RAMP_STEPS;
  const ordersPerStep = opts.ordersPerStep ?? DEFAULT_ORDERS_PER_STEP;
  const seed = opts.seed ?? 1;
  const target = opts.target ?? 8;
  const steps: RampStep[] = [];
  for (let i = 0; i < concurrencies.length; i++) {
    let run: RampStepRun;
    try {
      run = await runStep(concurrencies[i], ordersPerStep, stepSeed(seed, i));
    } catch {
      run = { latenciesMs: [], failed: ordersPerStep, durationMs: 0 };
    }
    steps.push(summarizeStep(concurrencies[i], run, ordersPerStep));
  }
  const analysis = analyzeRamp(steps);
  return { seed, ordersPerStep, target, steps, ...analysis, grade: scalabilityGrade(analysis.knee, target) };
}
