import { describe, expect, it } from 'vitest';
import { BOSS_INSET, laneBoxes } from '../src/arena/scene';

describe('boss banner inset (#120)', () => {
  it('keeps every lane below the 48 px banner and above the footer', () => {
    for (const n of [1, 3, 5]) {
      const boxes = laneBoxes(n, BOSS_INSET);
      expect(boxes[0]!.top).toBeGreaterThanOrEqual(72 + BOSS_INSET);
      const last = boxes[n - 1]!;
      expect(last.top + last.h).toBeLessThanOrEqual(72 + 768);
    }
  });
  it('is unchanged without a boss', () => {
    expect(laneBoxes(5)[0]!.top).toBe(72);
  });
});
