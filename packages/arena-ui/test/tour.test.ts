import { describe, expect, it } from 'vitest';
import { TOUR_STEPS, bubblePosition, nextLabel, padRect, progressLabel, stepAfter, tourRequested } from '../src/onboarding/tour';
import { splashDecision } from '../src/onboarding/splash';

describe('guided tour', () => {
  it('has the six steps in order', () => {
    expect(TOUR_STEPS.map((s) => s.id)).toEqual(['race', 'gear', 'stages', 'chaos', 'ledger', 'report']);
    for (const s of TOUR_STEPS) { expect(s.text.length).toBeGreaterThan(10); expect(s.rect.w).toBeGreaterThan(0); }
  });
  it('fires chaos on step 4 and the report on step 6', () => {
    expect(TOUR_STEPS[3]!.action).toBe('chaos');
    expect(TOUR_STEPS[5]!.action).toBe('report');
    expect(TOUR_STEPS[1]!.action).toBe('legend');
  });
  it('?tour=1 starts it, off values do not, and the splash is skipped', () => {
    expect(tourRequested('?tour=1')).toBe(true);
    expect(tourRequested('?tour=0')).toBe(false);
    expect(tourRequested('')).toBe(false);
    expect(splashDecision('?tour=1').show).toBe(false);
  });
  it('steps forward and back, clamps at the start, ends after the last', () => {
    expect(stepAfter(0, 1)).toBe(1);
    expect(stepAfter(0, -1)).toBe(0);
    expect(stepAfter(5, 1)).toBeNull();
    expect(nextLabel(5)).toBe('Done');
    expect(nextLabel(2)).toBe('Next');
    expect(progressLabel(2)).toBe('3 / 6');
  });
  it('keeps the spotlight and bubble inside the stage', () => {
    for (const s of TOUR_STEPS) {
      const r = padRect(s.rect);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(1920);
      expect(r.y + r.h).toBeLessThanOrEqual(1080);
      const p = bubblePosition(r);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x + 560).toBeLessThanOrEqual(1920);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y + 190).toBeLessThanOrEqual(1080);
    }
  });
});
