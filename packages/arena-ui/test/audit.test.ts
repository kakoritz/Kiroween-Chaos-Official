import { describe, expect, it } from 'vitest';
import { newLane } from '../src/arena/model';
import { canonKind, cellView, HEAD_H, ledgerHeader, ROW_H } from '../src/arena/panels';
import { laneCards, summaryHasOrders } from '../src/arena/laps-model';
import { creaturesHtml, GEAR_PARTS, gearTip, LEGEND_TABS, legendHtml } from '../src/arena/legend-modal';
import { laneMessage } from '../src/arena/lanes-ticker';
import { CREATURES } from '../src/creatures/defs';

describe('ledger columns (UI audit)', () => {
  it('folds the provider kinds account and reply into Accounts and Emails', () => {
    expect(canonKind('account')).toBe('account_create');
    expect(canonKind('reply')).toBe('email');
    expect(canonKind('charge')).toBe('charge');
  });
  it('sums rows and repeats of kinds that share a column', () => {
    const l = newLane(1, 0, 0);
    l.ledger = { account_create: { rows: 2, repeats: 0 }, account: { rows: 3, repeats: 1 } } as never;
    expect(cellView(l, 'account_create')).toMatchObject({ rows: 5, repeats: 1, dup: true, text: '5 +1' });
  });
  it('uses short headers so nine columns fit and keeps unknown names as they are', () => {
    expect(ledgerHeader('Orders')).toBe('Placed');
    expect(ledgerHeader('Shipments')).toBe('Ships');
    expect(ledgerHeader('Charges')).toBe('Charges');
  });
  it('five rank rows plus the head fit the 168 px body', () => {
    expect(HEAD_H + 5 * ROW_H).toBeLessThanOrEqual(168);
  });
});

describe('wave end card (UI audit)', () => {
  it('an empty wave has no end card, a wave with one finished order does', () => {
    expect(summaryHasOrders({ 1: { orders: { done: 0, cancelled: 0 } }, 2: {} })).toBe(false);
    expect(summaryHasOrders({ 1: { orders: { done: 0 } }, 2: { orders: { cancelled: 1 } } })).toBe(true);
    expect(summaryHasOrders(null)).toBe(false);
  });
  it('a lane without reviews shows no rating title', () => {
    const [c] = laneCards({ 1: { rating: 'Cursed', stars: { sum: 0, max: 0 } } }, ['a'], new Map(), () => 'x');
    expect(c!.rating).toBe('');
  });
});

describe('legend tabs and ticker icons (UI audit)', () => {
  it('has Gear, Chips and Creatures tabs and one pane for each', () => {
    expect(LEGEND_TABS.map((t) => t.id)).toEqual(['gear', 'chips', 'creatures']);
    const html = legendHtml();
    for (const t of LEGEND_TABS) { expect(html).toContain(`data-tab="${t.id}"`); expect(html).toContain(`data-pane="${t.id}"`); }
  });
  it('lists every creature with what it does', () => {
    const html = creaturesHtml();
    for (const c of CREATURES) { expect(html).toContain(c.name); expect(html).toContain(c.does); }
  });
  it('gear hover tips name the part and say whether the tier has it', () => {
    for (const p of GEAR_PARTS) {
      expect(gearTip(p, true)).toContain(p.name);
      expect(gearTip(p, false)).toContain('Add this part');
    }
  });
  it('the review ticker line does not repeat the star in its icon', () => {
    const m = laneMessage({ seq: 1, ts: 0, type: 'review', wave: 1, lane: 1, detail: { stars: 5, text: 'ok' } } as never, (s) => s);
    expect(m?.icon).not.toBe('★');
    expect(m?.text.startsWith('★')).toBe(true);
  });
});
