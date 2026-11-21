import { describe, expect, it } from 'vitest';
import { DRESSING, GEAR_ITEMS, TIER_IDS, TIER_LABEL } from '../src/rig/dress';

describe('tier dressings', () => {
  it('defines the five tiers in ladder order with labels', () => {
    expect(TIER_IDS).toEqual(['rookie', 'retrier', 'journaler', 'reconciler', 'phoenix']);
    for (const t of TIER_IDS) expect(TIER_LABEL[t].length).toBeGreaterThan(0);
  });

  it('gives every tier a distinct look', () => {
    const keys = TIER_IDS.map((t) => [...DRESSING[t]].sort().join(','));
    expect(new Set(keys).size).toBe(5);
  });

  it('rookie has no gear and the signature cracked skull, big socket and note', () => {
    expect(DRESSING.rookie).toEqual(expect.arrayContaining(['crack', 'bigSocket', 'note']));
    for (const g of GEAR_ITEMS) expect(DRESSING.rookie).not.toContain(g);
  });

  it('matches the art direction table', () => {
    expect(DRESSING.retrier).toEqual(expect.arrayContaining(['lantern', 'brow']));
    expect(DRESSING.journaler).toEqual(expect.arrayContaining(['book', 'glasses']));
    expect(DRESSING.reconciler).toEqual(expect.arrayContaining(['book', 'medal', 'bowtie']));
    expect(DRESSING.phoenix).toEqual(expect.arrayContaining([...GEAR_ITEMS, 'grin']));
  });

  it('phoenix carries all five gear pieces', () => {
    for (const g of GEAR_ITEMS) expect(DRESSING.phoenix).toContain(g);
  });
});
