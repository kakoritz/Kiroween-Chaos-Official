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
  it('hero keeps the story crash on Rookie and Phoenix and sends every lane a procession of creatures', () => {
    const h = loadDemo('hero');
    expect(h.presses.slice(0, 2).map((p) => [p.lane, p.fault])).toEqual([[1, 'crash'], [5, 'crash']]);
    for (const lane of [1, 2, 3, 4, 5]) expect(new Set(h.presses.filter((p) => p.lane === lane).map((p) => p.creature)).size).toBeGreaterThan(2);
    const payment = (lane: number) => h.presses.filter((p) => p.lane === lane && p.when?.stage === 'payment').map((p) => p.fault);
    expect(payment(1)).toEqual(['crash']);
    expect(payment(5)).toEqual(['crash']);
    expect(h.boss).toBeDefined();
    const kinds = new Set(h.presses.map((p) => p.creature));
    for (const k of ['ghost', 'zombie', 'witch', 'reaper', 'will_o_wisp', 'banshee', 'imp', 'gargoyle']) expect(kinds.has(k), k).toBe(true);
  });
  it('full sends every lane several creature kinds', () => {
    const f = loadDemo('full');
    for (const lane of [1, 2, 3, 4, 5]) expect(new Set(f.presses.filter((p) => p.lane === lane).map((p) => p.creature)).size).toBeGreaterThan(2);
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
