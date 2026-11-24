// covers: playtest-v2/R5.2
import { describe, expect, it } from 'vitest';
import { cardOf, ghostMood, laneRatingTitle } from '../src/arena/review-card';

describe('PT-U7 review card model', () => {
  it('maps stars to ghost mood', () => {
    expect(ghostMood(5)).toBe('delighted');
    expect(ghostMood(4)).toBe('neutral');
    expect(ghostMood(3)).toBe('neutral');
    expect(ghostMood(2)).toBe('angry');
    expect(ghostMood(1)).toBe('angry');
  });
  it('builds a card with tone, half stars and sub bars', () => {
    const c = cardOf(2, { order: 'o1', stars: 3.5, sub: { timeliness: 4, delays: 3, issues: 5, delivery: 2, ease: 4 }, text: 'Slow but fine' });
    expect(c).not.toBeNull();
    expect(c!.tone).toBe('amber');
    expect(c!.num).toBe('3.5');
    expect(c!.sub).toHaveLength(5);
    expect(c!.sub[0]!.pct).toBe(80);
  });
  it('shows Never arrived for a cancelled one star review', () => {
    const c = cardOf(1, { order: 'o2', stars: 1, sub: {}, text: '' });
    expect(c!.cancelled).toBe(true);
    expect(c!.headline).toBe('Never arrived');
    expect(c!.tone).toBe('red');
    expect(c!.mood).toBe('angry');
  });
  it('rejects a non review detail', () => { expect(cardOf(1, { foo: 1 })).toBeNull(); });
  it('titles a lane from cum stars', () => {
    expect(laneRatingTitle({ sum: 14, max: 15 })!.title).toBe('Five-Star Crypt');
    expect(laneRatingTitle({ sum: 8, max: 15 })!.title).toBe('Spooky Service');
    expect(laneRatingTitle({ sum: 3, max: 15 })!.title).toBe('Cursed');
    expect(laneRatingTitle(null)).toBeNull();
  });
});
