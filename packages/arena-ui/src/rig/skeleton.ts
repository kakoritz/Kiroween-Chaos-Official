// Skeleton rig model (UI-ART1). Pure maths, no DOM, so it is unit-testable.
// Sixteen parts, each with a pivot. A pose is a set of rotations on those pivots, forward
// kinematics gives world transforms, and collapse / reassemble tween those transforms
// to and from a scattered pile on the floor. Coordinates: feet at y = 0, up is negative,
// the sprite is about 100 units tall.
import { ease } from '../lab/registry';

export type PartId =
  | 'pelvis' | 'ribcage' | 'skull' | 'jaw'
  | 'upperArmL' | 'lowerArmL' | 'handL' | 'upperArmR' | 'lowerArmR' | 'handR'
  | 'upperLegL' | 'lowerLegL' | 'footL' | 'upperLegR' | 'lowerLegR' | 'footR';

export interface Xf { x: number; y: number; rot: number }
export interface PartDef {
  id: PartId;
  parent: PartId | null;
  /** Pivot position relative to the parent pivot. */
  at: [number, number];
  /** Draw order, low first. */
  z: number;
  /** SVG path data, relative to the part's own pivot. */
  path: string;
  /** Pivot world transform in the collapsed pile. */
  rest: Xf;
}

export type Face = 'neutral' | 'happy' | 'worry' | 'dead' | 'surprised';

export interface Pose {
  body: { x: number; y: number; rot: number };
  rot: Partial<Record<PartId, number>>;
  off: Partial<Record<PartId, [number, number]>>;
  face: Face;
  look: number;
  blink: number;
}

export interface Frame {
  parts: { id: PartId; xf: Xf }[];
  /** Squash and stretch about the feet. */
  sx: number;
  sy: number;
  face: Face;
  look: number;
  blink: number;
  /** True while the bones are apart. */
  scattered: boolean;
}

const cap = (w: number, len: number): string => {
  const v = w * 0.8;
  return `M${-w} 0 A${w} ${w} 0 0 1 ${w} 0 L${v} ${len} A${v} ${v} 0 0 1 ${-v} ${len} Z`;
};
const hand = 'M-5 5 A5 5 0 1 1 5 5 A5 5 0 1 1 -5 5 Z';
const foot = (m: number): string => `M${-4 * m} -4 L${-4 * m} 0 L${10 * m} 0 Q${12 * m} 0 ${12 * m} -2 L${9 * m} -4 Z`;

const defs: PartDef[] = [
  { id: 'pelvis', parent: null, at: [0, -36], z: 10, path: 'M-11 -4 Q-12 5 -6 8 L6 8 Q12 5 11 -4 Z', rest: { x: -26, y: -8, rot: 0.15 } },
  { id: 'ribcage', parent: 'pelvis', at: [0, -3], z: 11, path: 'M-12 0 L-12 -17 Q-14 -24 0 -25 Q14 -24 12 -17 L12 0 Z', rest: { x: -6, y: -12, rot: 1.5 } },
  { id: 'skull', parent: 'ribcage', at: [0, -24], z: 14, path: 'M-20 -20 A20 16 0 1 1 20 -20 L16 -8 Q14 -4 10 -4 L-10 -4 Q-14 -4 -16 -8 Z', rest: { x: 36, y: -3, rot: 0.3 } },
  { id: 'jaw', parent: 'skull', at: [0, -6], z: 13, path: 'M-13 0 L13 0 L10 8 Q9 11 5 11 L-5 11 Q-9 11 -10 8 Z', rest: { x: 56, y: -7, rot: 1.35 } },
  { id: 'upperArmL', parent: 'ribcage', at: [-14, -20], z: 5, path: cap(4, 14), rest: { x: -40, y: -4, rot: 1.45 } },
  { id: 'lowerArmL', parent: 'upperArmL', at: [0, 14], z: 6, path: cap(3.6, 13), rest: { x: -26, y: -10, rot: -1.5 } },
  { id: 'handL', parent: 'lowerArmL', at: [0, 13], z: 7, path: hand, rest: { x: -50, y: -14, rot: 0.3 } },
  { id: 'upperArmR', parent: 'ribcage', at: [14, -20], z: 5, path: cap(4, 14), rest: { x: 62, y: -4, rot: -1.45 } },
  { id: 'lowerArmR', parent: 'upperArmR', at: [0, 14], z: 6, path: cap(3.6, 13), rest: { x: 20, y: -4, rot: 1.6 } },
  { id: 'handR', parent: 'lowerArmR', at: [0, 13], z: 7, path: hand, rest: { x: 68, y: -9, rot: -0.2 } },
  { id: 'upperLegL', parent: 'pelvis', at: [-7, 5], z: 2, path: cap(4.6, 16), rest: { x: -2, y: -4, rot: 1.6 } },
  { id: 'lowerLegL', parent: 'upperLegL', at: [0, 16], z: 3, path: cap(4, 11), rest: { x: -38, y: -4, rot: 1.5 } },
  { id: 'footL', parent: 'lowerLegL', at: [0, 11], z: 4, path: foot(-1), rest: { x: -58, y: -1, rot: 0.1 } },
  { id: 'upperLegR', parent: 'pelvis', at: [7, 5], z: 2, path: cap(4.6, 16), rest: { x: 14, y: -10, rot: -1.5 } },
  { id: 'lowerLegR', parent: 'upperLegR', at: [0, 16], z: 3, path: cap(4, 11), rest: { x: 44, y: -4, rot: -1.7 } },
  { id: 'footR', parent: 'lowerLegR', at: [0, 11], z: 4, path: foot(1), rest: { x: 72, y: -1, rot: -0.1 } },
];

for (const d of defs) d.rest = { ...d.rest, x: d.rest.x * 0.6 };
export const PARTS: readonly PartDef[] = defs;
export const PART_IDS: PartId[] = defs.map((d) => d.id);

const emptyPose = (): Pose => ({ body: { x: 0, y: 0, rot: 0 }, rot: {}, off: {}, face: 'neutral', look: 0, blink: 0 });

/** Forward kinematics: world transform of every part pivot. */
export function worldTransforms(pose: Pose): Record<PartId, Xf> {
  const out = {} as Record<PartId, Xf>;
  for (const d of defs) {
    const own = pose.rot[d.id] ?? 0;
    const off = pose.off[d.id] ?? [0, 0];
    if (d.parent === null) {
      out[d.id] = { x: pose.body.x + d.at[0] + off[0], y: pose.body.y + d.at[1] + off[1], rot: pose.body.rot + own };
    } else {
      const p = out[d.parent];
      const c = Math.cos(p.rot);
      const s = Math.sin(p.rot);
      const lx = d.at[0] + off[0];
      const ly = d.at[1] + off[1];
      out[d.id] = { x: p.x + lx * c - ly * s, y: p.y + lx * s + ly * c, rot: p.rot + own };
    }
  }
  return out;
}

const TAU = Math.PI * 2;
const sw = (p: number, phase = 0) => Math.sin((p + phase) * TAU);

function sym(r: Pose['rot'], base: 'upperArm' | 'lowerArm' | 'upperLeg' | 'lowerLeg' | 'foot', left: number, right: number): void {
  r[`${base}L` as PartId] = left;
  r[`${base}R` as PartId] = right;
}

/** Rotation convention: positive swings a hanging limb toward screen-left. */
export function poseFor(anim: string, p: number): Pose {
  const o = emptyPose();
  const r = o.rot;
  switch (anim) {
    case 'walk': {
      const a = sw(p);
      o.body.y = -Math.abs(sw(p * 2, 0.25)) * 2.6 + 1.2;
      o.body.rot = 0.05;
      r.ribcage = -0.06 * a;
      r.skull = 0.04 * a;
      sym(r, 'upperLeg', 0.62 * a, -0.62 * a);
      sym(r, 'lowerLeg', Math.max(0, -sw(p, 0.1)) * 0.9, Math.max(0, sw(p, 0.1)) * 0.9);
      sym(r, 'foot', 0.1 * a, -0.1 * a);
      sym(r, 'upperArm', -0.55 * a + 0.1, 0.55 * a - 0.1);
      sym(r, 'lowerArm', 0.35, -0.35);
      o.look = 0.9;
      o.blink = p > 0.46 && p < 0.5 ? 1 : 0;
      break;
    }
    case 'cheer': {
      const up = Math.abs(sw(p / 2));
      o.body.y = -up * 14;
      const w = sw(p * 2);
      sym(r, 'upperArm', 2.7 + 0.15 * w, -(2.7 - 0.15 * w));
      sym(r, 'lowerArm', -0.25 * w, 0.25 * w);
      sym(r, 'upperLeg', 0.12 * up, -0.12 * up);
      sym(r, 'lowerLeg', 0.5 * up, 0.5 * up);
      r.ribcage = 0.05 * w;
      r.skull = -0.1 * w;
      o.off.jaw = [0, 3.5 + 1.5 * up];
      o.face = 'happy';
      break;
    }
    case 'work': {
      // Bones rattle, both hands busy in front of the ribcage.
      const k = sw(p * 4);
      o.body.y = Math.abs(k) * -1.2;
      o.body.rot = 0.04;
      r.ribcage = 0.07 + 0.03 * k;
      r.skull = -0.1 + 0.05 * sw(p * 2);
      sym(r, 'upperArm', -0.9 + 0.12 * k, -(0.9 + 0.12 * k));
      sym(r, 'lowerArm', 1.5 - 0.2 * k, -(1.5 + 0.2 * k));
      sym(r, 'upperLeg', 0.04, -0.04);
      o.look = -0.6;
      o.blink = p > 0.8 && p < 0.84 ? 1 : 0;
      o.off.jaw = [0, 0.6 + 0.6 * Math.abs(k)];
      break;
    }
    case 'slump': {
      // Failed: head down, shoulders rolled forward, arms hanging, knees soft.
      const b = sw(p, 0.1);
      o.body.y = 5 + b * 0.5;
      o.body.rot = 0.1;
      r.ribcage = 0.28;
      r.skull = 0.42 + 0.02 * b;
      sym(r, 'upperArm', 0.3, -0.12);
      sym(r, 'lowerArm', 0.2, -0.1);
      sym(r, 'upperLeg', 0.2, -0.12);
      sym(r, 'lowerLeg', 0.38, 0.3);
      o.face = 'dead';
      o.off.jaw = [0, 3];
      break;
    }
    case 'recover': {
      // Bandaged and wobbling, one hand on the head.
      const k = sw(p);
      o.body.y = 2;
      o.body.rot = 0.06 * k;
      r.ribcage = 0.12 * k;
      r.skull = 0.2 + 0.08 * sw(p * 2);
      sym(r, 'upperArm', 0.1, 2.5);
      sym(r, 'lowerArm', 0.15, -2.2);
      sym(r, 'upperLeg', 0.08, -0.08);
      sym(r, 'lowerLeg', 0.15, 0.15);
      o.face = 'worry';
      o.look = k;
      break;
    }
    case 'halted': {
      // Sitting on the floor, slumped.
      o.body.y = 20;
      o.body.rot = 0.04;
      r.ribcage = 0.42;
      r.skull = 0.55;
      sym(r, 'upperArm', 0.5, -0.25);
      sym(r, 'lowerArm', 0.3, -0.2);
      sym(r, 'upperLeg', 1.35, -1.25);
      sym(r, 'lowerLeg', -1.3, 1.3);
      o.face = 'dead';
      break;
    }
    case 'sleep': {
      // Quiet crypt: slow breathing, head resting forward, eyes shut.
      const b = sw(p);
      o.body.y = 8 + b * 0.8;
      r.ribcage = 0.2;
      r.skull = 0.5;
      sym(r, 'upperArm', 0.2, -0.2);
      sym(r, 'lowerArm', 0.2, -0.2);
      sym(r, 'upperLeg', 0.1, -0.1);
      sym(r, 'lowerLeg', 0.25, 0.25);
      o.blink = 1;
      break;
    }
    default: {
      // idle: breathe, sway, blink, look around
      const b = sw(p);
      o.body.y = b * 0.9;
      r.ribcage = 0.025 * b;
      r.skull = -0.04 * sw(p, 0.2);
      sym(r, 'upperArm', 0.09 + 0.05 * b, -(0.09 + 0.05 * b));
      sym(r, 'lowerArm', 0.12 + 0.04 * b, -(0.12 + 0.04 * b));
      sym(r, 'upperLeg', 0.03, -0.03);
      o.look = Math.sin(p * TAU) * 0.8;
      o.blink = p > 0.62 && p < 0.68 ? 1 : 0;
      o.off.jaw = [0, 0.5 + 0.5 * b];
    }
  }
  return o;
}

function frameFromPose(pose: Pose): Frame {
  const w = worldTransforms(pose);
  return {
    parts: defs.map((d) => ({ id: d.id, xf: w[d.id] })),
    sx: 1, sy: 1, face: pose.face, look: pose.look, blink: pose.blink,
    scattered: false,
  };
}

const ASSEMBLED = worldTransforms(poseFor('idle', 0));

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const outQuad = (t: number) => 1 - (1 - t) * (1 - t);

/** Stagger window: part i starts a little after part i-1. */
const delay = (i: number, span: number) => (i / (defs.length - 1)) * span;

function scatterFrame(from: Record<PartId, Xf>, to: Record<PartId, Xf>, f: number, mode: 'collapse' | 'reassemble'): Frame['parts'] {
  return defs.map((d, i) => {
    const idx = mode === 'collapse' ? defs.length - 1 - i : i;
    const q = clamp01((f - delay(idx, 0.3)) / 0.7);
    const a = from[d.id];
    const b = to[d.id];
    let x: number, y: number, rot: number;
    if (mode === 'collapse') {
      x = lerp(a.x, b.x, outQuad(q));
      y = lerp(a.y, b.y, ease.outBounce(q)) - Math.sin(Math.PI * Math.min(1, q * 1.6)) * 12;
      rot = lerp(a.rot, b.rot, outQuad(q));
    } else {
      const m = ease.inOutCubic(q);
      x = lerp(a.x, b.x, ease.outBack(q));
      y = lerp(a.y, b.y, m) - Math.sin(Math.PI * q) * 30;
      rot = lerp(a.rot, b.rot, ease.outBack(q));
    }
    return { id: d.id, xf: { x, y, rot } };
  });
}

export const REST: Record<PartId, Xf> = Object.fromEntries(defs.map((d) => [d.id, d.rest])) as Record<PartId, Xf>;

/** One drawable frame for an animation id at cycle progress p (0..1). */
export function frameFor(anim: string, p: number): Frame {
  if (anim === 'collapse') {
    const shake = clamp01(p / 0.1);
    if (p < 0.1) {
      const f = frameFromPose(poseFor('idle', 0));
      const k = Math.sin(shake * Math.PI * 6) * 1.4;
      f.parts = f.parts.map((part) => ({ id: part.id, xf: { ...part.xf, x: part.xf.x + k } }));
      f.face = 'surprised';
      f.sy = 1 + 0.05 * shake;
      f.sx = 1 - 0.03 * shake;
      return f;
    }
    const f = clamp01((p - 0.1) / 0.9);
    return { parts: scatterFrame(ASSEMBLED, REST, f, 'collapse'), sx: 1, sy: 1, face: 'dead', look: 0, blink: 0, scattered: f < 1 };
  }
  if (anim === 'reassemble') {
    const rise = clamp01(p / 0.8);
    const fr: Frame = { parts: scatterFrame(REST, ASSEMBLED, rise, 'reassemble'), sx: 1, sy: 1, face: rise < 0.55 ? 'dead' : 'surprised', look: 0, blink: 0, scattered: rise < 1 };
    if (p > 0.8) {
      const t = (p - 0.8) / 0.2;
      const bounce = Math.sin(t * Math.PI * 2) * (1 - t) * 0.1;
      fr.sy = 1 - bounce;
      fr.sx = 1 + bounce * 0.8;
      fr.face = t < 0.6 ? 'surprised' : 'happy';
    }
    return fr;
  }
  return frameFromPose(poseFor(anim, p));
}

export const ANIMS = [
  { id: 'idle', label: 'Idle', loop: true, duration: 1800 },
  { id: 'walk', label: 'Walk', loop: true, duration: 900 },
  { id: 'cheer', label: 'Cheer', loop: true, duration: 800 },
  { id: 'work', label: 'Work', loop: true, duration: 700 },
  { id: 'slump', label: 'Fail slump', loop: true, duration: 1800 },
  { id: 'recover', label: 'Recovering', loop: true, duration: 1200 },
  { id: 'halted', label: 'Halted', loop: true, duration: 2400 },
  { id: 'sleep', label: 'Asleep', loop: true, duration: 3200 },
  { id: 'collapse', label: 'Collapse', loop: false, duration: 1400 },
  { id: 'reassemble', label: 'Reassemble', loop: false, duration: 1600 },
] as const;
