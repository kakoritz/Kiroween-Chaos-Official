import { describe, expect, it } from 'vitest';
import { runSoak, soakRng } from '../src/soak';
import { soakTargets } from '../src/report/ci';
import type { SweepCell } from '../src/sweep/matrix';

const cells: SweepCell[] = [{ stage: 'pay', creature: 'reaper', fault: 'crash' }, { stage: 'ship', creature: 'ghoul', fault: 'dup' }];
const spec = { recoverMs: 1000, repeats: 0, throughputPerMin: 0, concurrency: 1 } as never;

/** Fake clock: each segment advances time by `step` ms (a function so drift can be simulated). */
function clock(step: (i: number) => number) {
  let t = 0; let i = 0;
  return { now: () => t, run: (c: SweepCell | null) => { t += step(i++); return c ? ('recovered_late' as const) : ('pass' as const); } };
}

describe('soak', () => {
  it('is deterministic for a seed', async () => {
    const a = clock(() => 1000); const b = clock(() => 1000);
    const ra = await runSoak(a.run, { durationMs: 60000, seed: 5, cells, now: a.now });
    const rb = await runSoak(b.run, { durationMs: 60000, seed: 5, cells, now: b.now });
    expect(ra).toEqual(rb);
    expect(soakRng(1)()).toBe(soakRng(1)());
  });

  it('draws chaos near the requested frequency', async () => {
    const a = clock(() => 100);
    const r = await runSoak(a.run, { durationMs: 100000, frequency: 0.3, seed: 2, cells, now: a.now });
    expect(r.chaosSegments / r.segments.length).toBeGreaterThan(0.2);
    expect(r.chaosSegments / r.segments.length).toBeLessThan(0.4);
  });

  it('passes a steady run', async () => {
    const a = clock(() => 1000);
    const r = await runSoak(a.run, { durationMs: 90000, seed: 1, cells, now: a.now });
    expect(r.passed).toBe(true);
    expect(r.throughputRatio).toBeGreaterThanOrEqual(0.8);
    expect(soakTargets(spec, r).every((t) => t.pass)).toBe(true);
  });

  it('flags throughput drift', async () => {
    const a = clock((i) => 1000 + i * 100);
    const r = await runSoak(a.run, { durationMs: 60000, frequency: 0, seed: 1, cells, now: a.now });
    expect(r.noDrift).toBe(false);
    expect(r.passed).toBe(false);
    expect(soakTargets(spec, r).some((t) => !t.pass)).toBe(true);
  });

  it('fails when a side effect repeats', async () => {
    let t = 0;
    const r = await runSoak(() => { t += 1000; return { outcome: 'pass', repeatedKinds: ['charge'] }; }, { durationMs: 10000, seed: 1, cells, now: () => t });
    expect(r.disagreements).toBeGreaterThan(0);
    expect(r.passed).toBe(false);
  });

  it('fails below 90 reliability', async () => {
    let t = 0; let n = 0;
    const r = await runSoak(() => { t += 1000; return n++ % 2 ? 'fail' : 'pass'; }, { durationMs: 20000, seed: 1, cells, now: () => t });
    expect(r.reliability).toBeLessThan(90);
    expect(r.passed).toBe(false);
  });

  it('counts a thrown segment as fail', async () => {
    let t = 0;
    const r = await runSoak(() => { t += 1000; throw new Error('boom'); }, { durationMs: 3000, seed: 1, cells, now: () => t });
    expect(r.segments.every((s) => s.outcome === 'fail' && s.error === 'boom')).toBe(true);
  });
});
