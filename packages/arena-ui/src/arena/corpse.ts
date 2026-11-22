// TV3-U8: corpse art (tournament-v3 spec section 3.3). A tombstone on a mound, a faint ghost wisp, a broken wall for the
// "100 percent failed at one stage" variant. Code-drawn in the arena's style: 4 px #14101f outline, rounded joins, flat fill.
// Pure canvas helpers: the caller passes `now` (ms) and the reduced-motion flag. No state, no DOM.

type Ctx = CanvasRenderingContext2D;
const OUT = '#14101f';
const TAU = Math.PI * 2;

function rrect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Footprint of the marker in design px: used for the epitaph hover region. */
export interface CorpseBox { x: number; y: number; w: number; h: number }

/** Tombstone height for a lane of height `laneH`. */
export const tombHeight = (laneH: number): number => Math.max(46, Math.min(78, laneH * 0.52));

/** Dirt mound the stone stands in. */
function mound(ctx: Ctx, x: number, floorY: number, w: number): void {
  ctx.beginPath(); ctx.ellipse(x, floorY, w / 2, 8, 0, 0, TAU);
  ctx.fillStyle = '#3b2a22'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = OUT; ctx.stroke();
  ctx.fillStyle = '#4c6a3c';
  for (const dx of [-0.32, -0.1, 0.18, 0.36]) {
    ctx.beginPath(); ctx.moveTo(x + dx * w - 3, floorY - 2); ctx.lineTo(x + dx * w, floorY - 9); ctx.lineTo(x + dx * w + 3, floorY - 2); ctx.closePath(); ctx.fill();
  }
}

/** A rounded-top gravestone with a cross, a crack and moss. The bottom sits on `floorY`. Returns the hover box. */
export function drawTombstone(ctx: Ctx, x: number, floorY: number, h: number, round = 0): CorpseBox {
  const w = h * 0.7;
  mound(ctx, x, floorY + 1, w * 1.5);
  const top = floorY - h;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x - w / 2, floorY - 2); ctx.lineTo(x - w / 2, top + w / 2);
  ctx.arc(x, top + w / 2, w / 2, Math.PI, 0);
  ctx.lineTo(x + w / 2, floorY - 2); ctx.closePath();
  ctx.fillStyle = '#7a7794'; ctx.fill();
  // shade crescent (bottom right) and rim crescent (top left), like the rig
  ctx.save(); ctx.clip();
  ctx.fillStyle = '#5b5873'; ctx.fillRect(x + w * 0.18, top, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.16)'; ctx.fillRect(x - w / 2, top, w * 0.14, h);
  ctx.restore();
  ctx.lineWidth = 4; ctx.strokeStyle = OUT; ctx.stroke();
  // cross
  ctx.fillStyle = '#d9d4e8';
  const cx = x, cy = top + h * 0.34, cw = Math.max(4, h * 0.07), cl = h * 0.2;
  ctx.fillRect(cx - cw / 2, cy - cl, cw, cl * 2.1); ctx.fillRect(cx - cl * 0.7, cy - cw / 2 - cl * 0.25, cl * 1.4, cw);
  // crack and moss
  ctx.strokeStyle = OUT; ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.moveTo(x + w * 0.1, floorY - h * 0.3); ctx.lineTo(x - w * 0.04, floorY - h * 0.42); ctx.lineTo(x + w * 0.08, floorY - h * 0.52); ctx.stroke();
  ctx.fillStyle = '#4f7a46';
  ctx.beginPath(); ctx.ellipse(x - w * 0.3, floorY - 6, w * 0.2, 5, 0, 0, TAU); ctx.fill();
  if (round > 0) { ctx.fillStyle = '#d9d4e8'; ctx.font = `800 13px ui-monospace, "Cascadia Code", Menlo, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(`R${round}`, x, floorY - h * 0.12); }
  ctx.restore();
  return { x: x - w * 0.8, y: top - 24, w: w * 1.6, h: h + 30 };
}

/** A faint ghost wisp rising from the stone: a curling smoke tail with a glow. Still when motion is reduced. */
export function drawWisp(ctx: Ctx, x: number, baseY: number, h: number, now: number, reduced: boolean, seed = 0): void {
  const t = reduced ? 0 : now / 900 + seed;
  const rise = reduced ? 0.5 : (t * 0.25) % 1;
  const sway = Math.sin(t * 2) * 6;
  ctx.save();
  ctx.globalAlpha = 0.38 * (reduced ? 1 : 0.6 + 0.4 * Math.sin(Math.PI * rise));
  const wy = baseY - h * 0.2 - rise * h * 0.7;
  const g = ctx.createRadialGradient(x + sway, wy, 1, x + sway, wy, 20);
  g.addColorStop(0, 'rgba(170,220,255,0.9)'); g.addColorStop(1, 'rgba(170,220,255,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x + sway, wy, 20, 0, TAU); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x + sway - 7, wy + 4);
  ctx.quadraticCurveTo(x + sway - 9, wy - 12, x + sway, wy - 14);
  ctx.quadraticCurveTo(x + sway + 9, wy - 12, x + sway + 7, wy + 4);
  ctx.quadraticCurveTo(x + sway + 6, wy + 14, x + sway + 14 - sway * 0.4, wy + 22);
  ctx.quadraticCurveTo(x + sway - 4, wy + 14, x + sway - 7, wy + 4);
  ctx.closePath();
  ctx.fillStyle = 'rgba(214,236,255,0.85)'; ctx.fill();
  ctx.fillStyle = 'rgba(20,16,31,0.7)';
  ctx.beginPath(); ctx.arc(x + sway - 2.6, wy - 4, 1.6, 0, TAU); ctx.arc(x + sway + 2.6, wy - 4, 1.6, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.ellipse(x + sway, wy + 1, 1.8, 2.4, 0, 0, TAU); ctx.fill();
  ctx.restore();
}

/** The wall variant: a crumbling brick stub with a red X, for a stage where every order failed. Returns the hover box. */
export function drawWallCorpse(ctx: Ctx, x: number, floorY: number, h: number): CorpseBox {
  const w = h * 1.05;
  const top = floorY - h;
  ctx.save();
  ctx.lineJoin = 'round';
  // a stepped, broken top edge
  ctx.beginPath();
  ctx.moveTo(x - w / 2, floorY); ctx.lineTo(x - w / 2, top + h * 0.28); ctx.lineTo(x - w * 0.22, top + h * 0.28); ctx.lineTo(x - w * 0.22, top);
  ctx.lineTo(x + w * 0.1, top); ctx.lineTo(x + w * 0.1, top + h * 0.4); ctx.lineTo(x + w / 2, top + h * 0.4); ctx.lineTo(x + w / 2, floorY); ctx.closePath();
  ctx.fillStyle = '#6c4d44'; ctx.fill();
  ctx.save(); ctx.clip();
  ctx.strokeStyle = 'rgba(20,16,31,0.7)'; ctx.lineWidth = 2;
  const rows = 4;
  for (let r = 1; r < rows; r++) { const y = top + (h * r) / rows; ctx.beginPath(); ctx.moveTo(x - w / 2, y); ctx.lineTo(x + w / 2, y); ctx.stroke(); }
  for (let r = 0; r < rows; r++) for (let c = 0; c < 4; c++) { const bx = x - w / 2 + ((c + (r % 2) * 0.5) * w) / 3.4; ctx.beginPath(); ctx.moveTo(bx, top + (h * r) / rows); ctx.lineTo(bx, top + (h * (r + 1)) / rows); ctx.stroke(); }
  ctx.fillStyle = '#4d342d'; ctx.fillRect(x + w * 0.12, top, w, h);
  ctx.restore();
  ctx.lineWidth = 4; ctx.strokeStyle = OUT; ctx.stroke();
  // fallen bricks
  for (const [dx, dy, r] of [[-0.6, 0, -0.3], [0.62, 2, 0.4]] as const) {
    ctx.save(); ctx.translate(x + dx * w, floorY - 5 + dy); ctx.rotate(r);
    rrect(ctx, -7, -4, 14, 8, 2); ctx.fillStyle = '#8a625a'; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = OUT; ctx.stroke(); ctx.restore();
  }
  // red X
  ctx.strokeStyle = '#ff4d5e'; ctx.lineWidth = 6; ctx.lineCap = 'round';
  const m = h * 0.2;
  ctx.beginPath(); ctx.moveTo(x - m, top + h * 0.45 - m); ctx.lineTo(x + m, top + h * 0.45 + m); ctx.moveTo(x + m, top + h * 0.45 - m); ctx.lineTo(x - m, top + h * 0.45 + m); ctx.stroke();
  ctx.fillStyle = '#efe6d2'; ctx.font = `800 13px ui-monospace, "Cascadia Code", Menlo, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('WALL', x, floorY - 8);
  ctx.restore();
  return { x: x - w * 0.75, y: top - 6, w: w * 1.5, h: h + 10 };
}
