import { describe, expect, it } from 'vitest';
import { CREATURES } from '../src/creatures/defs';

class FakePath {
  constructor(public d?: string) {}
  addPath(): void {}
  ellipse(): void {}
}
(globalThis as Record<string, unknown>).Path2D = FakePath;

const chain = (): CanvasRenderingContext2D => {
  const fn: unknown = new Proxy(function () {}, {
    get: (_t, k) => (k === 'canvas' ? {} : fn),
    set: () => true,
    apply: () => fn,
  });
  return fn as CanvasRenderingContext2D;
};

describe('creature art', () => {
  it('lists the seven creatures with at least two animations each', () => {
    expect(CREATURES.map((c) => c.id)).toEqual(['reaper', 'zombie', 'ghost', 'wraith', 'poltergeist', 'doppelganger', 'lich']);
    for (const c of CREATURES) expect(c.anims.length).toBeGreaterThanOrEqual(2);
  });

  it('registers every creature in the lab, with the Lich as a boss', async () => {
    const { listSprites } = await import('../src/lab/registry');
    await import('../src/creatures/draw');
    const ids = listSprites().map((s) => s.id);
    for (const c of CREATURES) expect(ids).toContain(`creature-${c.id}`);
    expect(listSprites().find((s) => s.id === 'creature-lich')!.group).toBe('boss');
  });

  it('draws every animation at several progress values, in colour and silhouette', async () => {
    const { listSprites } = await import('../src/lab/registry');
    await import('../src/creatures/draw');
    const ctx = chain();
    for (const s of listSprites().filter((x) => x.id.startsWith('creature-'))) {
      for (const anim of s.anims) {
        for (const p of [0, 0.25, 0.5, 0.75, 1]) {
          for (const silhouette of [false, true]) {
            expect(() => s.draw(ctx, anim, p, { silhouette, size: 100 })).not.toThrow();
          }
        }
      }
    }
  });
});
