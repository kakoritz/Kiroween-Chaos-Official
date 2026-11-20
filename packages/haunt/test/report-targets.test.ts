import { describe, expect, it } from 'vitest';
import { checkTargets, percentile, recoveryStats, targetsExitCode } from '../src/report';
import { gradeOf } from '../src/score';

const spec = { recoverMs: 20000, repeats: 0, throughputPerMin: 60, concurrency: 8 };

describe('recovery stats', () => {
  it('uses nearest-rank percentiles', () => {
    expect(percentile([], 95)).toBe(0);
    expect(recoveryStats([10, 20, 30, 40, 50])).toEqual({ count: 5, p50: 30, p95: 50, max: 50 });
  });
});

describe('target checks', () => {
  it('passes when all measurements meet targets', () => {
    const r = checkTargets(spec, { recoveryMs: [1000, 2000], repeats: 0, throughputPerMin: 90, kneeConcurrency: 8 });
    expect(r.map((x) => x.pass)).toEqual([true, true, true, true]);
    expect(targetsExitCode(r)).toBe(0);
  });

  it('fails slow recovery and repeats', () => {
    const r = checkTargets(spec, { recoveryMs: [5000, 30000], repeats: 2 });
    expect(r).toEqual([
      { name: 'recoverMs', value: 30000, target: 20000, pass: false },
      { name: 'repeats', value: 2, target: 0, pass: false },
    ]);
    expect(targetsExitCode(r)).toBe(1);
  });

  it('skips unmeasured throughput and concurrency', () => {
    expect(checkTargets(spec, { recoveryMs: [], repeats: 0 }).map((x) => x.name)).toEqual(['recoverMs', 'repeats']);
  });

  it('fails low throughput and early knee', () => {
    const r = checkTargets(spec, { recoveryMs: [1], repeats: 0, throughputPerMin: 30, kneeConcurrency: 4 });
    expect(r.filter((x) => !x.pass).map((x) => x.name)).toEqual(['throughputPerMin', 'concurrency']);
  });
});

describe('grading caps (A9 and halt)', () => {
  it('caps a lost order at D and a repeated charge at C', () => {
    const base = { orders: 10, clean: 10, parkedResumed: 0, quarantined: 0, extraRows: 0 };
    expect(gradeOf(base).grade).toBe('A');
    expect(gradeOf({ ...base, lostOrders: 1 }).grade).toBe('D');
    expect(gradeOf({ ...base, chargeRepeated: true }).grade).toBe('C');
    expect(gradeOf({ ...base, halted: true }).grade).toBe('D');
  });
});
