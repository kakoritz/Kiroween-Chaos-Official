import { describe, expect, it } from 'vitest';
import { ANCHOR } from '../src/campaign/shop';
import data from '../../core/campaign/gear.json';

// The doll's limbs span x 30..170 of a 200-wide box (15%..85%). Slot rings are 72px on a doll box about 373px wide (~19%).
describe('gear shop slot anchors', () => {
  it('has an anchor for every gear part', () => {
    for (const g of data.items) expect(ANCHOR[g.part], g.part).toBeDefined();
  });
  it('keeps every slot ring and label clear of the doll body and limbs', () => {
    for (const [part, [x]] of Object.entries(ANCHOR)) expect(x < 15 - 9.5 || x > 85 + 9.5, part).toBe(true);
  });
  it('keeps slots in the same column far enough apart that labels do not overlap the next ring', () => {
    const cols = new Map<number, number[]>();
    for (const [x, y] of Object.values(ANCHOR)) cols.set(x, [...(cols.get(x) ?? []), y]);
    for (const ys of cols.values()) { ys.sort((a, b) => a - b); for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(20); }
  });
});
// covers: CP-E2E
