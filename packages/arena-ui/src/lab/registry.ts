/// <reference lib="dom" />
// Sprite lab registry. Every character, pose and creature animation registers here
// (UI-ART1 onward) and shows up in lab.html with play buttons. Pure, no DOM.

export type SpriteGroup = 'skeleton' | 'tier' | 'creature' | 'boss' | 'prop';

export interface AnimDef {
  id: string;
  label: string;
  /** Loop forever, or play once and hold the last frame. */
  loop: boolean;
  /** Milliseconds for one cycle. */
  duration: number;
}

export interface DrawOpts {
  /** Draw as a flat #14101f silhouette (the 56 px silhouette test). */
  silhouette: boolean;
  /** Pixel height the sprite should fill. */
  size: number;
}

export interface SpriteDef {
  id: string;
  name: string;
  group: SpriteGroup;
  anims: AnimDef[];
  /** Draw centred on (0,0) with feet at y = size / 2. p is cycle progress 0..1. */
  draw(ctx: CanvasRenderingContext2D, anim: AnimDef, p: number, opts: DrawOpts): void;
}

export const GROUP_ORDER: SpriteGroup[] = ['skeleton', 'tier', 'creature', 'boss', 'prop'];
export const GROUP_LABEL: Record<SpriteGroup, string> = {
  skeleton: 'Skeleton rig',
  tier: 'Tier dressings',
  creature: 'Creatures',
  boss: 'Bosses',
  prop: 'Props and backgrounds',
};

const sprites = new Map<string, SpriteDef>();

export function registerSprite(def: SpriteDef): void {
  if (sprites.has(def.id)) throw new Error(`sprite already registered: ${def.id}`);
  if (def.anims.length === 0) throw new Error(`sprite has no animations: ${def.id}`);
  const ids = new Set(def.anims.map((a) => a.id));
  if (ids.size !== def.anims.length) throw new Error(`duplicate anim id in ${def.id}`);
  sprites.set(def.id, def);
}

export function listSprites(): SpriteDef[] {
  const order = new Map(GROUP_ORDER.map((g, i) => [g, i]));
  return [...sprites.values()].sort(
    (a, b) => (order.get(a.group)! - order.get(b.group)!) || a.name.localeCompare(b.name),
  );
}

export function clearRegistry(): void {
  sprites.clear();
}

/** Progress inside the current cycle. One-shot animations hold at 1 once done. */
export function animProgress(anim: AnimDef, elapsedMs: number): { p: number; done: boolean } {
  const e = Math.max(0, elapsedMs);
  if (anim.loop) return { p: (e % anim.duration) / anim.duration, done: false };
  const p = Math.min(1, e / anim.duration);
  return { p, done: p >= 1 };
}

export const ease = {
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  outBounce: (t: number) => {
    const n = 7.5625;
    const d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  },
};
