// covers: T13, V14 (tournament-v3: swarms shoo and dissipate)
import { describe, expect, it } from 'vitest';
import { MAX_BUGS, bugCount, puff, seedOf, swarmBugs, swarmStale } from '../src/arena/swarm';

const base = { depth: 1, seed: 7, age: 1200, exit: 0 };

describe('swarm model', () => {
  it('grows with depth and attempts, between 3 and 9', () => {
    expect(bugCount(1)).toBe(3);
    expect(bugCount(3)).toBe(7);
    expect(bugCount(9, 5)).toBe(MAX_BUGS);
    expect(bugCount(1, 2)).toBe(5);
  });
  it('is stable for the same input', () => {
    expect(swarmBugs(base)).toEqual(swarmBugs(base));
  });
  it('orbits close to the skeleton while the problem is open', () => {
    for (const g of swarmBugs(base)) { expect(Math.hypot(g.x, g.y)).toBeLessThan(70); expect(g.a).toBe(1); }
  });
  it('dissipates: every bug is gone when the exit completes', () => {
    const gone = swarmBugs({ ...base, exit: 1 });
    expect(gone.every((g) => g.a <= 0.001)).toBe(true);
    const mid = swarmBugs({ ...base, exit: 0.5 });
    expect(mid.some((g) => g.a > 0 && g.a < 1)).toBe(true);
  });
  it('a corpse swarm lingers dimmed and does not peck', () => {
    for (const g of swarmBugs({ ...base, corpse: true })) { expect(g.a).toBeLessThan(0.5); expect(g.peck).toBe(0); }
  });
  it('puff plays only while exiting', () => {
    expect(puff(0)).toBeNull();
    expect(puff(1)).toBeNull();
    expect(puff(0.5)!.r).toBeGreaterThan(14);
  });
  it('a swarm is never stuck: stale after 45 s once the lane is quiet', () => {
    expect(swarmStale(46000, 1, true)).toBe(true);
    expect(swarmStale(46000, 1, false)).toBe(false);
    expect(swarmStale(10000, 1, true)).toBe(false);
    expect(seedOf('imp', 100)).toBe(seedOf('imp', 100));
  });
});
