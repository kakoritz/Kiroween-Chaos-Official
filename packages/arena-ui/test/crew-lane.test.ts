// covers: CP-U5
import { describe, expect, it } from 'vitest';
import { campaignOn, creditCount, gearBadge, gearBadgeTip, isCrewLane, isRival } from '../src/arena/crew-lane';
import { MIN_GAP_MS, canPlay } from '../src/sound';

const lanes = [{ tier: 'crew', parts: ['retry', 'journal', 'journal'] }, { tier: 'rookie' }, { tier: 'veteran' }];

describe('campaign lane styling (CP-U5)', () => {
  it('finds the Crew lane and ghosts only the rivals', () => {
    expect(campaignOn(lanes)).toBe(true);
    expect(isCrewLane(lanes[0]!)).toBe(true);
    expect(lanes.map((l) => isRival(l, lanes))).toEqual([false, true, true]);
  });
  it('leaves a normal wave alone', () => {
    const plain = [{ tier: 'rookie' }, { tier: 'veteran' }];
    expect(campaignOn(plain)).toBe(false);
    expect(plain.some((l) => isRival(l, plain))).toBe(false);
    expect(campaignOn([{ tier: 'crew' }])).toBe(false);
  });
  it('counts distinct gear parts, capped at five', () => {
    expect(gearBadge(lanes[0]!)).toBe('GEAR 2/5');
    expect(gearBadge({ tier: 'crew' })).toBe('GEAR 0/5');
    expect(gearBadge({ tier: 'crew', parts: ['a', 'b', 'c', 'd', 'e', 'f'] })).toBe('GEAR 5/5');
    expect(gearBadgeTip({ tier: 'crew' })).toMatch(/No gear/);
    expect(gearBadgeTip(lanes[0]!)).toMatch(/retry, journal/);
  });
  it('counts credits up, and shows the total at once under reduced motion', () => {
    expect(creditCount(300, 0, 1200, false)).toBe(0);
    expect(creditCount(300, 600, 1200, false)).toBeGreaterThan(150);
    expect(creditCount(300, 1200, 1200, false)).toBe(300);
    expect(creditCount(300, 10, 1200, true)).toBe(300);
  });
  it('rate limits the coin tick and the medal', () => {
    expect(MIN_GAP_MS.coin).toBeGreaterThan(0);
    expect(canPlay('medal', 100, { medal: 100 })).toBe(false);
    expect(canPlay('coin', 100 + MIN_GAP_MS.coin, { coin: 100 })).toBe(true);
  });
});
