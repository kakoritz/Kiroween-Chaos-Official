// Target checks and recovery stats. Spec: engine design.md section 8 (Recovery time, report fields), tasks.md H4.1.

export interface TargetSpec {
  recoverMs: number;
  repeats: number;
  throughputPerMin?: number;
  concurrency?: number;
}

export interface TargetResult {
  name: string;
  value: number;
  target: number;
  pass: boolean;
}

export interface RecoveryStats {
  count: number;
  p50: number;
  p95: number;
  max: number;
}

export interface TargetMeasurements {
  /** Recovery times in ms (chaos or process_dead to next stage_done). */
  recoveryMs: number[];
  /** Extra ledger rows beyond one per side effect. */
  repeats: number;
  throughputPerMin?: number;
  /** Knee concurrency from the ramp, if one was found. */
  kneeConcurrency?: number;
}

/** Nearest-rank percentile. Empty input gives 0. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export function recoveryStats(recoveryMs: number[]): RecoveryStats {
  return {
    count: recoveryMs.length,
    p50: percentile(recoveryMs, 50),
    p95: percentile(recoveryMs, 95),
    max: recoveryMs.length === 0 ? 0 : Math.max(...recoveryMs),
  };
}

/**
 * Evaluate the declared targets. A target is checked only when the matching measurement exists:
 * throughput and concurrency are skipped when not measured, so a sweep-only report does not fail them.
 */
export function checkTargets(spec: TargetSpec, m: TargetMeasurements): TargetResult[] {
  const out: TargetResult[] = [];
  const stats = recoveryStats(m.recoveryMs);
  out.push({ name: 'recoverMs', value: stats.p95, target: spec.recoverMs, pass: stats.p95 <= spec.recoverMs });
  out.push({ name: 'repeats', value: m.repeats, target: spec.repeats, pass: m.repeats <= spec.repeats });
  if (spec.throughputPerMin !== undefined && m.throughputPerMin !== undefined) {
    out.push({
      name: 'throughputPerMin',
      value: m.throughputPerMin,
      target: spec.throughputPerMin,
      pass: m.throughputPerMin >= spec.throughputPerMin,
    });
  }
  if (spec.concurrency !== undefined && m.kneeConcurrency !== undefined) {
    out.push({
      name: 'concurrency',
      value: m.kneeConcurrency,
      target: spec.concurrency,
      pass: m.kneeConcurrency >= spec.concurrency,
    });
  }
  return out;
}

/** CI exit code: 0 when every target passes, 1 otherwise. */
export function targetsExitCode(results: TargetResult[]): 0 | 1 {
  return results.every((r) => r.pass) ? 0 : 1;
}
