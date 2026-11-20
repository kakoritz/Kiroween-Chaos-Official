import { describe, expect, it } from 'vitest';
import { analyzeRamp, scalabilityGrade, type RampStep } from '../src/ramp';

const step = (concurrency: number, throughputPerMin: number, p95: number, errorRate = 0): RampStep => ({
  concurrency, throughputPerMin, p50: p95 / 2, p95, errorRate,
});

describe('ramp detection', () => {
  const steps = [
    step(1, 10, 100), step(2, 20, 110), step(4, 38, 150),
    step(8, 60, 250), step(16, 70, 900, 0.03), step(32, 20, 4000, 0.4),
  ];

  it('finds knee at 8 and break at 32 for the sample curve', () => {
    expect(analyzeRamp(steps)).toEqual({ knee: 8, breakPoint: 32 });
  });

  it('knee triggers on error rate above 2%', () => {
    expect(analyzeRamp([step(1, 10, 100), step(2, 20, 110, 0.05)]).knee).toBe(2);
  });

  it('break triggers on throughput below half of best so far', () => {
    expect(analyzeRamp([step(1, 10, 100), step(2, 40, 100), step(4, 15, 100)]).breakPoint).toBe(4);
  });

  it('flat curve has neither', () => {
    expect(analyzeRamp([step(1, 10, 100), step(2, 20, 120)])).toEqual({});
  });

  it('empty input is safe', () => {
    expect(analyzeRamp([])).toEqual({});
  });

  it('grades by knee against target', () => {
    expect(scalabilityGrade(8)).toBe('A');
    expect(scalabilityGrade(4)).toBe('B');
    expect(scalabilityGrade(2)).toBe('C');
    expect(scalabilityGrade(1)).toBe('D');
    expect(scalabilityGrade(undefined)).toBe('A');
    expect(scalabilityGrade(4, 4)).toBe('A');
  });
});
