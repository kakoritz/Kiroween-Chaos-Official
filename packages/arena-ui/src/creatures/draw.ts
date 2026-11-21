/// <reference lib="dom" />
// Code-drawn creatures (UI-ART3). Same style guide as the skeleton rig: 4 px #14101f outline,
// rounded joins, flat fill, one shade crescent (bottom right), one rim crescent (top left).
// Units: a 100-tall box, centred on x = 0, feet at y = 0, up is negative.
import { registerSprite, ease, type DrawOpts } from '../lab/registry';
import { CREATURES, type CreatureId } from './defs';

const OUT = '#14101f';
const BONE = '#efe6d2';
const TAU = Math.PI * 2;
type Ctx = CanvasRenderingContext2D;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const seg = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));

const cache = new Map<string, Path2D>();
const pathOf = (d: string): Path2D => {
  let p = cache.get(d);
  if (!p) cache.set(d, (p = new Path2D(d)));
  return p;
};

function unit(ctx: Ctx, o: DrawOpts, fn: () => void): void {
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
function blob(ctx: Ctx, o: DrawOpts, d: string | Path2D, fill: string, shade?: string, rim?: string): void {
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

function ball(ctx: Ctx, o: DrawOpts, x: number, y: number, rx: number, ry: number, fill: string, shade?: string, rim?: string): void {
  const p = new Path2D();
  p.ellipse(x, y, rx, ry, 0, 0, TAU);
  blob(ctx, o, p, fill, shade, rim);
}

/** Thick outlined limb, pole or chain segment. */
function limb(ctx: Ctx, o: DrawOpts, x1: number, y1: number, x2: number, y2: number, w: number, fill: string): void {
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

function glow(ctx: Ctx, o: DrawOpts, x: number, y: number, r: number, color: string, alpha: number): void {
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

function eyes(ctx: Ctx, o: DrawOpts, pts: Array<[number, number]>, r: number, color: string): void {
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

const DRAW: Record<CreatureId, (ctx: Ctx, o: DrawOpts, anim: string, p: number) => void> = {
  reaper, zombie, ghost, wraith, poltergeist, doppelganger, lich,
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
