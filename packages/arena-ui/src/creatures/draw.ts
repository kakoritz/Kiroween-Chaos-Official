/// <reference lib="dom" />
// Code-drawn creatures (UI-ART3). Same style guide as the skeleton rig: 4 px #14101f outline,
// rounded joins, flat fill, one shade crescent (bottom right), one rim crescent (top left).
// Units: a 100-tall box, centred on x = 0, feet at y = 0, up is negative.
import { registerSprite, ease, type DrawOpts } from '../lab/registry';
import { CREATURES, type CreatureId } from './defs';

export const OUT = '#14101f';
const BONE = '#efe6d2';
export const TAU = Math.PI * 2;
type Ctx = CanvasRenderingContext2D;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
export const seg = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));

const cache = new Map<string, Path2D>();
const pathOf = (d: string): Path2D => {
  let p = cache.get(d);
  if (!p) cache.set(d, (p = new Path2D(d)));
  return p;
};

export function unit(ctx: Ctx, o: DrawOpts, fn: () => void): void {
  const s = o.size / 100;
  ctx.save();
  ctx.translate(0, o.size / 2);
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  fn();
  ctx.restore();
}

function crescent(ctx: Ctx, path: Path2D, dx: number, dy: number, color: string): void {
  const c = new Path2D('M-300,-300H300V300H-300Z');
  c.addPath(path, { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy });
  ctx.save();
  ctx.clip(path);
  ctx.fillStyle = color;
  ctx.fill(c, 'evenodd');
  ctx.restore();
}

/** Outlined flat shape with one shade and one rim crescent. */
export function blob(ctx: Ctx, o: DrawOpts, d: string | Path2D, fill: string, shade?: string, rim?: string): void {
  const path = typeof d === 'string' ? pathOf(d) : d;
  ctx.lineWidth = 4;
  ctx.strokeStyle = OUT;
  ctx.fillStyle = o.silhouette ? OUT : fill;
  ctx.fill(path);
  if (!o.silhouette) {
    if (shade) crescent(ctx, path, -3.5, -3.5, shade);
    if (rim) crescent(ctx, path, 3, 3, rim);
  }
  ctx.stroke(path);
}

export function ball(ctx: Ctx, o: DrawOpts, x: number, y: number, rx: number, ry: number, fill: string, shade?: string, rim?: string): void {
  const p = new Path2D();
  p.ellipse(x, y, rx, ry, 0, 0, TAU);
  blob(ctx, o, p, fill, shade, rim);
}

/** Thick outlined limb, pole or chain segment. */
export function limb(ctx: Ctx, o: DrawOpts, x1: number, y1: number, x2: number, y2: number, w: number, fill: string): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineWidth = w + 8;
  ctx.strokeStyle = OUT;
  ctx.stroke();
  if (!o.silhouette) {
    ctx.lineWidth = w;
    ctx.strokeStyle = fill;
    ctx.stroke();
  }
}

export function glow(ctx: Ctx, o: DrawOpts, x: number, y: number, r: number, color: string, alpha: number): void {
  if (o.silhouette || alpha <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.restore();
}

export function eyes(ctx: Ctx, o: DrawOpts, pts: Array<[number, number]>, r: number, color: string): void {
  if (o.silhouette) return;
  ctx.fillStyle = color;
  for (const [x, y] of pts) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
}

// ---------------------------------------------------------------- Reaper
function reaper(ctx: Ctx, o: DrawOpts, a: string, p: number): void {
  const t = p * TAU;
  let bob = Math.sin(t) * 2.5;
  let sway = Math.sin(t) * 0.03;
  let ang = Math.sin(t) * 0.05;
  if (a === 'swing') {
    const wind = ease.inOutCubic(seg(p, 0, 0.4));
    const hit = ease.inOutCubic(seg(p, 0.4, 0.62));
    const back = seg(p, 0.8, 1);
    ang = lerp(0, 1.0, wind) + lerp(0, -1.75, hit) + lerp(0, 0.2, back);
    sway = lerp(0, 0.1, wind) + lerp(0, -0.2, hit) + lerp(0, 0.1, back);
    bob = -3 * wind + 4 * hit;
  }
  ctx.translate(0, bob - 4);
  ctx.save();
  ctx.rotate(sway);
  // scythe, pivoting on the hand
  ctx.save();
  ctx.translate(26, -50);
  ctx.rotate(ang);
  limb(ctx, o, 0, 44, 0, -56, 4, '#6b4a2e');
  blob(ctx, o, 'M0,-58C-12,-78-42,-74-56,-52C-38,-62-16,-60,0,-46Z', '#c8d2e6', '#8f9bb8', '#f1f6ff');
  ctx.restore();
  // cloak and hood
  blob(ctx, o, 'M0,-97C-17,-97-23,-80-21,-64C-27,-42-32,-16-37,4C-20,-2-8,6,0,2C8,6,20,-2,37,4C32,-16,27,-42,21,-64C23,-80,17,-97,0,-97Z', '#3a2f5c', '#261e40', '#5a4a8a');
  // hood opening
  ball(ctx, o, 0, -73, 12, 14, OUT);
  eyes(ctx, o, [[-5, -75], [5, -75]], 2.8, '#ff9a3c');
  glow(ctx, o, 0, -75, 18, '#ff9a3c', 0.25);
  // sleeve and bony hand
  blob(ctx, o, 'M12,-68C24,-64,34,-58,32,-46L19,-44C16,-54,10,-60,12,-68Z', '#3a2f5c', '#261e40');
  ball(ctx, o, 26, -49, 5, 5, BONE, '#cfc3a8');
  ctx.restore();
}

// ---------------------------------------------------------------- Zombie
function zombie(ctx: Ctx, o: DrawOpts, a: string, p: number): void {
  const t = p * TAU;
  const G = '#8fbf6a';
  const GS = '#648f47';
  const GR = '#bde39a';
  const sit = a === 'sit';
  const stride = sit ? 0 : Math.sin(t);
  const droop = sit ? 0.12 + Math.sin(t) * 0.05 : Math.sin(t * 2) * 0.03;
  const squash = sit ? 0.82 : 1;
  ctx.translate(0, (sit ? 0 : -Math.abs(Math.sin(t)) * 1.5));
  ctx.scale(1, squash);
  // legs
  for (const [i, x] of [[-1, -9], [1, 9]] as const) {
    ctx.save();
    ctx.translate(x, -32);
    ctx.rotate(sit ? 0 : i * stride * 0.28);
    blob(ctx, o, 'M-7,0L7,0L8,30L-9,30Z', '#3f4a63', '#2c344a', '#5d6a8c');
    blob(ctx, o, 'M-10,26L9,26L12,33L-12,33Z', '#5c4a3a');
    ctx.restore();
  }
  // long arm hanging (behind torso)
  ctx.save();
  ctx.translate(-12, -56);
  ctx.rotate(-0.08 + Math.sin(t + 1) * 0.1 + (sit ? 0.15 : 0));
  limb(ctx, o, 0, 0, -4, 38, 8, G);
  ball(ctx, o, -4, 42, 6, 6, G, GS);
  ctx.restore();
  // hunched torso
  ctx.save();
  ctx.translate(2, -34);
  ctx.rotate(droop);
  ctx.translate(-2, 34);
  ctx.translate(0, -34);
  blob(ctx, o, 'M-18,0C-24,-18-14,-34,4,-34C20,-32,28,-20,22,0Z', '#6b5b7b', '#4a3d58', '#8f7fa0');
  // torn hem and rib patch
  if (!o.silhouette) {
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(-6, -20);
    ctx.lineTo(-1, -14);
    ctx.lineTo(4, -20);
    ctx.stroke();
  }
  // head, thrust forward and low
  ctx.save();
  ctx.translate(20, -38);
  ctx.rotate(0.25 + droop * 1.6);
  ball(ctx, o, 0, -10, 15, 14, G, GS, GR);
  // mismatched eyes, jagged mouth
  if (!o.silhouette) {
    ball(ctx, o, 5, -14, 5.2, 5.2, '#f3ecff');
    eyes(ctx, o, [[6, -14]], 2.2, OUT);
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(-9, -17);
    ctx.lineTo(-3, -11);
    ctx.moveTo(-3, -17);
    ctx.lineTo(-9, -11);
    ctx.moveTo(-4, -4);
    ctx.lineTo(0, -1);
    ctx.lineTo(4, -4);
    ctx.lineTo(8, -1);
    ctx.lineTo(12, -4);
    ctx.stroke();
  }
  ctx.restore();
  // short outstretched arm
  ctx.save();
  ctx.translate(14, -26);
  ctx.rotate(-0.1 + Math.sin(t + 2) * 0.12);
  limb(ctx, o, 0, 0, 28, -2, 8, G);
  ball(ctx, o, 31, -2, 6, 6, G, GS);
  ctx.restore();
  ctx.restore();
}

// ---------------------------------------------------------------- Ghost
function ghost(ctx: Ctx, o: DrawOpts, a: string, p: number): void {
  const t = p * TAU;
  const bob = Math.sin(t) * 4 - 6;
  const lean = a === 'touch' ? lerp(0, 0.1, Math.sin(clamp01(p * 1.3) * Math.PI)) : Math.sin(t) * 0.03;
  ctx.translate(0, bob);
  ctx.rotate(lean);
  glow(ctx, o, 0, -50, 70, '#7ab8ff', 0.28);
  // reaching arm (behind sheet edge)
  const reach = a === 'touch' ? ease.inOutCubic(seg(p, 0, 0.45)) * (1 - 0.25 * Math.sin(seg(p, 0.55, 1) * Math.PI * 3)) : 0.1;
  ctx.save();
  ctx.translate(18, -48);
  ctx.rotate(lerp(0.9, -0.15, reach));
  blob(ctx, o, 'M0,-6C16,-8,32,-6,44,-1C32,6,16,8,0,6Z', '#bcdcff', '#7ab8ff', '#eaf5ff');
  ctx.restore();
  // sheet
  const wob = Math.sin(t * 2) * 2;
  const d = `M-26,-4L-26,-60C-26,-95,26,-95,26,-60L26,-4L${17},${-9 + wob}L9,-3L0,${-9 - wob}L-9,-3L-17,${-9 + wob}Z`;
  blob(ctx, o, d, '#bcdcff', '#7ab8ff', '#eaf5ff');
  if (!o.silhouette) {
    ball(ctx, o, -9, -68, 5, 7, OUT);
    ball(ctx, o, 9, -68, 5, 7, OUT);
    ball(ctx, o, 0, -53, 4, 6, OUT);
    ctx.strokeStyle = '#3b5f94';
    ctx.lineWidth = 2.6;
    // "404" scribble on the sheet
    ctx.fillStyle = '#3b5f94';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('404', 0, -26);
    ctx.beginPath();
    ctx.moveTo(-12, -22);
    ctx.quadraticCurveTo(0, -18, 12, -23);
    ctx.stroke();
  }
}

// ---------------------------------------------------------------- Wraith
function wraith(ctx: Ctx, o: DrawOpts, a: string, p: number): void {
  const t = p * TAU;
  const hover = -8 + Math.sin(t) * 4;
  const yank = a === 'yank' ? ease.inOutCubic(seg(p, 0.15, 0.5)) * (1 - ease.inOutCubic(seg(p, 0.75, 1)) * 0.6) : 0;
  const snap = a === 'yank' ? seg(p, 0.45, 0.6) : 0;
  const lean = -yank * 0.14 + Math.sin(t) * 0.02;
  // chain tail
  for (let i = 0; i < 4; i++) {
    const cx = Math.sin(t - i * 0.8) * (3 + i * 2) + i * 1.5;
    const cy = hover - 8 + i * 4.6 - i * 0.2;
    ball(ctx, o, cx, Math.min(cy + 12, -2), 4.2, i % 2 ? 2.6 : 3.6, '#9aa3b8', '#6b7389');
  }
  ctx.save();
  ctx.translate(0, hover);
  ctx.rotate(lean);
  glow(ctx, o, 0, -60, 60, '#9b6bff', 0.22);
  // cable arm
  const hx = lerp(40, 22, yank);
  const hy = -50 + yank * 6;
  limb(ctx, o, 14, -56, hx, hy, 8, '#4a3b78');
  // cable and plug
  limb(ctx, o, hx, hy, hx + 8 + snap * 22, hy + 38 - snap * 10, 3.5, '#ffc247');
  blob(ctx, o, `M${hx + 4 + snap * 22},${hy + 34 - snap * 10}h10v10h-10Z`, '#8f86a8');
  if (!o.silhouette && snap > 0 && snap < 1) {
    ctx.strokeStyle = '#ffc247';
    ctx.lineWidth = 2;
    for (const k of [-1, 0, 1]) {
      ctx.beginPath();
      ctx.moveTo(hx + 30 + k * 4, hy + 24);
      ctx.lineTo(hx + 38 + k * 6, hy + 14 + k * 4);
      ctx.stroke();
    }
  }
  // body: hooded drop with a ragged tail
  blob(ctx, o, 'M0,-96C-24,-96-31,-66-23,-47C-17,-30-6,-24-9,-10C-4,-14,0,-6,2,0C5,-8,9,-14,11,-8C8,-22,18,-30,24,-47C32,-66,24,-96,0,-96Z', '#4a3b78', '#2f2552', '#7a68b8');
  ball(ctx, o, 0, -70, 13, 15, OUT);
  eyes(ctx, o, [[-5, -72], [5, -72]], 3.2, '#ffc247');
  glow(ctx, o, 0, -72, 16, '#ffc247', 0.3);
  ctx.restore();
}

// ---------------------------------------------------------------- Poltergeist
function paper(ctx: Ctx, o: DrawOpts, x: number, y: number, r: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(r);
  blob(ctx, o, 'M-6,-8h12v16h-12Z', '#f3ecff', '#cfc3d8');
  ctx.restore();
}

function poltergeist(ctx: Ctx, o: DrawOpts, a: string, p: number): void {
  const t = p * TAU;
  const fling = a === 'fling';
  const wind = fling ? ease.inOutCubic(seg(p, 0, 0.35)) : 0;
  const hit = fling ? ease.outBack(seg(p, 0.35, 0.65)) : 0;
  const jitter = fling ? 0 : Math.sin(t * 3) * 1.2;
  const cab = fling ? hit : 0;
  // file cabinet, flung from the side to up and away
  ctx.save();
  ctx.translate(lerp(38, 62, cab), lerp(-24, -58, cab) - Math.sin(cab * Math.PI) * 14);
  ctx.rotate(cab * 0.9);
  blob(ctx, o, 'M-13,-24h26v48h-26Z', '#6c7a99', '#4c5875', '#93a1c2');
  if (!o.silhouette) {
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 2.4;
    for (const y of [-8, 8]) {
      ctx.beginPath();
      ctx.moveTo(-13, y);
      ctx.lineTo(13, y);
      ctx.stroke();
    }
    for (const y of [-16, 0, 16]) {
      ctx.beginPath();
      ctx.moveTo(-4, y);
      ctx.lineTo(4, y);
      ctx.stroke();
    }
  }
  ctx.restore();
  // papers flutter loose after the throw (or idle spin)
  const f = fling ? seg(p, 0.4, 1) : 0;
  if (fling && f > 0) {
    paper(ctx, o, 54 + f * 16, -50 - f * 18 + Math.sin(f * 14) * 5, f * 5);
    paper(ctx, o, 48 + f * 6, -36 - f * 8 + Math.sin(f * 11) * 5, -f * 4);
  } else if (!fling) {
    paper(ctx, o, 42 + Math.cos(t) * 5, -52 + Math.sin(t) * 6, t);
  }
  ctx.translate(jitter, -Math.abs(Math.sin(t)) * 3 - 6);
  // flailing arms
  const armUp = fling ? lerp(0.4, -1.1, wind) * (1 - hit * 0.5) : Math.sin(t * 2) * 0.6;
  limb(ctx, o, 14, -38, 32, -38 - Math.sin(armUp + 1) * 14, 7, '#a8f0d0');
  limb(ctx, o, -14, -38, -32, -38 + Math.sin(-armUp * 1.3) * 12, 7, '#a8f0d0');
  // body
  blob(ctx, o, 'M0,-62C-22,-62-28,-36-22,-24C-18,-14-10,-14-8,-4C-4,-10,0,-6,2,0C5,-8,10,-10,12,-4C12,-14,20,-14,24,-24C28,-36,22,-62,0,-62Z', '#a8f0d0', '#6fcfa8', '#e6fff4');
  blob(ctx, o, 'M-14,-58L-10,-72L-4,-60Z', '#a8f0d0', '#6fcfa8');
  blob(ctx, o, 'M14,-58L10,-72L4,-60Z', '#a8f0d0', '#6fcfa8');
  if (!o.silhouette) {
    // sneering eyes and a fanged grin
    ball(ctx, o, -8, -42, 5, 6.5, '#f3ecff');
    ball(ctx, o, 8, -42, 5, 6.5, '#f3ecff');
    eyes(ctx, o, [[-6, -41], [10, -41]], 2.4, OUT);
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-15, -50);
    ctx.lineTo(-4, -46);
    ctx.moveTo(15, -50);
    ctx.lineTo(4, -46);
    ctx.stroke();
    blob(ctx, o, 'M-10,-30Q0,-20,10,-30Q0,-26-10,-30Z', OUT);
    ctx.fillStyle = '#f3ecff';
    ctx.beginPath();
    ctx.moveTo(-6, -29);
    ctx.lineTo(-3, -24);
    ctx.lineTo(0, -28);
    ctx.moveTo(6, -29);
    ctx.lineTo(3, -24);
    ctx.lineTo(0, -28);
    ctx.fill();
  }
}

// ---------------------------------------------------------------- Doppelganger
function scroll(ctx: Ctx, o: DrawOpts, x: number, y: number, alpha: number, flip: number): void {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.scale(flip, 1);
  blob(ctx, o, 'M-9,-14h18v28h-18Z', '#e8d6a8', '#bfa86c', '#fff3cf');
  ball(ctx, o, 0, -14, 10, 4, '#cdb27a', '#a08a52');
  ball(ctx, o, 0, 14, 10, 4, '#cdb27a', '#a08a52');
  if (!o.silhouette) {
    ctx.strokeStyle = '#8a7340';
    ctx.lineWidth = 2;
    for (const yy of [-6, 0, 6]) {
      ctx.beginPath();
      ctx.moveTo(-5, yy);
      ctx.lineTo(5, yy);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function doppelFigure(ctx: Ctx, o: DrawOpts, dark: boolean, t: number): void {
  const F = dark ? '#3b2f63' : BONE;
  const S = dark ? '#261e40' : '#cfc3a8';
  const R = dark ? '#5a4a8a' : '#fffaf0';
  limb(ctx, o, -14, -52, -30, -32, 8, F);
  limb(ctx, o, 14, -52, 30, -32, 8, F);
  blob(ctx, o, 'M-12,-34L-3,-34L-3,-2L-14,-2Z', F, S, R);
  blob(ctx, o, 'M12,-34L3,-34L3,-2L14,-2Z', F, S, R);
  blob(ctx, o, 'M-16,-34C-20,-50-14,-62,0,-62C14,-62,20,-50,16,-34Z', F, S, R);
  ball(ctx, o, 0, -76, 16, 17, F, S, R);
  if (!o.silhouette) {
    const eye = dark ? '#5ee08a' : OUT;
    eyes(ctx, o, [[-6, -78], [6, -78]], 4, eye);
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(-9, -68);
    ctx.quadraticCurveTo(0, -61 + Math.sin(t) * 1.5, 9, -68);
    ctx.stroke();
  }
}

function doppelganger(ctx: Ctx, o: DrawOpts, a: string, p: number): void {
  const t = p * TAU;
  ctx.translate(0, -Math.abs(Math.sin(t)) * (a === 'idle' ? 1.5 : 0));
  const copy = a === 'copy';
  const appear = copy ? ease.outBack(seg(p, 0.25, 0.7)) : 0;
  const shim = copy ? Math.sin(seg(p, 0.15, 0.85) * Math.PI) : 0.5 + 0.5 * Math.sin(t);
  doppelFigure(ctx, o, false, t);
  // the mirror half
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, -140, 140, 160);
  ctx.clip();
  doppelFigure(ctx, o, true, t);
  ctx.restore();
  if (!o.silhouette) {
    // mirror seam and shimmer streaks
    ctx.strokeStyle = '#f3ecff';
    ctx.lineWidth = 1.8;
    ctx.globalAlpha = 0.35 + 0.4 * shim;
    ctx.beginPath();
    ctx.moveTo(0, -94);
    ctx.lineTo(0, 0);
    ctx.stroke();
    ctx.globalAlpha = 0.45 * shim;
    for (const k of [0, 1, 2]) {
      const x = -30 + ((p * 90 + k * 30) % 90);
      ctx.beginPath();
      ctx.moveTo(x, -10);
      ctx.lineTo(x + 14, -90);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  // the scroll and its copy
  scroll(ctx, o, -40, -34, 1, 1);
  scroll(ctx, o, lerp(-40, 40, appear), -34 - Math.sin(appear * Math.PI) * 8, copy ? clamp01(appear * 1.5) : 0.0, -1);
  if (!copy) scroll(ctx, o, 40, -34, 0.35, -1);
}

// ---------------------------------------------------------------- Lich
function lich(ctx: Ctx, o: DrawOpts, a: string, p: number): void {
  const t = p * TAU;
  const cast = a === 'cast';
  const charge = cast ? ease.inOutCubic(seg(p, 0, 0.5)) * (1 - seg(p, 0.85, 1) * 0.7) : 0;
  const bob = Math.sin(t) * 2.5 - 5 - charge * 3;
  ctx.translate(0, bob);
  const orb = 7 + charge * 8 + (cast ? 0 : Math.sin(t * 2) * 1.2);
  // soul-light behind
  glow(ctx, o, 0, -62, 80, '#9b6bff', 0.25 + charge * 0.3);
  // power rings
  if (cast && !o.silhouette) {
    ctx.strokeStyle = '#9b6bff';
    ctx.lineWidth = 3;
    for (const k of [0, 1]) {
      const r = ((p * 1.6 + k * 0.5) % 1) * 80;
      ctx.globalAlpha = 1 - r / 80;
      ctx.beginPath();
      ctx.arc(0, -62, r, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  // staff arm (right) holding the orb, claw arm (left)
  const raise = lerp(0, 1, charge);
  limb(ctx, o, 14, -62, 38, lerp(-52, -78, raise), 7, '#4d2fa0');
  limb(ctx, o, -14, -62, -38, lerp(-50, -80, raise), 7, '#4d2fa0');
  limb(ctx, o, 42, -6, 42, -86, 4, '#6b4a2e');
  ball(ctx, o, 42, -92 - charge * 2, orb, orb, '#5ee08a', '#2fa85c', '#c9ffdc');
  glow(ctx, o, 42, -92, orb * 3, '#5ee08a', 0.4 + charge * 0.4);
  ball(ctx, o, -38, lerp(-52, -82, raise), 5, 5, BONE, '#cfc3a8');
  // robe
  blob(ctx, o, 'M-15,-66C-36,-44-44,-18-48,0L-30,-4L-14,2L0,-3L14,2L30,-4L48,0C44,-18,36,-44,15,-66Z', '#6b43c9', '#432a8a', '#9b6bff');
  // ribcage glimpse
  blob(ctx, o, 'M-9,-64L9,-64L7,-38L-7,-38Z', '#2a1d52');
  if (!o.silhouette) {
    ctx.strokeStyle = BONE;
    ctx.lineWidth = 2;
    for (const y of [-60, -54, -48, -42]) {
      ctx.beginPath();
      ctx.moveTo(-6, y);
      ctx.lineTo(6, y);
      ctx.stroke();
    }
  }
  // skull, big and horned crown
  ball(ctx, o, 0, -80, 15, 15, BONE, '#cfc3a8', '#fffaf0');
  blob(ctx, o, 'M-16,-90L-14,-106L-8,-94L0,-110L8,-94L14,-106L16,-90Z', '#ffc247', '#c98f1c', '#ffe08a');
  blob(ctx, o, 'M-12,-92L-22,-104L-10,-98Z', BONE, '#cfc3a8');
  blob(ctx, o, 'M12,-92L22,-104L10,-98Z', BONE, '#cfc3a8');
  eyes(ctx, o, [[-6, -80], [6, -80]], 4.2 + charge * 1.5, '#5ee08a');
  if (!o.silhouette) {
    ctx.fillStyle = OUT;
    ctx.beginPath();
    ctx.moveTo(0, -75);
    ctx.lineTo(-2.4, -70.5);
    ctx.lineTo(2.4, -70.5);
    ctx.fill();
  }
}

// ---------------------------------------------------------------- Banshee
function banshee(ctx: Ctx, o: DrawOpts, a: string, p: number): void {
  const t = p * TAU;
  const scream = a === 'scream';
  const open = scream ? ease.inOutCubic(seg(p, 0, 0.25)) * (1 - seg(p, 0.85, 1)) : 0;
  ctx.translate(0, Math.sin(t) * 3.5 - 6);
  glow(ctx, o, 0, -58, 64, '#7fe3e0', 0.25 + open * 0.2);
  if (scream && !o.silhouette) {
    ctx.strokeStyle = '#bff6f2';
    ctx.lineWidth = 3;
    for (const k of [0, 1, 2]) {
      const r = ((p * 1.8 + k * 0.33) % 1) * 60 + 10;
      ctx.globalAlpha = (1 - (r - 10) / 60) * 0.7;
      ctx.beginPath();
      ctx.arc(14, -64, r, -0.7, 0.7);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  // long streaming hair
  blob(ctx, o, `M-14,-82C-34,-76-36,-40-30,-10C-26,-30-20,-48-12,-56ZM14,-82C34,-76${36 + Math.sin(t) * 3},-40${30 + Math.sin(t) * 3},-10C26,-30,20,-48,12,-56Z`, '#cfe9f2', '#9bc4d4', '#f4fdff');
  // gown with ragged hem
  blob(ctx, o, `M-14,-60C-26,-36-30,-16-34,-2L-24,-8L-16,2L-8,-6L0,2L8,-6L16,2L24,-8L34,-2C30,-16,26,-36,14,-60Z`, '#8fb7d9', '#5f88aa', '#cfe9f6');
  ball(ctx, o, 0, -72, 13, 15, '#e6f3f8', '#b6d3df', '#ffffff');
  eyes(ctx, o, [[-5, -75], [5, -75]], 2.6, '#14101f');
  ctx.fillStyle = OUT;
  ctx.beginPath();
  ctx.ellipse(0, -66, 4 + open * 2, 2 + open * 8, 0, 0, TAU);
  ctx.fill();
}

// ---------------------------------------------------------------- Goblin
function goblin(ctx: Ctx, o: DrawOpts, a: string, p: number): void {
  const t = p * TAU;
  const hoard = a === 'hoard';
  const full = hoard ? ease.inOutCubic(seg(p, 0.1, 0.8)) : 0;
  const hop = hoard ? Math.abs(Math.sin(p * TAU * 3)) * -3 : Math.sin(t * 2) * -1.5;
  ctx.translate(0, hop);
  // sack
  const s = 1 + full * 0.45;
  ctx.save();
  ctx.translate(-24, -2);
  ctx.scale(s, s);
  blob(ctx, o, 'M-12,0C-20,-14-10,-26,-4,-30L4,-30C10,-26,20,-14,12,0Z', '#9c7a4a', '#6f5430', '#c9a56e');
  limb(ctx, o, -5, -31, 5, -31, 3, '#6b4a2e');
  ctx.restore();
  if (hoard && !o.silhouette) {
    for (const k of [0, 1, 2]) {
      const q = (p * 2 + k / 3) % 1;
      ball(ctx, o, lerp(24, -22, q), -70 + Math.sin(q * Math.PI) * -22 + q * 52, 4, 4, '#ffc247', '#c98f1c', '#ffe08a');
    }
  }
  // legs and body
  for (const x of [-7, 7]) blob(ctx, o, `M${x - 5},-18L${x + 5},-18L${x + 6},0L${x - 6},0Z`, '#4d5a2f');
  blob(ctx, o, 'M-14,-18C-18,-34-8,-44,0,-44C8,-44,18,-34,14,-18Z', '#6b4a2e', '#4a3220', '#946a40');
  // arm
  const reach = hoard ? Math.sin(p * TAU * 2) * 0.5 : Math.sin(t) * 0.1;
  ctx.save();
  ctx.translate(10, -38);
  ctx.rotate(-0.6 + reach);
  limb(ctx, o, 0, 0, 20, 4, 6, '#7bb35a');
  ctx.restore();
  // head and big ears
  blob(ctx, o, 'M-12,-58L-34,-66L-14,-48ZM12,-58L34,-66L14,-48Z', '#7bb35a', '#558a3a');
  ball(ctx, o, 0, -54, 14, 12, '#7bb35a', '#558a3a', '#b4e08f');
  eyes(ctx, o, [[-5, -56], [5, -56]], 3, '#ffe08a');
  eyes(ctx, o, [[-5, -56], [5, -56]], 1.2, OUT);
  if (!o.silhouette) {
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(-5, -48);
    ctx.lineTo(0, -45);
    ctx.lineTo(5, -48);
    ctx.stroke();
  }
}

// ---------------------------------------------------------------- Imp
function imp(ctx: Ctx, o: DrawOpts, a: string, p: number): void {
  const t = p * TAU;
  const th = a === 'throw';
  const wind = th ? ease.inOutCubic(seg(p, 0, 0.35)) : 0;
  const rel = th ? ease.inOutCubic(seg(p, 0.35, 0.5)) : 0;
  const fly = th ? seg(p, 0.5, 1) : 0;
  ctx.translate(0, Math.sin(t * (th ? 1 : 2)) * 3 - 10);
  const flap = Math.sin(t * 4) * 0.35;
  for (const sd of [-1, 1]) {
    ctx.save();
    ctx.scale(sd, 1);
    ctx.translate(8, -50);
    ctx.rotate(-0.5 - flap);
    blob(ctx, o, 'M0,0C14,-22,34,-22,40,-10C32,-12,28,-6,24,-4C20,-8,12,-4,0,6Z', '#8a2f4a', '#5c1d33', '#b8546f');
    ctx.restore();
  }
  // body, tail
  blob(ctx, o, 'M8,-14C24,-14,32,-22,30,-34C28,-24,20,-20,8,-22Z', '#d6453d', '#9e2d29');
  blob(ctx, o, 'M-10,-20C-14,-36-8,-48,0,-48C8,-48,14,-36,10,-20Z', '#d6453d', '#9e2d29', '#ff8a70');
  for (const x of [-5, 5]) blob(ctx, o, `M${x - 3},-20L${x + 3},-20L${x + 3},-6L${x - 3},-6Z`, '#b8352f');
  // throwing arm and spanner
  ctx.save();
  ctx.translate(9, -42);
  const ang = lerp(-0.4, -2.3, wind) + lerp(0, 2.7, rel);
  ctx.rotate(ang);
  limb(ctx, o, 0, 0, 0, 16, 5, '#d6453d');
  if (fly === 0) {
    limb(ctx, o, 0, 14, 0, 32, 4, '#aab4c8');
    ball(ctx, o, 0, 34, 6, 6, '#aab4c8', '#7c869c', '#e3eaf7');
  }
  ctx.restore();
  if (fly > 0) {
    ctx.save();
    ctx.translate(lerp(14, 74, fly), lerp(-40, -14, fly) - Math.sin(fly * Math.PI) * 30);
    ctx.rotate(fly * 14);
    limb(ctx, o, -10, 0, 10, 0, 4, '#aab4c8');
    ball(ctx, o, 12, 0, 6, 6, '#aab4c8', '#7c869c', '#e3eaf7');
    ctx.restore();
  }
  ctx.save();
  ctx.translate(-6, -42);
  ctx.rotate(-0.2 + Math.sin(t) * 0.1);
  limb(ctx, o, 0, 0, -8, 14, 5, '#d6453d');
  ctx.restore();
  // head, horns
  blob(ctx, o, 'M-9,-58L-14,-72L-3,-62ZM9,-58L14,-72L3,-62Z', '#f1e6c8', '#bfb18b');
  ball(ctx, o, 0, -56, 13, 12, '#d6453d', '#9e2d29', '#ff8a70');
  eyes(ctx, o, [[-5, -57], [5, -57]], 3.2, '#ffe08a');
  eyes(ctx, o, [[-5, -57], [5, -57]], 1.3, OUT);
  if (!o.silhouette) {
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(-6, -50);
    ctx.quadraticCurveTo(0, -46, 6, -50);
    ctx.stroke();
  }
}

// ---------------------------------------------------------------- Gargoyle
function gargoyle(ctx: Ctx, o: DrawOpts, a: string, p: number): void {
  const t = p * TAU;
  const land = a === 'land';
  const drop = land ? 1 - ease.outBounce(seg(p, 0, 0.45)) : 0;
  const fold = land ? ease.inOutCubic(seg(p, 0.45, 0.8)) : 0;
  ctx.translate(0, -drop * 46);
  const flap = land ? (1 - seg(p, 0, 0.45)) * 0.5 : Math.sin(t) * 0.04;
  const G = '#8a8fa3';
  const GS = '#5f6478';
  const GR = '#c0c5d8';
  for (const sd of [-1, 1]) {
    ctx.save();
    ctx.scale(sd, 1);
    ctx.translate(10, -48);
    ctx.rotate(-0.3 - flap + fold * 0.5);
    blob(ctx, o, `M0,0C10,-${30 - fold * 18},32,-${34 - fold * 20},44,-${22 - fold * 10}L34,-14L28,-18L18,-8L10,-12Z`, '#6d7288', GS, GR);
    ctx.restore();
  }
  // crouched body, tail
  blob(ctx, o, 'M-12,-4C-30,-4-34,-14-26,-20C-24,-12-16,-10-10,-14Z', G, GS);
  blob(ctx, o, 'M-18,0C-22,-24-14,-48,0,-48C14,-48,22,-24,18,0Z', G, GS, GR);
  blob(ctx, o, 'M-22,0L-22,-8L-6,-8L-6,0ZM6,0L6,-8L22,-8L22,0Z', GS, '#4a4e60');
  // head, horns, snarl
  blob(ctx, o, 'M-10,-62L-16,-76L-4,-66ZM10,-62L16,-76L4,-66Z', '#5f6478', '#4a4e60');
  blob(ctx, o, 'M-14,-70C-14,-82,14,-82,14,-70L12,-54L-12,-54Z', G, GS, GR);
  eyes(ctx, o, [[-6, -68], [6, -68]], 3, '#ff9a3c');
  if (!o.silhouette) {
    ctx.fillStyle = OUT;
    ctx.fillRect(-8, -60, 16, 4);
    ctx.fillStyle = BONE;
    for (const x of [-6, -1, 4]) ctx.fillRect(x, -60, 3, 3);
  }
}

// ---------------------------------------------------------------- Mummy
function mummy(ctx: Ctx, o: DrawOpts, a: string, p: number): void {
  const t = p * TAU;
  const wrap = a === 'wrap';
  const reach = wrap ? ease.inOutCubic(seg(p, 0, 0.4)) : 0;
  const unroll = wrap ? seg(p, 0.3, 1) : 0;
  ctx.translate(0, -Math.abs(Math.sin(t)) * (wrap ? 0.5 : 2));
  const B = '#dcd0b0';
  const BS = '#aa9d7c';
  const BR = '#f5ecd2';
  for (const x of [-7, 7]) blob(ctx, o, `M${x - 6},-30L${x + 6},-30L${x + 7},0L${x - 7},0Z`, B, BS, BR);
  blob(ctx, o, 'M-16,-30C-20,-48-14,-62,0,-62C14,-62,20,-48,16,-30Z', B, BS, BR);
  if (!o.silhouette) {
    ctx.strokeStyle = BS;
    ctx.lineWidth = 2;
    for (const y of [-56, -48, -40, -34]) {
      ctx.beginPath();
      ctx.moveTo(-15, y + 4);
      ctx.lineTo(15, y - 4);
      ctx.stroke();
    }
  }
  // arms straight out, bandage trailing
  const lift = lerp(-0.1, -1.45, reach);
  for (const sd of [1, -1]) {
    ctx.save();
    ctx.translate(sd * 14, -56);
    ctx.rotate(sd * (lift + Math.sin(t) * 0.04 * (1 - reach)) * -1 + (sd === 1 ? 0 : 0));
    limb(ctx, o, 0, 0, sd * 4, 28, 8, B);
    ctx.restore();
  }
  if (wrap && !o.silhouette) {
    ctx.strokeStyle = BR;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(30, -58);
    ctx.bezierCurveTo(30 + 20 * unroll, -50, 30 + 30 * unroll, -30 + Math.sin(t * 2) * 6, 30 + 44 * unroll, -22);
    ctx.stroke();
  }
  // head wrap, eyes
  ball(ctx, o, 0, -74, 14, 14, B, BS, BR);
  if (!o.silhouette) {
    ctx.fillStyle = OUT;
    ctx.fillRect(-10, -78, 20, 7);
  }
  eyes(ctx, o, [[-5, -74.5], [5, -74.5]], 2.4, '#5ee08a');
}

// ---------------------------------------------------------------- Werewolf
function werewolf(ctx: Ctx, o: DrawOpts, a: string, p: number): void {
  const t = p * TAU;
  const howl = a === 'howl';
  const up = howl ? ease.inOutCubic(seg(p, 0, 0.3)) * (1 - seg(p, 0.85, 1)) : 0;
  const moon = howl ? ease.outBack(seg(p, 0.15, 0.7)) : 0;
  if (howl && !o.silhouette) {
    glow(ctx, o, 30, lerp(-20, -92, moon), 40, '#fff2b8', 0.5);
    ball(ctx, o, 30, lerp(-20, -92, moon), 15, 15, '#fff2b8', '#e3cf86', '#ffffff');
  }
  ctx.translate(0, Math.sin(t * 2) * -1.5 * (1 - up));
  const F = '#7a5a43';
  const FS = '#523a2a';
  const FR = '#a98163';
  for (const x of [-9, 9]) blob(ctx, o, `M${x - 7},-26L${x + 7},-26L${x + 9},0L${x - 9},0Z`, F, FS);
  blob(ctx, o, 'M-18,-26C-26,-46-14,-62,2,-60C18,-58,26,-44,18,-26Z', F, FS, FR);
  blob(ctx, o, 'M-12,-26C-14,-36-4,-40,0,-36C4,-40,14,-36,12,-26Z', '#c8a888', '#a08064');
  ctx.save();
  ctx.translate(14, -50);
  ctx.rotate(-0.3 - up * 1.1 + Math.sin(t) * 0.05);
  limb(ctx, o, 0, 0, 6, 26, 8, F);
  blob(ctx, o, 'M0,24L6,34L10,24L14,32L16,22L10,20Z', '#efe6d2');
  ctx.restore();
  // head tilts back during the howl
  ctx.save();
  ctx.translate(2, -62);
  ctx.rotate(-up * 0.7);
  blob(ctx, o, 'M-8,-10L-10,-28L2,-16ZM6,-10L14,-26L12,-12Z', F, FS, FR);
  ball(ctx, o, 0, -6, 14, 13, F, FS, FR);
  const jaw = 3 + up * 9;
  blob(ctx, o, `M6,-8L26,${-4 - jaw * 0.2}L24,${2 + jaw}L6,${2 + jaw * 0.5}Z`, '#8a6a52', FS);
  eyes(ctx, o, [[3, -9]], 3, '#ffe08a');
  eyes(ctx, o, [[3.6, -9]], 1.2, OUT);
  ball(ctx, o, 25, -4, 3, 3, OUT);
  ctx.restore();
}

// ---------------------------------------------------------------- Will-o'-Wisp
function wisp(ctx: Ctx, o: DrawOpts, a: string, p: number): void {
  const t = p * TAU;
  const lead = a === 'lead';
  const dx = lead ? ease.inOutCubic(seg(p, 0.1, 0.9)) * 40 : 0;
  const bob = Math.sin(t * (lead ? 2 : 1)) * 5;
  ctx.translate(dx, bob - 28);
  if (lead && !o.silhouette) {
    for (const k of [1, 2, 3, 4]) {
      ctx.globalAlpha = 0.5 - k * 0.1;
      ball(ctx, o, -k * 9, Math.sin(t * 2 - k) * 3 + 6, 7 - k, 9 - k * 1.5, '#7fd9ff');
    }
    ctx.globalAlpha = 1;
  }
  glow(ctx, o, 0, 0, 56, '#7fd9ff', 0.45);
  // flame
  blob(ctx, o, `M0,-34C${10 + Math.sin(t * 3) * 3},-16,18,-6,16,6C14,18,-14,18,-16,6C-18,-6,-10,-16,0,-34Z`, '#7fd9ff', '#3f9fd1', '#e3f8ff');
  blob(ctx, o, 'M0,-16C6,-8,9,-2,7,5C5,11,-5,11,-7,5C-9,-2,-6,-8,0,-16Z', '#f4fdff');
  eyes(ctx, o, [[-5, 2], [5, 2]], 2.4, '#14101f');
  // tiny lantern it dangles
  limb(ctx, o, 14, -2, 26, 10, 2, '#6b4a2e');
  blob(ctx, o, 'M22,10L34,10L33,24L23,24Z', '#ffc247', '#c98f1c', '#ffe08a');
}

// ---------------------------------------------------------------- Witch
function witch(ctx: Ctx, o: DrawOpts, a: string, p: number): void {
  const t = p * TAU;
  const hex = a === 'hex';
  const swing = hex ? Math.sin(p * TAU * 2) * 0.5 : Math.sin(t) * 0.08;
  ctx.translate(0, Math.sin(t) * 2.5 - 4);
  if (hex && !o.silhouette) {
    for (const k of [0, 1, 2, 3, 4]) {
      const q = (p * 1.5 + k / 5) % 1;
      ctx.globalAlpha = 1 - q;
      ball(ctx, o, 30 + Math.cos(q * TAU * 1.5 + k) * 14, -60 - q * 30 + Math.sin(q * TAU * 1.5 + k) * 6, 3, 3, '#7bf07a');
    }
    ctx.globalAlpha = 1;
  }
  // broom-less robe
  blob(ctx, o, 'M-12,-54C-26,-34-32,-14-34,0L-16,-4L0,2L16,-4L34,0C32,-14,26,-34,12,-54Z', '#5b2f8a', '#3c1d5c', '#8a55c4');
  // wand arm
  ctx.save();
  ctx.translate(12, -48);
  ctx.rotate(-1.0 + swing);
  limb(ctx, o, 0, 0, 0, 22, 6, '#5b2f8a');
  limb(ctx, o, 0, 22, 0, 44, 3, '#6b4a2e');
  ball(ctx, o, 0, 46, 3.5, 3.5, '#7bf07a');
  ctx.restore();
  // face, hair, hat
  blob(ctx, o, 'M-12,-66C-20,-56-18,-46-14,-42L-10,-60Z', '#2a2236');
  ball(ctx, o, 0, -64, 12, 13, '#a8d98a', '#7aa862', '#d6f5bf');
  eyes(ctx, o, [[-4, -66], [4, -66]], 2.4, OUT);
  blob(ctx, o, 'M2,-62L6,-56L9,-62Z', '#8fbf70');
  blob(ctx, o, 'M-24,-74C-12,-80,12,-80,24,-74C12,-70-12,-70-24,-74Z', '#3c1d5c', '#2a1442', '#5b2f8a');
  blob(ctx, o, `M-12,-76L-4,-98L${8 + Math.sin(t) * 2},-110L8,-76Z`, '#3c1d5c', '#2a1442', '#5b2f8a');
  blob(ctx, o, 'M-12,-80L12,-80L12,-76L-12,-76Z', '#ffc247', '#c98f1c');
}

// ---------------------------------------------------------------- Banshee Queen
function bansheeQueen(ctx: Ctx, o: DrawOpts, a: string, p: number): void {
  const t = p * TAU;
  const wail = a === 'wail';
  const open = wail ? ease.inOutCubic(seg(p, 0, 0.3)) * (1 - seg(p, 0.85, 1)) : 0;
  ctx.translate(0, Math.sin(t) * 3 - 6);
  glow(ctx, o, 0, -58, 80, '#b48cff', 0.28 + open * 0.3);
  if (wail && !o.silhouette) {
    ctx.strokeStyle = '#d9c6ff';
    ctx.lineWidth = 3;
    for (const k of [0, 1, 2, 3]) {
      const r = ((p * 1.8 + k * 0.25) % 1) * 70 + 10;
      ctx.globalAlpha = (1 - (r - 10) / 70) * 0.7;
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(dir * 12, -66, r, dir < 0 ? Math.PI - 0.7 : -0.7, dir < 0 ? Math.PI + 0.7 : 0.7);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
  const sw = Math.sin(t) * 3;
  // streaming hair and trailing veil
  blob(ctx, o, `M-14,-82C-40,-76-44,-40-36,-8C-30,-30-22,-48-12,-58ZM14,-82C40,-76${44 + sw},-40${36 + sw},-8C30,-30,22,-48,12,-58Z`, '#d9c6ff', '#a98ae0', '#f5eeff');
  // gown, wider than the banshee, with ragged hem
  blob(ctx, o, 'M-15,-60C-30,-36-38,-16-42,-2L-30,-8L-20,2L-10,-6L0,2L10,-6L20,2L30,-8L42,-2C38,-16,30,-36,15,-60Z', '#6a4fb8', '#47318a', '#a98ae0');
  blob(ctx, o, 'M-9,-56L0,-34L9,-56L5,-60L-5,-60Z', '#3a2670');
  ball(ctx, o, 0, -72, 13, 15, '#eef2fa', '#c2cde0', '#ffffff');
  // crown of shards
  blob(ctx, o, 'M-14,-84L-13,-100L-7,-90L0,-106L7,-90L13,-100L14,-84Z', '#ffc247', '#c98f1c', '#ffe08a');
  eyes(ctx, o, [[-5, -75], [5, -75]], 2.8 + open, '#14101f');
  ctx.fillStyle = OUT;
  ctx.beginPath();
  ctx.ellipse(0, -66, 4.5 + open * 2.5, 2 + open * 9, 0, 0, TAU);
  ctx.fill();
}

// ---------------------------------------------------------------- Headless Horseman
function horseman(ctx: Ctx, o: DrawOpts, a: string, p: number): void {
  const t = p * TAU;
  const hurl = a === 'hurl';
  const wind = hurl ? ease.inOutCubic(seg(p, 0, 0.45)) : 0;
  const rel = hurl ? seg(p, 0.45, 0.8) : 0;
  const bob = Math.sin(t) * 2 - 2;
  ctx.translate(0, bob);
  // cape streaming behind
  const flap = Math.sin(t) * 4;
  blob(ctx, o, `M-14,-66C-34,-52-50,-30${-52 + flap},-4L-34,-12L-22,-2L-6,-8L10,-66Z`, '#2a2140', '#1b1430', '#4a3a70');
  // legs and boots
  limb(ctx, o, -7, -24, -9, -4, 8, '#3a2e58');
  limb(ctx, o, 7, -24, 9, -4, 8, '#3a2e58');
  blob(ctx, o, 'M-16,-4L-3,-4L-3,2L-18,2Z', '#14101f');
  blob(ctx, o, 'M3,-4L16,-4L18,2L3,2Z', '#14101f');
  // torso in a dark coat with orange buttons
  blob(ctx, o, 'M-16,-68L16,-68L18,-22L-18,-22Z', '#3d2f66', '#2a2048', '#6a55a8');
  if (!o.silhouette) {
    ctx.fillStyle = '#ff8a2b';
    for (const y of [-58, -48, -38]) {
      ctx.beginPath();
      ctx.arc(0, y, 2.2, 0, TAU);
      ctx.fill();
    }
  }
  // neck stump and high collar
  blob(ctx, o, 'M-9,-74L9,-74L12,-64L-12,-64Z', '#6a55a8', '#3d2f66');
  // sword arm (left) and pumpkin arm (right)
  limb(ctx, o, -15, -62, -34, lerp(-46, -66, wind), 7, '#3d2f66');
  limb(ctx, o, -34, lerp(-46, -66, wind), -40, lerp(-84, -96, wind), 3, '#cfd6e6');
  const px = lerp(26, 58, rel);
  const py = lerp(-88, -50, rel) - wind * 6 + (1 - wind) * 38 * (hurl ? 0 : 1);
  limb(ctx, o, 15, -62, hurl && rel > 0 ? 28 : px - 4, hurl && rel > 0 ? -70 : py + 14, 7, '#3d2f66');
  // burning pumpkin where the head should be (held aloft)
  const fl = Math.sin(t * 3) * 2;
  glow(ctx, o, px, py, 34, '#ff8a2b', 0.45 + wind * 0.35);
  ball(ctx, o, px, py, 14, 12, '#ff8a2b', '#c9560c', '#ffc27a');
  blob(ctx, o, `M${px - 2},${py - 12}L${px + 2},${py - 12}L${px + 3},${py - 17}L${px - 3},${py - 17}Z`, '#5a8a2a');
  blob(ctx, o, `M${px - 8},${py - 10}C${px - 10},${py - 22 - fl}${px - 2},${py - 24}${px},${py - 30 - fl}C${px + 2},${py - 22}${px + 10},${py - 20 - fl}${px + 8},${py - 10}Z`, '#ffd34d', '#ff8a2b', '#fff0a8');
  eyes(ctx, o, [[px - 5, py - 2], [px + 5, py - 2]], 2.6, '#14101f');
  eyes(ctx, o, [[px, py + 5]], 2.2, '#14101f');
}

// ---------------------------------------------------------------- Gremlin
// Small and mischievous (tournament-v3 section 5.3, the floor rule): batwing ears, a toothy grin, a cheeky hop.
// idle: hops and rubs its hands. prank: yanks a wire out of the wall, a spark pops, it cackles.
function gremlin(ctx: Ctx, o: DrawOpts, a: string, p: number): void {
  const t = p * TAU;
  const prank = a === 'prank';
  const wind = prank ? ease.inOutCubic(seg(p, 0, 0.35)) : 0;
  const yank = prank ? ease.inOutCubic(seg(p, 0.35, 0.5)) : 0;
  const zap = prank ? seg(p, 0.5, 0.9) : 0;
  const hop = prank ? -Math.abs(Math.sin(p * TAU * 2)) * 5 : -Math.abs(Math.sin(t)) * 6;
  ctx.scale(0.92, 0.92);
  ctx.translate(0, hop);
  // the wire it pulls: from a little socket on the right to its hand
  const hx = lerp(14, 30, yank) - wind * 4;
  const hy = lerp(-30, -34, yank);
  if (prank) {
    ctx.beginPath();
    ctx.moveTo(40, -14);
    ctx.quadraticCurveTo(lerp(34, 44, yank), lerp(-6, -26, yank), hx, hy);
    ctx.lineWidth = 8; ctx.strokeStyle = OUT; ctx.stroke();
    if (!o.silhouette) { ctx.lineWidth = 3.4; ctx.strokeStyle = '#ffb020'; ctx.stroke(); }
    if (zap > 0 && zap < 1 && !o.silhouette) {
      glow(ctx, o, hx + 4, hy - 6, 26, '#fff08a', 0.85 * (1 - zap));
      ctx.strokeStyle = '#fff08a'; ctx.lineWidth = 3; ctx.beginPath();
      for (let k = 0; k < 5; k++) { const ang = (k / 5) * TAU + 0.4; ctx.moveTo(hx + Math.cos(ang) * 6, hy - 6 + Math.sin(ang) * 6); ctx.lineTo(hx + Math.cos(ang) * (12 + zap * 12), hy - 6 + Math.sin(ang) * (12 + zap * 12)); }
      ctx.stroke();
    }
  }
  // spindly legs and a tail with a spade tip
  for (const x of [-7, 7]) limb(ctx, o, x, -16, x + (x < 0 ? -2 : 2), -1, 5, '#6f8f86');
  ctx.save();
  ctx.translate(-10, -18);
  ctx.rotate(Math.sin(t * 2) * 0.25);
  limb(ctx, o, 0, 0, -18, -8, 3, '#6f8f86');
  blob(ctx, o, 'M-18,-8L-27,-14L-23,-3Z', '#ff8a2b', '#c9560c');
  ctx.restore();
  // body
  blob(ctx, o, 'M-12,-16C-16,-32-8,-40,0,-40C8,-40,16,-32,12,-16Z', '#7fa89b', '#567a6f', '#b6dccf');
  blob(ctx, o, 'M-6,-34C-4,-26,4,-26,6,-34C4,-18,-4,-18,-6,-34Z', '#d9ead3', '#a9c3a0');
  // arms: rubbing hands while idle, one pulling while pranking
  if (prank) {
    limb(ctx, o, 10, -34, hx, hy, 5, '#7fa89b');
    ball(ctx, o, hx, hy, 4.4, 4.4, '#9ac1b3', '#6f8f86', '#d4eee4');
    limb(ctx, o, -10, -34, -18, -26 - wind * 8, 5, '#7fa89b');
  } else {
    const rub = Math.sin(t * 3) * 3;
    limb(ctx, o, -10, -34, -2 + rub, -26, 5, '#7fa89b');
    limb(ctx, o, 10, -34, 2 - rub, -26, 5, '#7fa89b');
  }
  // big batwing ears
  for (const sd of [-1, 1]) {
    ctx.save();
    ctx.scale(sd, 1);
    ctx.rotate(Math.sin(t * 2) * 0.08 * (prank ? 2 : 1));
    blob(ctx, o, 'M9,-52C14,-62,26,-78,40,-84C38,-70,36,-58,24,-44C18,-46,12,-46,9,-46Z', '#7fa89b', '#567a6f', '#b6dccf');
    blob(ctx, o, 'M14,-54C19,-62,27,-72,35,-77C34,-67,32,-58,24,-50C20,-50,16,-50,14,-50Z', '#e9a0a8', '#c06a7b');
    ctx.restore();
  }
  // head: a tuft of spikes, glowing eyes, the grin
  blob(ctx, o, 'M-6,-62L-3,-72L0,-63L4,-73L6,-62Z', '#567a6f', '#3d5a51');
  ball(ctx, o, 0, -52, 14.5, 12.5, '#7fa89b', '#567a6f', '#b6dccf');
  glow(ctx, o, 0, -54, 24, '#ffb020', 0.22);
  eyes(ctx, o, [[-5.5, -54], [5.5, -54]], 4, '#fff6c8');
  eyes(ctx, o, [[-5, -54 + (prank ? 0.5 : 0)], [6, -54 + (prank ? 0.5 : 0)]], 1.8, OUT);
  if (!o.silhouette) {
    ctx.strokeStyle = OUT; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(-9, -60); ctx.lineTo(-3, -57); ctx.moveTo(9, -60); ctx.lineTo(3, -57); ctx.stroke(); // slanted brows
    const grin = prank ? 5 + Math.sin(p * TAU * 6) * 1.2 : 3;
    ctx.fillStyle = OUT;
    ctx.beginPath(); ctx.moveTo(-8, -48); ctx.quadraticCurveTo(0, -48 + grin * 2.2, 8, -48); ctx.quadraticCurveTo(0, -47, -8, -48); ctx.fill();
    ctx.fillStyle = '#fff6e0';
    for (const x of [-5, -1.5, 2, 5]) { ctx.beginPath(); ctx.moveTo(x - 1.4, -47.6); ctx.lineTo(x + 1.4, -47.6); ctx.lineTo(x, -44.4); ctx.closePath(); ctx.fill(); }
  }
}

const DRAW: Record<CreatureId, (ctx: Ctx, o: DrawOpts, anim: string, p: number) => void> = {
  reaper, zombie, ghost, wraith, poltergeist, doppelganger, lich,
  banshee, goblin, imp, gargoyle, mummy, werewolf, wisp, witch, gremlin,
  banshee_queen: bansheeQueen, horseman,
};

export function drawCreature(ctx: Ctx, id: CreatureId, anim: string, p: number, o: DrawOpts): void {
  unit(ctx, o, () => DRAW[id](ctx, o, anim, p));
}

for (const c of CREATURES) {
  registerSprite({
    id: `creature-${c.id}`,
    name: c.name,
    group: c.group,
    anims: c.anims.map((x) => ({ ...x })),
    draw(ctx, anim, p, opts) {
      drawCreature(ctx, c.id, anim.id, p, opts);
    },
  });
}
