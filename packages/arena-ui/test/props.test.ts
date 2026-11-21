import { describe, expect, it } from 'vitest';

const chain = (): CanvasRenderingContext2D => {
  const fn: unknown = new Proxy(function () {}, {
    get: (_t, k) => (k === 'canvas' ? {} : fn),
    set: () => true,
    apply: () => fn,
  });
  return fn as CanvasRenderingContext2D;
};

describe('crypt props and layers', () => {
  it('registers every prop in the lab as a prop-group sprite', async () => {
    const { listSprites } = await import('../src/lab/registry');
    const { PROP_IDS } = await import('../src/props/draw');
    const props = listSprites().filter((s) => s.group === 'prop').map((s) => s.id);
    for (const id of PROP_IDS) expect(props).toContain(`prop-${id}`);
  });

  it('draws every prop, normal and silhouette, without throwing', async () => {
    const { PROP_IDS, drawProp } = await import('../src/props/draw');
    for (const id of PROP_IDS) {
      for (const silhouette of [false, true]) {
        expect(() => drawProp(chain(), id, 0.4, { silhouette, size: 56 })).not.toThrow();
      }
    }
  });

  it('draws the layer painters', async () => {
    const { archWall, pillar, floorTiles } = await import('../src/props/draw');
    expect(() => { archWall(chain(), 0, 0, 800, 200, 5); pillar(chain(), 0, 0, 40, 200); floorTiles(chain(), 0, 0, 800, 60); }).not.toThrow();
  });
});
