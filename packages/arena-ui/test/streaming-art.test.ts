// covers: PK-U2, PT-ART, TV3-U10
import { describe, expect, it } from 'vitest';
import { STREAMING, streamingId } from '../src/creatures/streaming-defs';
import { creatureFrame } from '../src/arena/creatures';

class FakePath { constructor(public d?: string) {} addPath(): void {} ellipse(): void {} }
(globalThis as Record<string, unknown>).Path2D = FakePath;
const chain = (): CanvasRenderingContext2D => {
  const fn: unknown = new Proxy(function () {}, { get: (_t, k) => (k === 'canvas' ? {} : fn), set: () => true, apply: () => fn });
  return fn as CanvasRenderingContext2D;
};

describe('streaming creature art (PK-U2)', () => {
  it('has the six pack creatures with idle and an act animation', () => {
    expect(STREAMING.map((c) => c.name)).toEqual(['Buffer Wraith', 'CDN Kraken', 'DRM Gatekeeper', 'Render Gremlin', 'Cloud Banshee', 'Region Ghost']);
    for (const c of STREAMING) expect(c.anims.map((a) => a.id)).toEqual(['idle', c.act]);
  });
  it('maps pack display names and ids to sprites', () => {
    expect(streamingId('Buffer Wraith')).toBe('buffer_wraith');
    expect(streamingId('CDN Kraken')).toBe('cdn_kraken');
    expect(streamingId('Region Warden')).toBe('region_ghost');
    expect(streamingId('ghost')).toBeNull();
  });
  it('animates a streaming creature in the arena frame model', () => {
    const c = { id: 'cdn_kraken', actAt: 1000, shrug: false, born: 0, exitAt: null, exitDur: 400 } as never;
    expect(creatureFrame(c, 500).anim).toBe('idle');
    expect(creatureFrame(c, 1600).anim).toBe('squeeze');
  });
  it('registers and draws every streaming and world sprite in the lab', async () => {
    const { listSprites } = await import('../src/lab/registry');
    await import('../src/creatures/streaming');
    await import('../src/lab/world-sprites');
    const ids = listSprites().map((s) => s.id);
    for (const c of STREAMING) expect(ids).toContain(`creature-${c.id}`);
    for (const w of ['scarecrow', 'black_cat', 'phantom_car', 'prankster', 'storm_crow', 'pothole_imp', 'fuel_wraith', 'lost_parcel_ghoul']) expect(ids).toContain(`world-${w}`);
    expect(listSprites().find((s) => s.id === 'creature-cdn_kraken')!.group).toBe('boss');
    const ctx = chain();
    for (const s of listSprites().filter((x) => x.id.startsWith('world-') || STREAMING.some((c) => `creature-${c.id}` === x.id))) {
      for (const anim of s.anims) for (const p of [0, 0.3, 0.6, 1]) for (const silhouette of [false, true]) {
        expect(() => s.draw(ctx, anim, p, { silhouette, size: 100 })).not.toThrow();
      }
    }
  });
});
