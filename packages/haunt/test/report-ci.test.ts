import { describe, expect, it } from 'vitest';
import { ciExitCode, rampTargets, renderTargetLines, stackTargets, sweepTargets } from '../src/report/ci';
import type { RampReport } from '../src/ramp/executor';
import type { StackReport } from '../src/stack';
import type { SweepReport } from '../src/sweep/executor';

const spec = { recoverMs: 20000, repeats: 0, concurrency: 8 };
const totals = (repeat: number) => ({ pass: 3, repeat, recovered_late: 0, fail: 1, halt: 0, 'n/a': 0, pending: 0 });
const sweep = (repeat: number) => ({ matrix: { totals: totals(repeat) } }) as unknown as SweepReport;

describe('CI gate', () => {
  it('sweep exits 0 with no repeats (FAILED cells alone do not gate) and 1 with a repeat', () => {
    expect(ciExitCode(sweepTargets(spec, sweep(0)))).toBe(0);
    const bad = sweepTargets(spec, sweep(2));
    expect(ciExitCode(bad)).toBe(1);
    expect(renderTargetLines(bad)).toContain('FAIL repeats: 2');
  });

  it('stack counts repeat cells', () => {
    const r = { cells: [{ outcome: 'pass' }, { outcome: 'repeat' }] } as unknown as StackReport;
    expect(ciExitCode(stackTargets(spec, r))).toBe(1);
    expect(ciExitCode(stackTargets({ ...spec, repeats: 1 }, r))).toBe(0);
  });

  it('ramp gates on the knee against the concurrency target', () => {
    const ramp = (knee: number | undefined) => ({ knee, steps: [{ concurrency: 1 }, { concurrency: 4 }] }) as unknown as RampReport;
    expect(ciExitCode(rampTargets(spec, ramp(2)))).toBe(1);
    expect(ciExitCode(rampTargets({ ...spec, concurrency: 4 }, ramp(undefined)))).toBe(0);
  });
});
