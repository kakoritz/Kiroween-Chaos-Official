import { describe, expect, it } from 'vitest';
import { taglineClipped, ARENA_H, ARENA_TOP, computeFit, isNarrow, NARROW_MAX_W } from '../src/arena/layout';

describe('responsive stage fit', () => {
  it('keeps the letterboxed full stage on desktop sizes', () => {
    for (const [w, h] of [[1280, 720], [1920, 1080], [1366, 768], [2560, 1080]]) {
      const f = computeFit(w, h);
      expect(f.narrow).toBe(false);
      expect(f.scale).toBeCloseTo(Math.min(w / 1920, h / 1080));
      expect(f.left).toBeGreaterThanOrEqual(0);
      expect(f.top).toBeGreaterThanOrEqual(0);
    }
    expect(computeFit(1920, 1080)).toMatchObject({ scale: 1, left: 0, top: 0 });
  });

  it('goes narrow on phones, small windows and portrait tablets', () => {
    expect(isNarrow(390, 844)).toBe(true);
    expect(isNarrow(844, 390)).toBe(false);
    expect(isNarrow(NARROW_MAX_W - 1, 400)).toBe(true);
    expect(isNarrow(NARROW_MAX_W, 400)).toBe(false);
    expect(isNarrow(820, 1180)).toBe(true);
  });

  it('fits the arena band to the width and crops the header band', () => {
    const f = computeFit(390, 844);
    expect(f.narrow).toBe(true);
    expect(f.scale).toBeCloseTo(390 / 1920);
    expect(f.left).toBe(0);
    expect(f.top).toBeCloseTo(-ARENA_TOP * f.scale);
    expect(f.bandH).toBeCloseTo(ARENA_H * f.scale);
    expect(1920 * f.scale).toBeCloseTo(390);
  });
});

describe('header tagline', () => {
  it('is hidden only when it is wider than its box', () => {
    expect(taglineClipped(180, 180)).toBe(false);
    expect(taglineClipped(181, 180)).toBe(false);
    expect(taglineClipped(260, 180)).toBe(true);
  });
});
