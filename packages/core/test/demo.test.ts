import { describe, expect, it } from 'vitest';
import { DEMO_NAMES, loadDemo, validateDemo } from '../src/live/demo';

describe('demo scripts', () => {
  for (const n of DEMO_NAMES) {
    it(`${n} loads and validates`, () => {
      const d = loadDemo(n);
      expect(d.name).toBe(n);
      expect(d.pace).toBe('slow');
    });
  }
  it('hero presses lanes 1 and 5 with a crash', () => {
    expect(loadDemo('hero').presses.map((p) => [p.lane, p.fault])).toEqual([[1, 'crash'], [5, 'crash']]);
  });
  it('full has a power-outage boss', () => {
    expect(loadDemo('full').boss?.id).toBe('boss_power_outage');
  });
  it('rejects bad scripts', () => {
    const ok = loadDemo('hero');
    expect(() => validateDemo({ ...ok, presses: [{ atMs: 1, lane: 9, fault: 'crash', creature: 'reaper' }] })).toThrow(/lane/);
    expect(() => validateDemo({ ...ok, presses: [{ atMs: 1, lane: 1, fault: 'nope', creature: 'x' }] })).toThrow(/unknown fault/);
    expect(() => loadDemo('nope')).toThrow(/unknown demo/);
  });
});
