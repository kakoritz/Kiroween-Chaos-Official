import { describe, expect, it } from 'vitest';
import { ANIMS, PARTS, REST, frameFor, poseFor, worldTransforms, type Frame } from '../src/rig/skeleton';

const near = (a: Frame, b: Frame, tol = 1e-6) => {
  for (const pa of a.parts) {
    const pb = b.parts.find((q) => q.id === pa.id)!;
    expect(Math.abs(pa.xf.x - pb.xf.x)).toBeLessThan(tol);
    expect(Math.abs(pa.xf.y - pb.xf.y)).toBeLessThan(tol);
    expect(Math.abs(pa.xf.rot - pb.xf.rot)).toBeLessThan(tol);
  }
};

describe('skeleton rig', () => {
  it('has 16 parts with unique ids and valid parents', () => {
    const ids = PARTS.map((d) => d.id);
    expect(new Set(ids).size).toBe(16);
    for (const d of PARTS) if (d.parent) expect(ids.indexOf(d.parent)).toBeLessThan(ids.indexOf(d.id));
  });

  it('stands on y = 0 and is about 100 units tall at idle', () => {
    const w = worldTransforms(poseFor('idle', 0));
    expect(w.footL.y).toBeCloseTo(-4, 0);
    expect(w.skull.y - 36).toBeLessThan(-90);
    expect(w.skull.y - 36).toBeGreaterThan(-110);
  });

  it('produces finite transforms for every animation across the cycle', () => {
    for (const a of ANIMS) {
      for (let i = 0; i <= 20; i++) {
        const f = frameFor(a.id, i / 20);
        expect(f.parts).toHaveLength(16);
        for (const p of f.parts) for (const v of Object.values(p.xf)) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('loops seamlessly for idle, walk and cheer', () => {
    for (const id of ['idle', 'walk', 'cheer']) near(frameFor(id, 0), frameFor(id, 1), 1e-6);
  });

  it('collapse ends in the floor pile and reassemble starts there', () => {
    const end = frameFor('collapse', 1);
    for (const p of end.parts) {
      expect(p.xf.x).toBeCloseTo(REST[p.id].x, 6);
      expect(p.xf.y).toBeCloseTo(REST[p.id].y, 6);
      expect(p.xf.rot).toBeCloseTo(REST[p.id].rot, 6);
    }
    near(end, frameFor('reassemble', 0));
  });

  it('reassemble ends standing exactly like idle', () => {
    near(frameFor('reassemble', 1), frameFor('idle', 0));
    near(frameFor('collapse', 0), frameFor('idle', 0));
  });

  it('collapse never sinks bones below the floor', () => {
    for (let i = 0; i <= 40; i++) for (const p of frameFor('collapse', i / 40).parts) expect(p.xf.y).toBeLessThan(2);
  });

  it('cheer lifts both arms above the shoulders', () => {
    const w = worldTransforms(poseFor('cheer', 0.25));
    expect(w.handL.y).toBeLessThan(w.upperArmL.y);
    expect(w.handR.y).toBeLessThan(w.upperArmR.y);
  });
});
