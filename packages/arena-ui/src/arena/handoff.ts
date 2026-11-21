// Handoff ceremony, cancel sequence, door stars and run-back dust (PT-U2, playtest-v2 ui.md sections 1 and 7).
// Pure timing helpers plus canvas drawing. Durations are the real ms carried by events (ceremonyMs, cancelMs).
import type { Ceremony } from './lap';

type Ctx = CanvasRenderingContext2D;

/** Seconds the door stars take to float (ui.md section 7). */
export const STARS_MS = 1600;
/** The CANCELLED stamp stays this long after the sequence ends. */
export const STAMP_LINGER_MS = 700;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export type CeremonyStep = 'open' | 'hand' | 'take' | 'close' | 'burn' | 'done';

/** Progress 0..1 through the ceremony at `now`, or -1 when it is not playing. */
export function ceremonyProgress(c: Ceremony | null | undefined, now: number): number {
  if (!c || c.dur <= 0) return -1;
  const p = (now - c.since) / c.dur;
  return p >= 0 && p < 1 ? p : -1;
}

/** How far the delivery door stands open (0 shut, 1 wide): opens, holds through the handover, closes. */
export function doorOpenAmount(p: number): number {
  if (p < 0) return 0;
  if (p < 0.2) return p / 0.2;
  if (p < 0.78) return 1;
  return clamp01(1 - (p - 0.78) / 0.22);
}

/** The handover: where the scroll is between the skeleton's hand (0) and the door hand (1), and whether the hand has left with it. */
export function handoverAt(p: number): { reach: number; taken: boolean } {
  if (p < 0.2) return { reach: 0, taken: false };
  if (p < 0.5) return { reach: (p - 0.2) / 0.3, taken: false };
  if (p < 0.78) return { reach: 1 - (p - 0.5) / 0.28, taken: true };
  return { reach: 0, taken: true };
}

/** Burn progress 0..1 of a cancelled scroll (the first 70 percent of the sequence, then it is ash). */
export function burnAt(p: number): number { return clamp01(p / 0.7); }

/** Ceremony frame at `now` as a small state for tests and the renderer. */
export function ceremonyStep(c: Ceremony | null | undefined, now: number): CeremonyStep {
  const p = ceremonyProgress(c, now);
  if (p < 0 || !c) return 'done';
  if (c.kind === 'cancel') return 'burn';
  if (p < 0.2) return 'open';
  if (p < 0.5) return 'hand';
  if (p < 0.78) return 'take';
  return 'close';
}

export function starColor(stars: number): string { return stars >= 4.5 ? '#ffd86b' : stars >= 3 ? '#ff9a3c' : '#ff4d5e'; }

/** "★★★★½" for 4.5: full stars plus a half. */
export function starIcons(stars: number): string {
  const s = Math.max(0, Math.min(5, Math.round(stars * 2) / 2));
  return '★'.repeat(Math.floor(s)) + (s % 1 ? '½' : '');
}

/** Star burst state at `now`: null when none is playing. 5 stars burst out, 1 star droops. */
export function starsFloat(c: Ceremony | null | undefined, now: number, reduced: boolean): { dy: number; alpha: number; scale: number; stars: number } | null {
  if (!c || c.stars === null) return null;
  const t = (now - c.starsAt) / STARS_MS;
  if (t < 0 || t >= 1) return null;
  const alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
  if (reduced) return { dy: -34, alpha, scale: 1, stars: c.stars };
  const e = 1 - (1 - t) * (1 - t);
  if (c.stars >= 4.5) return { dy: -90 * e, alpha, scale: 1 + 0.5 * Math.sin(Math.min(1, t * 3) * Math.PI), stars: c.stars };
  if (c.stars < 2) return { dy: -22 * Math.sin(Math.min(1, t * 1.6) * Math.PI) + 26 * t * t, alpha, scale: 0.85, stars: c.stars };
  return { dy: -70 * e, alpha, scale: 1, stars: c.stars };
}

export interface HandoffGeo {
  doorX: number; floorY: number; doorH: number;
  /** Skeleton hand (where the scroll is held) and scale of the scroll. */
  handX: number; handY: number; scrollScale: number;
  size: number; skelX: number; feetY: number;
  drawScroll: (x: number, y: number, s: number, rot: number) => void;
  font: string; reduced: boolean; lite: boolean;
}

/** Door opening drawn over the static door. Nothing is drawn while the door is shut. */
function drawOpenDoor(ctx: Ctx, g: HandoffGeo, open: number): void {
  if (open <= 0.01) return;
  const h = g.doorH, w = h * 0.62;
  ctx.save();
  ctx.translate(g.doorX, g.floorY);
  const arch = (inset: number): void => {
    ctx.beginPath();
    ctx.moveTo(-w / 2 + inset, -2); ctx.lineTo(-w / 2 + inset, -h * 0.65); ctx.arc(0, -h * 0.65, w / 2 - inset, Math.PI, 0); ctx.lineTo(w / 2 - inset, -2); ctx.closePath();
  };
  arch(6);
  const gl = ctx.createLinearGradient(0, -h, 0, 0);
  gl.addColorStop(0, '#2a1a33'); gl.addColorStop(1, `rgba(255,170,80,${0.35 + 0.4 * open})`);
  ctx.fillStyle = gl; ctx.fill();
  // the leaf swings away from the left hinge, narrowing as it opens
  ctx.save();
  arch(6); ctx.clip();
  const leaf = (w - 12) * (1 - open * 0.88);
  ctx.fillStyle = '#4a3322'; ctx.fillRect(-w / 2 + 6, -h * 1.1, leaf, h * 1.2);
  ctx.strokeStyle = '#2b1d12'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-w / 2 + 6 + leaf, -h * 1.1); ctx.lineTo(-w / 2 + 6 + leaf, 0); ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = '#05030a'; ctx.lineWidth = 4; arch(0); ctx.stroke();
  ctx.restore();
}

/** The pale hand that takes the scroll: sleeve from inside the door, palm out front. `reach` 0 hidden, 1 fully out. */
function drawDoorHand(ctx: Ctx, g: HandoffGeo, reach: number, tx: number, ty: number): void {
  const bx = g.doorX - g.doorH * 0.1, by = g.floorY - g.doorH * 0.42;
  const x = bx + (tx - bx) * reach, y = by + (ty - by) * reach;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#05030a'; ctx.lineWidth = 11;
  ctx.beginPath(); ctx.moveTo(bx + 10, by); ctx.lineTo(x, y); ctx.stroke();
  ctx.strokeStyle = '#3b2f52'; ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(bx + 10, by); ctx.lineTo(x, y); ctx.stroke();
  ctx.fillStyle = '#e8e2d2'; ctx.strokeStyle = '#05030a'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.restore();
}

function flames(ctx: Ctx, x: number, y: number, s: number, burn: number, now: number): void {
  const n = 5, k = Math.sin(Math.min(1, burn) * Math.PI) * 0.8 + 0.2;
  for (let i = 0; i < n; i++) {
    const fx = x + (i - 2) * 7 * s, f = 0.6 + 0.4 * Math.sin(now / 70 + i * 2.1);
    const fh = (22 + 12 * f) * k * s;
    ctx.fillStyle = i % 2 ? '#ff9a3c' : '#ff4d2e';
    ctx.beginPath(); ctx.moveTo(fx - 6 * s, y); ctx.quadraticCurveTo(fx - 2 * s, y - fh * 0.6, fx, y - fh); ctx.quadraticCurveTo(fx + 3 * s, y - fh * 0.5, fx + 6 * s, y); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = '#ffd86b';
  ctx.beginPath(); ctx.ellipse(x, y - 3 * s, 5 * s, 8 * k * s, 0, 0, Math.PI * 2); ctx.fill();
}

function text(ctx: Ctx, s: string, x: number, y: number, px: number, color: string, font: string): void {
  ctx.font = `800 ${px}px ${font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 4; ctx.strokeStyle = '#05030a'; ctx.strokeText(s, x, y);
  ctx.fillStyle = color; ctx.fillText(s, x, y);
}

/**
 * Draw the ceremony or cancel sequence and the door stars. Call after the skeleton so the scroll and hand sit on top.
 * Returns true while the scroll is being drawn here (the caller must not draw the held scroll too).
 */
export function drawHandoff(ctx: Ctx, c: Ceremony | null | undefined, g: HandoffGeo, now: number): boolean {
  if (!c) return false;
  const p = ceremonyProgress(c, now);
  const reduced = g.reduced;
  let scrollHere = false;
  if (p >= 0 && c.kind === 'done') {
    if (reduced) {
      // two-frame swap with a caption: door open for the middle of the ceremony
      drawOpenDoor(ctx, g, p > 0.2 && p < 0.8 ? 1 : 0);
      if (p > 0.2 && p < 0.8) text(ctx, 'Handed over', g.skelX, g.feetY - g.size * 1.1, 15, '#8be28b', g.font);
    } else {
      const open = doorOpenAmount(p), h = handoverAt(p);
      drawOpenDoor(ctx, g, open);
      const tx = g.doorX - g.doorH * 0.2, ty = g.floorY - g.doorH * 0.42;
      if (p >= 0.2 && p < 0.78) {
        const hx = g.handX + (tx - g.handX) * (h.taken ? 1 : h.reach), hy = g.handY + (ty - g.handY) * (h.taken ? 1 : h.reach);
        drawDoorHand(ctx, g, h.taken ? h.reach : Math.min(1, h.reach * 1.2), h.taken ? tx : hx, h.taken ? ty : hy);
        const sx = h.taken ? tx + (g.doorX - tx) * (1 - h.reach) * 0.6 : hx, sy = h.taken ? ty : hy;
        g.drawScroll(sx, sy, g.scrollScale, 0);
        scrollHere = true;
      } else if (p < 0.2) { g.drawScroll(g.handX, g.handY, g.scrollScale, 0); scrollHere = true; }
      if (p > 0.92 && !g.lite) {
        // thud: a puff of dust at the threshold
        const t = (p - 0.92) / 0.08;
        ctx.save(); ctx.globalAlpha = 0.5 * (1 - t); ctx.fillStyle = '#bdb2d4';
        for (const dx of [-26, 26]) { ctx.beginPath(); ctx.arc(g.doorX + dx * (0.6 + t), g.floorY - 4, 6 + 10 * t, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
      }
    }
  }
  if (c.kind === 'cancel') {
    const end = c.since + c.dur;
    if (p >= 0) {
      // the door stays shut; the scroll burns down to ash under a red stamp
      const burn = burnAt(p);
      if (burn < 1) {
        ctx.save();
        ctx.globalAlpha = 1 - burn * 0.85;
        g.drawScroll(g.handX, g.handY, g.scrollScale * (1 - burn * 0.3), burn * 0.6);
        ctx.restore();
        if (!reduced) flames(ctx, g.handX, g.handY + 6, g.scrollScale * 5, burn, now);
        scrollHere = true;
      }
      if (!reduced && !g.lite) {
        ctx.fillStyle = 'rgba(70,64,80,0.8)';
        for (let i = 0; i < 6; i++) {
          const t = (p * 2 + i / 6) % 1;
          ctx.fillRect(g.handX + Math.sin(i * 7 + now / 300) * 14, g.handY - 10 - 50 * t, 3, 3);
        }
      }
    }
    if (now >= c.since + c.dur * 0.2 && now < end + STAMP_LINGER_MS) {
      const a = now < end ? 1 : 1 - (now - end) / STAMP_LINGER_MS;
      const pop = reduced || now > c.since + c.dur * 0.2 + 160 ? 1 : 1.5 - 0.5 * ((now - c.since - c.dur * 0.2) / 160);
      ctx.save(); ctx.globalAlpha = Math.max(0, a); ctx.translate(g.skelX + 8, g.feetY - g.size * 1.15); ctx.rotate(-0.14); ctx.scale(pop, pop);
      ctx.font = `900 22px ${g.font}`; const w = ctx.measureText('CANCELLED').width + 20;
      ctx.lineWidth = 4; ctx.strokeStyle = '#ff4d5e'; ctx.strokeRect(-w / 2, -17, w, 34);
      ctx.fillStyle = 'rgba(40,6,12,0.7)'; ctx.fillRect(-w / 2, -17, w, 34);
      text(ctx, 'CANCELLED', 0, 1, 22, '#ff4d5e', g.font);
      ctx.restore();
    }
  }
  const sf = starsFloat(c, now, reduced);
  if (sf) {
    ctx.save(); ctx.globalAlpha = Math.max(0, sf.alpha); ctx.translate(g.doorX - 24, g.floorY - g.doorH * 0.9 + sf.dy); ctx.scale(sf.scale, sf.scale);
    const col = starColor(sf.stars);
    text(ctx, `${starIcons(sf.stars)} ${sf.stars}`, 0, 0, 24, col, g.font);
    if (sf.stars >= 4.5 && !reduced && !g.lite) {
      ctx.fillStyle = col;
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, r = 30 + 40 * (1 - sf.alpha) + 14; ctx.fillRect(Math.cos(a) * r - 2, Math.sin(a) * r * 0.6 - 2, 4, 4); }
    }
    ctx.restore();
  }
  return scrollHere;
}

/** True while a ceremony or cancel sequence is drawing the scroll itself. */
export const ceremonyActive = (c: Ceremony | null | undefined, now: number): boolean => ceremonyProgress(c, now) >= 0;

/** Dust puffs and bouncing bones behind a running skeleton. */
export function drawRunDust(ctx: Ctx, x: number, feetY: number, dir: number, now: number, lite: boolean): void {
  const n = lite ? 2 : 4;
  ctx.save();
  for (let i = 0; i < n; i++) {
    const t = ((now / 260) + i / n) % 1;
    ctx.globalAlpha = 0.55 * (1 - t); ctx.fillStyle = '#bdb2d4';
    ctx.beginPath(); ctx.arc(x - dir * (16 + 46 * t), feetY - 4 - 8 * t, 4 + 8 * t, 0, Math.PI * 2); ctx.fill();
  }
  if (!lite) {
    ctx.globalAlpha = 0.9; ctx.strokeStyle = '#f4efe2'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (let i = 0; i < 2; i++) {
      const t = ((now / 380) + i * 0.5) % 1, bx = x - dir * (30 + 40 * t), by = feetY - 10 - 26 * Math.sin(t * Math.PI);
      ctx.beginPath(); ctx.moveTo(bx - 4, by); ctx.lineTo(bx + 4, by - 2); ctx.stroke();
    }
  }
  ctx.restore();
}
