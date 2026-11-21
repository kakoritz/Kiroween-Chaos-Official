// CI gate: turns a sweep, stack or ramp report into target results and an exit code.
// Exit codes: 0 all targets pass, 1 a target failed, 2 usage or config error (set by the CLI).
// Spec: harness requirements H5.7 (the CLI exits non-zero when targets fail), tasks.md H4.4.
import type { RampReport } from '../ramp/executor';
import type { SoakReport } from '../soak';
import type { StackReport } from '../stack';
import type { SweepReport } from '../sweep/executor';
import { checkTargets, targetsExitCode, type TargetResult, type TargetSpec } from './targets';

export const EXIT_OK = 0;
export const EXIT_TARGET_FAIL = 1;
export const EXIT_USAGE = 2;

/** Sweep: repeated side effects are the measured value. Recovery time is not measured by a sweep. */
export function sweepTargets(spec: TargetSpec, r: SweepReport): TargetResult[] {
  return checkTargets(spec, { recoveryMs: [], repeats: r.matrix.totals.repeat });
}

/** Stack: a depth that repeats a side effect counts against the repeats target. */
export function stackTargets(spec: TargetSpec, r: StackReport): TargetResult[] {
  return checkTargets(spec, { recoveryMs: [], repeats: r.cells.filter((c) => c.outcome === 'repeat').length });
}

/** Soak: a side effect repeated or an order lost in any segment counts against the repeats target. Drift and reliability are in the report's passed flag. */
export function soakTargets(spec: TargetSpec, r: SoakReport): TargetResult[] {
  const base = checkTargets(spec, { recoveryMs: [], repeats: r.disagreements }).filter((t) => t.name === 'repeats');
  return [...base, { name: 'soakDrift', value: r.throughputRatio, target: 0.8, pass: r.noDrift && r.reliability >= 90 }];
}

/** Ramp: the knee must reach the concurrency target. No knee up to the last step counts as the last step. */
export function rampTargets(spec: TargetSpec, r: RampReport): TargetResult[] {
  const last = r.steps.length === 0 ? 0 : r.steps[r.steps.length - 1].concurrency;
  const results = checkTargets(spec, { recoveryMs: [], repeats: 0, kneeConcurrency: r.knee ?? last });
  return results.filter((t) => t.name === 'concurrency');
}

export function ciExitCode(results: TargetResult[]): 0 | 1 {
  return targetsExitCode(results);
}

/** One line per target for the CLI and CI logs. */
export function renderTargetLines(results: TargetResult[]): string {
  return results.map((t) => `${t.pass ? 'PASS' : 'FAIL'} ${t.name}: ${t.value} (target ${t.name === 'concurrency' ? '>=' : t.name === 'repeats' || t.name === 'recoverMs' ? '<=' : '>='} ${t.target})`).join('\n');
}
