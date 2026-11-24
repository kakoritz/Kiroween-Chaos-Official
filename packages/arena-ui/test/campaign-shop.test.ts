import { describe, expect, it } from 'vitest';
import { buy, equip, equipAll, equippedParts, loadShop, nextSlot, reset, saveShop, slotsFor, tooltip, unequip, EQUIP_KEY, type ShopGear, type ShopState } from '../src/campaign/shop-model';
import { STORAGE_KEY } from '../src/campaign/hub-model';
import data from '../../core/campaign/gear.json';

const gear = data.items as ShopGear[];
const start = data.start;
const fresh = (): ShopState => ({ credits: 300, owned: [], equipped: {} });
const memory = (init: Record<string, string> = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };

describe('gear shop model', () => {
  it('buys with credits and refuses when short or duplicated', () => {
    const r = buy(fresh(), gear, 'lantern');
    expect(r.ok && r.state.credits).toBe(100);
    expect(r.ok && r.state.owned).toEqual(['lantern']);
    const again = buy(r.state, gear, 'lantern');
    expect(again.ok).toBe(false);
    const poor = buy(fresh(), gear, 'shield');
    expect(poor.ok).toBe(false);
    expect(!poor.ok && poor.reason).toContain('costs 500');
    expect(buy(fresh(), gear, 'nope').ok).toBe(false);
  });

  it('equips only owned gear on its own slot', () => {
    const owned: ShopState = { credits: 0, owned: ['seal'], equipped: {} };
    expect(equip(fresh(), gear, 'seal', 'idempotency').ok).toBe(false);
    expect(equip(owned, gear, 'seal', 'retry').ok).toBe(false);
    const ok = equip(owned, gear, 'seal', 'idempotency');
    expect(ok.ok && ok.state.equipped).toEqual({ idempotency: 'seal' });
  });

  it('equip all, unequip and reset keep ownership', () => {
    const s: ShopState = { credits: 0, owned: ['lantern', 'seal'], equipped: {} };
    const all = equipAll(s, gear);
    expect(equippedParts(all, gear)).toEqual(['retry', 'idempotency']);
    expect(equippedParts(unequip(all, 'retry'), gear)).toEqual(['idempotency']);
    const r = reset(all);
    expect(r.equipped).toEqual({});
    expect(r.owned).toEqual(['lantern', 'seal']);
  });

  it('writes plain-word tooltips with price or ownership', () => {
    const t = tooltip(gear[0], false);
    expect(t).toContain('Lantern');
    expect(t).toContain('Blocks:');
    expect(t).toContain('Costs 200 credits.');
    expect(tooltip(gear[0], true)).toContain('You own it.');
  });

  it('moves keyboard focus across slots within bounds', () => {
    const slots = slotsFor(gear);
    expect(slots).toHaveLength(5);
    expect(nextSlot(slots, 0, 'ArrowUp')).toBe(0);
    expect(nextSlot(slots, 0, 'ArrowDown')).toBe(1);
    expect(nextSlot(slots, 4, 'ArrowRight')).toBe(4);
    expect(nextSlot(slots, 2, 'End')).toBe(4);
    expect(nextSlot(slots, 2, 'x')).toBe(2);
  });

  it('treats a stored record with no credits, gear or medals as a fresh save', () => {
    const st = memory({ [STORAGE_KEY]: JSON.stringify({ credits: 0, owned: [], medals: {}, best: {} }) });
    const s = loadShop(st, gear, start);
    expect(s.credits).toBe(300);
    expect(buy(s, gear, 'seal').ok).toBe(true);
  });

  it('starts new players with the start credits and persists purchases', () => {
    const st = memory();
    const s = loadShop(st, gear, start);
    expect(s.credits).toBe(300);
    expect(s.owned).toEqual([]);
    const bought = buy(s, gear, 'spellbook');
    if (!bought.ok) throw new Error('buy failed');
    const eq = equip(bought.state, gear, 'spellbook', 'journal');
    if (!eq.ok) throw new Error('equip failed');
    saveShop(st, eq.state);
    const back = loadShop(st, gear, start);
    expect(back.credits).toBe(0);
    expect(back.owned).toEqual(['spellbook']);
    expect(back.equipped).toEqual({ journal: 'spellbook' });
  });

  it('keeps medals when saving and ignores bad stored data', () => {
    const st = memory({ [STORAGE_KEY]: JSON.stringify({ credits: 50, owned: ['ghost', 'lantern'], medals: { '1': 'gold' }, best: { '1': 900 } }), [EQUIP_KEY]: JSON.stringify({ retry: 'seal', journal: 'lantern' }) });
    const s = loadShop(st, gear, start);
    expect(s.owned).toEqual(['lantern']);
    expect(s.equipped).toEqual({});
    saveShop(st, { ...s, credits: 10 });
    const saved = JSON.parse(st.m.get(STORAGE_KEY)!);
    expect(saved.medals).toEqual({ '1': 'gold' });
    expect(saved.best).toEqual({ '1': 900 });
    expect(saved.credits).toBe(10);
    // unreadable data holds no credits, gear or medals, so it counts as a fresh save and gets the start credits (was 0, which left night 1 with nothing affordable)
    expect(loadShop(memory({ [STORAGE_KEY]: '{bad', [EQUIP_KEY]: '[[' }), gear, start).credits).toBe(300);
  });
});
