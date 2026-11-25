// covers: tournament-stall/R3.1, tournament-stall/R3.2
import { describe, expect, it } from 'vitest';
import { FIXTURES } from '../src/sim/fixtures';
import { demoFillerTimes, fixtureFor } from '../src/mock/play';

const chaosTimes = (name: string, filler: number[]): number[] => {
  const ev = FIXTURES[name]!();
  const t0 = ev[0]!.ts;
  return [0, ...ev.filter((e) => e.type === 'chaos' || e.type === 'boss_start').map((e) => e.ts - t0), ...filler, ev[ev.length - 1]!.ts - t0].sort((a, b) => a - b);
};

describe('hosted demo filler', () => {
  it('R3.1 leaves no stretch over 5 s without a creature in hero, full and loop', () => {
    for (const s of ['hero', 'full', 'loop']) {
      const name = fixtureFor(s)!;
      const filler = demoFillerTimes(FIXTURES[name]!());
      const marks = chaosTimes(name, filler);
      const worst = Math.max(...marks.slice(1).map((t, i) => t - marks[i]!));
      expect(worst, `${s}: longest quiet stretch ${worst} ms`).toBeLessThanOrEqual(5000);
    }
  });

  it('R3.1 adds nothing to a recording that is never quiet', () => {
    const evs = [0, 2000, 4000, 6000].map((ts) => ({ type: 'chaos', ts }));
    expect(demoFillerTimes(evs)).toEqual([]);
    expect(demoFillerTimes([])).toEqual([]);
  });
});
