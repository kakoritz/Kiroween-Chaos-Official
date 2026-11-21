import { beforeEach, describe, expect, it } from 'vitest';
import { animProgress, clearRegistry, ease, listSprites, registerSprite, type SpriteDef } from '../src/lab/registry';

const anim = { id: 'a', label: 'A', loop: true, duration: 1000 };
const mk = (id: string, group: SpriteDef['group'], name = id): SpriteDef => ({ id, name, group, anims: [anim], draw() {} });

describe('sprite lab registry', () => {
  beforeEach(() => clearRegistry());

  it('sorts by group order then name', () => {
    registerSprite(mk('p', 'prop'));
    registerSprite(mk('b', 'creature', 'Zombie'));
    registerSprite(mk('a', 'creature', 'Ghost'));
    registerSprite(mk('s', 'skeleton'));
    expect(listSprites().map((s) => s.id)).toEqual(['s', 'a', 'b', 'p']);
  });

  it('rejects duplicates, empty and duplicate-anim sprites', () => {
    registerSprite(mk('x', 'prop'));
    expect(() => registerSprite(mk('x', 'prop'))).toThrow();
    expect(() => registerSprite({ ...mk('y', 'prop'), anims: [] })).toThrow();
    expect(() => registerSprite({ ...mk('z', 'prop'), anims: [anim, anim] })).toThrow();
  });

  it('loops and holds one-shots', () => {
    expect(animProgress(anim, 1250).p).toBeCloseTo(0.25);
    const once = { ...anim, loop: false };
    expect(animProgress(once, 400)).toEqual({ p: 0.4, done: false });
    expect(animProgress(once, 5000)).toEqual({ p: 1, done: true });
    expect(animProgress(once, -5).p).toBe(0);
  });

  it('easing hits its endpoints', () => {
    for (const f of Object.values(ease)) {
      expect(f(0)).toBeCloseTo(0);
      expect(f(1)).toBeCloseTo(1);
    }
  });
});
// covers: SH-U1
