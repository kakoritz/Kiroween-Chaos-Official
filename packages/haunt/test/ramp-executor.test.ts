import { describe, expect, it } from 'vitest';
import { percentile, runRamp, summarizeStep, type RunRampStep } from '../src/ramp';

// Simulated app: latency grows past concurrency 8 and orders start failing at 32.
const sim: RunRampStep = (c, orders) => {
  const base = 100 * (c > 8 ? c / 4 : 1);
  const failed = c >= 32 ? Math.floor(orders * 0.4) : c >= 16 ? 1 : 0;
  const latenciesMs = Array.from({ length: orders - failed }, (_, i) => base + (i % 5) * 10);
  const durationMs = (orders / Math.min(c, 12)) * base;
  return { latenciesMs, failed, durationMs };
};

describe('ramp executor', () => {
  it('percentile uses nearest rank', () => {
    expect(percentile([], 95)).toBe(0);
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5);
  });

  it('summarizes a step', () => {
    const s = summarizeStep(2, { latenciesMs: [100, 200], failed: 2, durationMs: 60000 }, 4);
    expect(s).toEqual({ concurrency: 2, throughputPerMin: 2, p50: 100, p95: 200, errorRate: 0.5 });
  });

  it('runs the default steps and finds a knee, a break point and a grade', async () => {
    const r = await runRamp(sim, { seed: 3 });
    expect(r.steps.map((s) => s.concurrency)).toEqual([1, 2, 4, 8, 16, 32]);
    expect(r.ordersPerStep).toBe(30);
    expect(r.knee).toBe(16);
    expect(r.breakPoint).toBe(16);
    expect(r.grade).toBe('A');
  });

  it('grades against the target', async () => {
    const r = await runRamp(sim, { target: 64 });
    expect(r.grade).toBe('C');
  });

  it('is deterministic for the same seed and passes distinct step seeds', async () => {
    const seen: number[] = [];
    const rec: RunRampStep = (c, o, seed) => { seen.push(seed); return sim(c, o, seed); };
    const a = await runRamp(rec, { seed: 9 });
    const b = await runRamp(sim, { seed: 9 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(new Set(seen).size).toBe(6);
  });

  it('counts a thrown step as all orders failed', async () => {
    const r = await runRamp(() => { throw new Error('boom'); }, { steps: [1, 2], ordersPerStep: 4 });
    expect(r.steps.every((s) => s.errorRate === 1)).toBe(true);
    expect(r.knee).toBe(1);
  });
});
