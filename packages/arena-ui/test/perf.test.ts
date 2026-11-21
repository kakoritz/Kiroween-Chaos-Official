import { describe, expect, it } from 'vitest';
import { FrameSampler, perfSecondsFromQuery } from '../src/perf';

describe('perf sampler', () => {
  it('parses ?perf', () => {
    expect(perfSecondsFromQuery('')).toBe(0);
    expect(perfSecondsFromQuery('?perf=20')).toBe(20);
    expect(perfSecondsFromQuery('?perf=0')).toBe(0);
    expect(perfSecondsFromQuery('?perf=abc')).toBe(0);
    expect(perfSecondsFromQuery('?perf=9999')).toBe(0);
  });

  it('summarises a steady 60 fps run and counts slow frames', () => {
    const s = new FrameSampler(0);
    for (let i = 0; i <= 120; i++) s.frame(i * (1000 / 60), 2, i < 60 ? 3 : 5);
    const r = s.summary();
    expect(r.frames).toBe(120);
    expect(r.fps).toBeCloseTo(60, 0);
    expect(r.over20ms).toBe(0);
    expect(r.workMsAvg).toBe(2);
    expect(r.lanesMax).toBe(5);
    s.frame(120 * (1000 / 60) + 50, 9, 5);
    expect(s.summary().over20ms).toBe(1);
    expect(s.summary().frameMsMax).toBe(50);
  });

  it('skips warmup frames', () => {
    const s = new FrameSampler(10);
    for (let i = 0; i < 50; i++) s.frame(i * 16, 1, 1);
    expect(s.count).toBe(39);
  });
});
