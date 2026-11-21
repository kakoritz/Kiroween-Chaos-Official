/// <reference lib="dom" />
// Crypt props and background layers (UI-ART4). Everything is drawn in code to
// docs/ART-DIRECTION.md: 4 px #14101f outline, flat fills, one shade, one rim.
// Props use the sprite lab convention: centred on x = 0, feet at y = 0 after unit(),
// 100 units tall. The layer painters (arches, pillars, floor tiles) draw into a rect.
import { registerSprite, type DrawOpts } from '../lab/registry';

type Ctx = CanvasRenderingContext2D;

const OUT = '#14101f';
const BONE = '#efe6d2';
const WOOD = '#4a3322';
const STONE = '#2a2446';
const STONE_DARK = '#1c1830';
const TORCH = '#ff9a3c';
const TAU = Math.PI * 2;

export const PROP_IDS = ['barrel', 'candles', 'bones', 'sealed-scroll', 'torch', 'keyhole-door', 'pillar', 'arch'] as const;
export type PropId = (typeof PROP_IDS)[number];

function unit(ctx: Ctx, o: DrawOpts, fn: () => void): void {
  const s = o.size / 100;
  ctx.save();
  ctx.translate(0, o.size / 2);
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = 4;
  ctx.strokeStyle = OUT;
  fn();
  ctx.restore();
}

const fillOf = (o: DrawOpts, c: string): string => (o.silhouette ? OUT : c);

function rect(ctx: Ctx, o: DrawOpts, x: number, y: number, w: number, h: number, fill: string, r = 4): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  ctx.fillStyle = fillOf(o, fill);
  ctx.fill();
  ctx.stroke();
}

function flame(ctx: Ctx, o: DrawOpts, x: number, y: number, s: number, t: number): void {
  const f = 1 + 0.18 * Math.sin(t * TAU * 3 + x) + 0.08 * Math.sin(t * TAU * 7 + x * 2);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s * f);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(-9, -4, -6, -16, 0, -26);
  ctx.bezierCurveTo(6, -16, 9, -4, 0, 0);
  ctx.closePath();
  ctx.fillStyle = fillOf(o, TORCH);
  ctx.fill();
  ctx.stroke();
  if (!o.silhouette) {
    ctx.fillStyle = '#ffe08a';
    ctx.beginPath();
    ctx.ellipse(0, -7, 3.2, 6, 0, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function halo(ctx: Ctx, o: DrawOpts, x: number, y: number, r: number, a: number): void {
  if (o.silhouette) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, 'rgba(255,154,60,0.55)');
  g.addColorStop(1, 'rgba(255,154,60,0)');
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.restore();
}

function barrel(ctx: Ctx, o: DrawOpts): void {
  ctx.beginPath();
  ctx.moveTo(-26, 0); ctx.bezierCurveTo(-36, -22, -36, -52, -26, -72);
  ctx.lineTo(26, -72); ctx.bezierCurveTo(36, -52, 36, -22, 26, 0); ctx.closePath();
  ctx.fillStyle = fillOf(o, WOOD);
  ctx.fill();
  ctx.stroke();
  if (o.silhouette) return;
  ctx.fillStyle = '#2f2016'; // shade layer, left
  ctx.beginPath(); ctx.moveTo(-26, -4); ctx.bezierCurveTo(-33, -24, -33, -50, -25, -68); ctx.lineTo(-14, -68); ctx.bezierCurveTo(-20, -48, -20, -24, -14, -4); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#7a5736'; // rim light, right
  ctx.fillRect(18, -66, 4, 58);
  for (const y of [-58, -14]) { rect(ctx, o, -33, y, 66, 9, '#6b7080', 3); }
  ctx.fillStyle = '#8f96a8'; ctx.fillRect(-28, -56, 16, 2); ctx.fillRect(-28, -12, 16, 2);
  ctx.beginPath(); ctx.ellipse(0, -72, 26, 6, 0, 0, TAU); ctx.fillStyle = '#5c4129'; ctx.fill(); ctx.stroke();
}

function candles(ctx: Ctx, o: DrawOpts, t: number): void {
  halo(ctx, o, 0, -44, 62, 0.8 + 0.2 * Math.sin(t * TAU * 3));
  const set: Array<[number, number, number]> = [[-18, 34, 0.1], [2, 52, 0.45], [22, 26, 0.8]];
  for (const [x, h, ph] of set) {
    rect(ctx, o, x - 8, -h, 16, h, BONE, 4);
    if (!o.silhouette) {
      ctx.fillStyle = '#c9bd9f'; ctx.fillRect(x - 5, -h + 4, 4, h - 8); // shade
      ctx.fillStyle = '#fff6df'; ctx.fillRect(x + 3, -h + 4, 2, h - 8); // rim
      ctx.fillStyle = '#e8dfc6'; // drip
      ctx.beginPath(); ctx.ellipse(x - 2, -h + 10, 3, 6, 0, 0, TAU); ctx.fill();
    }
    flame(ctx, o, x, -h - 2, 0.7, t + ph);
  }
  rect(ctx, o, -30, -6, 60, 8, '#6b7080', 3);
}

function bones(ctx: Ctx, o: DrawOpts): void {
  const bone = (x1: number, y1: number, x2: number, y2: number): void => {
    for (const [w, c] of [[16, OUT], [8, fillOf(o, BONE)]] as const) {
      ctx.lineWidth = w; ctx.strokeStyle = c;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.lineWidth = 4; ctx.strokeStyle = OUT;
    for (const [x, y] of [[x1, y1], [x2, y2]]) {
      for (const d of [-4.5, 4.5]) {
        const dx = (y2 - y1) === 0 ? 0 : d; const dy = (y2 - y1) === 0 ? d : 0;
        ctx.beginPath(); ctx.arc(x + dx, y + dy, 5.5, 0, TAU);
        ctx.fillStyle = fillOf(o, BONE); ctx.fill(); ctx.stroke();
      }
    }
  };
  bone(-34, -10, 30, -22);
  bone(-28, -24, 34, -6);
  // skull
  ctx.beginPath(); ctx.ellipse(0, -34, 20, 18, 0, 0, TAU);
  ctx.fillStyle = fillOf(o, BONE); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.roundRect(-10, -22, 20, 12, 4); ctx.fill(); ctx.stroke();
  if (o.silhouette) return;
  ctx.fillStyle = OUT;
  for (const x of [-8, 8]) { ctx.beginPath(); ctx.ellipse(x, -35, 6, 7, 0, 0, TAU); ctx.fill(); }
  ctx.fillStyle = '#c9bd9f'; ctx.fillRect(-18, -34, 5, 8);
  ctx.fillStyle = '#fff6df'; ctx.fillRect(12, -44, 3, 6);
  ctx.fillStyle = OUT; ctx.fillRect(-1.5, -18, 3, 8);
}

function sealedScroll(ctx: Ctx, o: DrawOpts, t: number): void {
  const bob = Math.sin(t * TAU) * 1.5;
  ctx.save(); ctx.translate(0, bob);
  rect(ctx, o, -32, -62, 64, 56, '#e8d9b0', 6);
  if (!o.silhouette) {
    ctx.fillStyle = '#c4b184'; ctx.fillRect(-28, -22, 56, 12); // shade
    ctx.strokeStyle = '#8a7a52'; ctx.lineWidth = 3;
    for (const y of [-48, -38, -28]) { ctx.beginPath(); ctx.moveTo(-20, y); ctx.lineTo(20 - (y === -28 ? 14 : 0), y); ctx.stroke(); }
    ctx.strokeStyle = OUT; ctx.lineWidth = 4;
  }
  for (const y of [-66, -2]) rect(ctx, o, -38, y, 76, 10, '#7a5736', 5);
  // wax seal with ribbon tails
  ctx.beginPath(); ctx.moveTo(-6, -14); ctx.lineTo(-14, 6); ctx.lineTo(-4, 2); ctx.lineTo(0, 8); ctx.closePath();
  ctx.fillStyle = fillOf(o, '#a32a3a'); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, -16, 12, 0, TAU); ctx.fillStyle = fillOf(o, '#c23848'); ctx.fill(); ctx.stroke();
  if (!o.silhouette) {
    ctx.fillStyle = '#8a1f2e'; ctx.beginPath(); ctx.arc(-2, -14, 7, 0, TAU); ctx.fill();
    ctx.fillStyle = '#e8909a'; ctx.fillRect(4, -22, 3, 4);
    ctx.fillStyle = '#c23848'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('H', -2, -11);
  }
  ctx.restore();
}

function torchProp(ctx: Ctx, o: DrawOpts, t: number): void {
  halo(ctx, o, 0, -72, 80, 0.9 + 0.1 * Math.sin(t * TAU * 5));
  ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(-9, -56); ctx.lineTo(9, -56); ctx.lineTo(6, 0); ctx.closePath();
  ctx.fillStyle = fillOf(o, WOOD); ctx.fill(); ctx.stroke();
  rect(ctx, o, -16, -62, 32, 12, '#6b7080', 4); // iron cup
  flame(ctx, o, 0, -62, 1.5, t);
  if (!o.silhouette) { ctx.fillStyle = '#7a5736'; ctx.fillRect(5, -50, 3, 46); }
}

function keyholeDoor(ctx: Ctx, o: DrawOpts, t: number): void {
  const w = 62; const g = 0.5 + 0.5 * Math.sin(t * TAU);
  ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(-w / 2, -64); ctx.arc(0, -64, w / 2, Math.PI, 0); ctx.lineTo(w / 2, 0); ctx.closePath();
  ctx.fillStyle = fillOf(o, WOOD); ctx.fill(); ctx.stroke();
  if (o.silhouette) return;
  ctx.fillStyle = '#2f2016'; ctx.fillRect(-w / 2 + 3, -64, 10, 62);
  ctx.strokeStyle = '#2b1d12'; ctx.lineWidth = 3;
  for (const x of [-10, 10]) { ctx.beginPath(); ctx.moveTo(x, -2); ctx.lineTo(x, -92); ctx.stroke(); }
  for (const y of [-30, -62]) { ctx.strokeStyle = '#6b7080'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-w / 2 + 4, y); ctx.lineTo(w / 2 - 4, y); ctx.stroke(); }
  ctx.strokeStyle = OUT; ctx.lineWidth = 4;
  halo(ctx, o, 0, -44, 36, 0.6 + 0.4 * g);
  ctx.fillStyle = `rgba(255,170,80,${0.7 + 0.3 * g})`;
  ctx.beginPath(); ctx.arc(0, -46, 6.5, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-3.5, -44); ctx.lineTo(3.5, -44); ctx.lineTo(5, -28); ctx.lineTo(-5, -28); ctx.closePath(); ctx.fill();
}

// ---------------------------------------------------------------- crypt layers

/** Stone pillar with capital, base and a rim highlight. Fills the box [x, y, w, h]. */
export function pillar(ctx: Ctx, x: number, y: number, w: number, h: number, silhouette = false): void {
  const o: DrawOpts = { silhouette, size: h };
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineWidth = 4; ctx.strokeStyle = OUT;
  const sw = w * 0.72; const sx = x + (w - sw) / 2;
  rect(ctx, o, sx, y + 12, sw, h - 24, STONE, 3);
  if (!silhouette) {
    ctx.fillStyle = STONE_DARK; ctx.fillRect(sx + 3, y + 16, sw * 0.28, h - 32);
    ctx.fillStyle = 'rgba(190,175,230,0.22)'; ctx.fillRect(sx + sw * 0.78, y + 16, 3, h - 32);
    ctx.strokeStyle = 'rgba(8,6,16,0.6)'; ctx.lineWidth = 2;
    for (let yy = y + 40; yy < y + h - 24; yy += 46) { ctx.beginPath(); ctx.moveTo(sx + 2, yy); ctx.lineTo(sx + sw - 2, yy); ctx.stroke(); }
    ctx.strokeStyle = OUT; ctx.lineWidth = 4;
  }
  rect(ctx, o, x, y, w, 14, '#352d58', 3);
  rect(ctx, o, x, y + h - 14, w, 14, '#352d58', 3);
  ctx.restore();
}

/** A row of gothic arches across [x, y, w, h], dark inside with a rim on the curve. */
export function archWall(ctx: Ctx, x: number, y: number, w: number, h: number, count: number, silhouette = false): void {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = silhouette ? OUT : '#17132b';
  ctx.fillRect(x, y, w, h);
  const cw = w / count;
  ctx.lineJoin = 'round'; ctx.lineWidth = 4; ctx.strokeStyle = OUT;
  for (let i = 0; i < count; i++) {
    const cx = x + cw * (i + 0.5);
    const aw = cw * 0.62;
    const top = y + h * 0.18;
    ctx.beginPath();
    ctx.moveTo(cx - aw / 2, y + h);
    ctx.lineTo(cx - aw / 2, top + aw * 0.5);
    ctx.quadraticCurveTo(cx - aw / 2, top, cx, top - aw * 0.22);
    ctx.quadraticCurveTo(cx + aw / 2, top, cx + aw / 2, top + aw * 0.5);
    ctx.lineTo(cx + aw / 2, y + h);
    ctx.closePath();
    ctx.fillStyle = silhouette ? OUT : '#0a0812';
    ctx.fill(); ctx.stroke();
    if (!silhouette) {
      ctx.strokeStyle = 'rgba(190,175,230,0.18)'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - aw / 2 - 4, top + aw * 0.5);
      ctx.quadraticCurveTo(cx - aw / 2 - 4, top - 4, cx, top - aw * 0.22 - 4);
      ctx.quadraticCurveTo(cx + aw / 2 + 4, top - 4, cx + aw / 2 + 4, top + aw * 0.5);
      ctx.stroke();
      ctx.strokeStyle = OUT; ctx.lineWidth = 4;
    }
  }
  ctx.restore();
}

/** Near floor tiles: a strip of square slabs with highlight and grout. */
export function floorTiles(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  const n = Math.max(1, Math.round(w / h));
  const tw = w / n;
  ctx.save();
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = i % 2 ? '#241f40' : '#2a2446';
    ctx.fillRect(x + i * tw + 1, y + 1, tw - 2, h - 2);
    ctx.fillStyle = 'rgba(190,175,230,0.12)'; ctx.fillRect(x + i * tw + 1, y + 1, tw - 2, 3);
    ctx.fillStyle = 'rgba(6,4,12,0.35)'; ctx.fillRect(x + i * tw + 1, y + h - 5, tw - 2, 4);
  }
  ctx.strokeStyle = OUT; ctx.lineWidth = 3;
  ctx.strokeRect(x, y, w, h);
  ctx.beginPath(); for (let i = 1; i < n; i++) { ctx.moveTo(x + i * tw, y); ctx.lineTo(x + i * tw, y + h); } ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------- dispatch

export function drawProp(ctx: Ctx, id: PropId, p: number, o: DrawOpts): void {
  unit(ctx, o, () => {
    switch (id) {
      case 'barrel': barrel(ctx, o); break;
      case 'candles': candles(ctx, o, p); break;
      case 'bones': bones(ctx, o); break;
      case 'sealed-scroll': sealedScroll(ctx, o, p); break;
      case 'torch': torchProp(ctx, o, p); break;
      case 'keyhole-door': keyholeDoor(ctx, o, p); break;
      case 'pillar': pillar(ctx, -22, -100, 44, 100, o.silhouette); break;
      case 'arch': archWall(ctx, -50, -100, 100, 100, 1, o.silhouette); break;
    }
  });
}

const NAMES: Record<PropId, string> = {
  barrel: 'Barrel', candles: 'Candles', bones: 'Bone pile', 'sealed-scroll': 'Sealed scroll', torch: 'Wall torch',
  'keyhole-door': 'Provider door', pillar: 'Stone pillar', arch: 'Far wall arch',
};
const LIVE: ReadonlySet<PropId> = new Set<PropId>(['candles', 'sealed-scroll', 'torch', 'keyhole-door']);

for (const id of PROP_IDS) {
  registerSprite({
    id: `prop-${id}`,
    name: NAMES[id],
    group: 'prop',
    anims: [LIVE.has(id)
      ? { id: 'idle', label: 'Flicker', loop: true, duration: 1600 }
      : { id: 'still', label: 'Still', loop: false, duration: 400 }],
    draw(ctx, _anim, p, opts) { drawProp(ctx, id, p, opts); },
  });
}
