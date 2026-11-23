/// <reference lib="dom" />
// Canvas arena (UI-A3): crypt background, lane floors, label cards, stage chips, skeletons,
// work animations, progress bars and counters. Everything is drawn in code on a fixed
// 1920x1080 design stage. The reducer in model.ts owns all state; this file only reads it.
import { frameFor } from '../rig/skeleton';
import { drawSkeleton } from '../rig/draw';
import { TIER_IDS, TIER_LABEL, type Tier } from '../rig/dress';
import { chipWidth, stationX, type ArenaVM, type ChipState, type LaneVM } from './model';
import type { OutageVM } from './outage';
import { CHIP_ICON, fromLegacy, heatAlpha, heatAt, type ChipInfo, type ChipV2State } from './chips';
import { outageAt, outageFrame, ringLabel } from './outage';
import { drawTombstone, drawWallCorpse, drawWisp, tombHeight } from './corpse';
import { epitaphOf } from './tournament';
import { CLASS_ICON, CLASS_WORD, POP_MS, curseShort, curseWord, type CurseClass, type CurseVM } from './curses';
import { captionOf, creatureFrame, creatureTip, shown, spriteOf, MAX_SHOWN, type CreatureVM } from './creatures';
import { drawCreature } from '../creatures/draw';
import { bugTint, puff, seedOf, swarmBugs, swarmStale } from './swarm';
import { drawWorldCreature, drawWorldProp, isWorld, tintOf, worldPhase, worldProp } from './world-events';
import { archWall, drawProp, pillar } from '../props/draw';
import { survivedAge } from './boss';
import { equipPhase, flightPoint, PART_LABEL, wornParts } from './equip';
import { displayId, vocabOf } from './vocab';
import { dropPoint, dropProgress, queueLeft, queueShape } from './order';
import { grabPoint, grabProgress, lapMotion, START_X, STACK_STEP, STACK_X } from './lap';
import { drawHandoff, drawRunDust } from './handoff';
import { cobweb, flagstoneFloor, fogTexture, laneVignette, torchPools } from './crypt';
import { starTracker } from './laps-model';
import { laneRatingTitle } from './review-card';

export const STAGE_W = 1920;
export const STAGE_H = 1080;
const HEADER = 72;
const LANES_H = 768;
const TRACK_X0 = 260;
const CREATURE_X1 = 1500;

const C = {
  bg: '#0d0b14', stone: '#1c1830', stone2: '#2a2446', torch: '#ff9a3c', bone: '#efe6d2', text: '#f3ecff',
  muted: '#8f86a8', ok: '#5ee08a', fail: '#ff4d5e', warn: '#ffc247', ghost: '#7ab8ff', hex: '#9b6bff', out: '#14101f',
};
const MONO = 'ui-monospace, "Cascadia Code", Menlo, monospace';
const SANS = 'ui-sans-serif, system-ui, sans-serif';

type Ctx = CanvasRenderingContext2D;

export interface LaneBox { top: number; h: number }

/** Height of the boss banner. While a boss is announced or active the lanes sit below it (inset). */
export const BOSS_INSET = 48;

/** Lane geometry: 768/N tall capped at 200, drawn 4 px short of the pitch, group centred. */
export function laneBoxes(n: number, inset = 0): LaneBox[] {
  const avail = LANES_H - inset;
  const pitch = Math.min(200, avail / Math.max(1, n));
  const group = pitch * n;
  const y0 = HEADER + inset + (avail - group) / 2;
  return Array.from({ length: n }, (_, i) => ({ top: y0 + i * pitch, h: pitch - 5.6 }));
}

// ---------------------------------------------------------------- static layer

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function bricks(ctx: Ctx, x: number, y: number, w: number, h: number, seed: number, base: string, line: string): void {
  const r = rng(seed);
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);
  const bh = 24; const bw = 56;
  for (let row = 0, yy = y; yy < y + h; row++, yy += bh) {
    const off = (row % 2) * (bw / 2);
    for (let xx = x - off; xx < x + w; xx += bw) {
      const shade = Math.floor(r() * 14);
      ctx.fillStyle = `rgba(${40 + shade},${34 + shade},${64 + shade},0.35)`;
      ctx.fillRect(Math.max(x, xx) + 1, yy + 1, Math.min(bw, x + w - xx) - 2, bh - 2);
    }
  }
  ctx.strokeStyle = line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let row = 0, yy = y; yy <= y + h; row++, yy += bh) { ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); }
  for (let row = 0, yy = y; yy < y + h; row++, yy += bh) {
    const off = (row % 2) * (bw / 2);
    for (let xx = x - off + bw; xx < x + w; xx += bw) { if (xx > x) { ctx.moveTo(xx, yy); ctx.lineTo(xx, yy + bh); } }
  }
  ctx.stroke();
}

function door(ctx: Ctx, x: number, baseY: number, h: number, glow: number): void {
  const w = h * 0.62;
  ctx.save();
  ctx.translate(x, baseY);
  ctx.fillStyle = '#0a0812';
  ctx.strokeStyle = C.out;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-w / 2, 0); ctx.lineTo(-w / 2, -h * 0.65); ctx.arc(0, -h * 0.65, w / 2, Math.PI, 0); ctx.lineTo(w / 2, 0); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#4a3322';
  ctx.beginPath();
  ctx.moveTo(-w / 2 + 6, -2); ctx.lineTo(-w / 2 + 6, -h * 0.65); ctx.arc(0, -h * 0.65, w / 2 - 6, Math.PI, 0); ctx.lineTo(w / 2 - 6, -2); ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#2b1d12'; ctx.lineWidth = 2;
  for (const dx of [-w / 6, w / 6]) { ctx.beginPath(); ctx.moveTo(dx, -2); ctx.lineTo(dx, -h * 0.9); ctx.stroke(); }
  ctx.fillStyle = `rgba(255,154,60,${0.55 + 0.45 * glow})`;
  ctx.shadowColor = C.torch; ctx.shadowBlur = 8 + 10 * glow;
  ctx.beginPath(); ctx.arc(0, -h * 0.42, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(-2, -h * 0.42, 4, 12);
  ctx.restore();
}

/** UI-ART4: far wall arches, mid pillars and floor-edge props, kept dim behind the actors. */
function cryptLayers(ctx: Ctx, top: number, h: number): void {
  const wallH = h * 0.58;
  ctx.save();
  ctx.beginPath(); ctx.rect(TRACK_X0, top, 1600 - TRACK_X0, h); ctx.clip();
  ctx.globalAlpha = 0.5;
  archWall(ctx, TRACK_X0, top + 4, 1600 - TRACK_X0, wallH - 4, 6);
  ctx.globalAlpha = 0.75;
  for (const px of [TRACK_X0 + 6, 700, 1130]) pillar(ctx, px, top + 2, 30, wallH + 6);
  ctx.globalAlpha = 1;
  if (h >= 120) {
    const fy = top + h - 6;
    const bs = Math.min(34, h * 0.2); const rs = Math.min(54, h * 0.32); const cs = Math.min(40, h * 0.24);
    ctx.translate(TRACK_X0 + 70, fy - bs / 2); drawProp(ctx, 'bones', 0, { silhouette: false, size: bs });
    ctx.translate(1080 - TRACK_X0 - 70, (bs - rs) / 2); drawProp(ctx, 'barrel', 0, { silhouette: false, size: rs });
    ctx.translate(300, (rs - cs) / 2); drawProp(ctx, 'candles', 0.3, { silhouette: false, size: cs });
  }
  ctx.restore();
}

/** Everything that never moves, drawn once per lane count. */
export function renderStatic(n: number, inset = 0): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = STAGE_W; cv.height = STAGE_H;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  bricks(ctx, 0, 0, STAGE_W, HEADER, 11, '#15112a', 'rgba(8,6,16,0.9)');
  bricks(ctx, 0, HEADER + LANES_H, STAGE_W, STAGE_H - HEADER - LANES_H, 23, '#130f24', 'rgba(8,6,16,0.9)');
  if (inset > 0) bricks(ctx, 0, HEADER, STAGE_W, inset, 12, '#15112a', 'rgba(8,6,16,0.9)');
  const boxes = laneBoxes(n, inset);
  boxes.forEach((b, i) => {
    bricks(ctx, 0, b.top, TRACK_X0, b.h, 100 + i, '#17132b', 'rgba(8,6,16,0.9)');
    flagstoneFloor(ctx, TRACK_X0, b.top, STAGE_W - TRACK_X0, b.h, 200 + i);
    cryptLayers(ctx, b.top, b.h);
    torchPools(ctx, [TRACK_X0 + 90, 720, 1140, 1548], b.top, b.h);
    laneVignette(ctx, TRACK_X0, b.top, STAGE_W - TRACK_X0, b.h);
    // lane frame
    ctx.strokeStyle = 'rgba(8,6,16,0.95)'; ctx.lineWidth = 4;
    ctx.strokeRect(2, b.top, STAGE_W - 4, b.h);
    // dotted track line along the feet
    ctx.strokeStyle = 'rgba(143,134,168,0.4)'; ctx.lineWidth = 2; ctx.setLineDash([3, 9]);
    const ty = b.top + b.h * 0.8;
    ctx.beginPath(); ctx.moveTo(TRACK_X0 + 20, ty); ctx.lineTo(1500, ty); ctx.stroke();
    ctx.setLineDash([]);
    cobweb(ctx, TRACK_X0 + 4, b.top + 2, 1, 1, 46);
    cobweb(ctx, STAGE_W - 6, b.top + 2, -1, 1, 46);
    cobweb(ctx, 1150 + (i % 3) * 90, b.top + 2, i % 2 ? 1 : -1, 1, 26);
    cobweb(ctx, TRACK_X0 + 4, b.top + b.h - 2, 1, -1, 24);
    door(ctx, 1548, b.top + b.h - 8, Math.min(100, b.h * 0.7), 0.4);
  });
  // lane stats panel edge
  ctx.fillStyle = 'rgba(8,6,16,0.35)';
  boxes.forEach((b) => ctx.fillRect(1600, b.top + 4, STAGE_W - 1604, b.h - 8));
  return cv;
}

// ---------------------------------------------------------------- dynamic pieces

const rr = (ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void => {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
};

function txt(ctx: Ctx, s: string, x: number, y: number, px: number, color: string, align: CanvasTextAlign = 'left', font = SANS, weight = '600'): void {
  ctx.font = `${weight} ${px}px ${font}`;
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
}

function fit(ctx: Ctx, s: string, w: number): string {
  if (ctx.measureText(s).width <= w) return s;
  let t = s;
  while (t.length > 1 && ctx.measureText(t + '…').width > w) t = t.slice(0, -1);
  return t + '…';
}

const AMBER = '#ffb020';
const CHIP2: Record<ChipV2State, { color: string; fill: string }> = {
  pending: { color: C.muted, fill: 'rgba(28,24,48,0.9)' },
  next: { color: C.torch, fill: 'rgba(28,24,48,0.9)' },
  active: { color: C.torch, fill: 'rgba(86,52,20,0.95)' },
  trouble: { color: C.warn, fill: 'rgba(96,78,12,0.97)' },
  passed: { color: C.ok, fill: 'rgba(24,52,40,0.95)' },
  healed: { color: C.ok, fill: 'rgba(24,52,40,0.95)' },
  failed: { color: C.fail, fill: 'rgba(70,24,34,0.95)' },
  replayed: { color: 'rgba(94,224,138,0.6)', fill: 'rgba(24,44,38,0.9)' },
  parked: { color: C.ghost, fill: 'rgba(24,40,66,0.95)' },
  quarantined: { color: C.hex, fill: 'rgba(44,28,72,0.95)' },
  dead: { color: C.muted, fill: 'rgba(20,18,30,0.95)' },
};


/** Wrap a stage label onto at most two lines of `w` px; the second line ends with an ellipsis if it still overflows. */
export function wrapLabel(ctx: Ctx, label: string, w: number, px: number): string[] {
  ctx.font = `600 ${px}px ${SANS}`;
  if (ctx.measureText(label).width <= w) return [label];
  const words = label.split(/\s+/);
  let first = '';
  let i = 0;
  while (i < words.length - 1 && ctx.measureText(first ? `${first} ${words[i]}` : words[i]!).width <= w) { first = first ? `${first} ${words[i]}` : words[i]!; i++; }
  if (!first) return [fit(ctx, label, w)];
  return [first, fit(ctx, words.slice(i).join(' '), w)];
}

/** Dashed orange outline and a small arrow on the chip the skeleton is walking to (ui.md section 1). */
function nextMark(ctx: Ctx, x: number, y: number, w = 150): void {
  const h = 40;
  ctx.save(); ctx.setLineDash([7, 5]); ctx.lineWidth = 3; ctx.strokeStyle = C.torch;
  rr(ctx, x - w / 2 - 4, y - 4, w + 8, h + 8, 12); ctx.stroke(); ctx.restore();
  txt(ctx, '\u25B6', x - w / 2 - 6, y + h / 2 + 1, 13, C.torch, 'center', SANS, '800');
}

/** Chip v2 (PT-U3): state is icon plus colour plus label; an amber flag shows the issue count at this stage. */
function chipV2(ctx: Ctx, x: number, y: number, label: string, info: ChipInfo, w: number, t: number): void {
  const h = 40;
  const tight = w < 130;
  const s = CHIP2[info.state];
  const hot = info.state === 'active' || info.state === 'trouble';
  const pulse = hot && t !== 0 ? 0.55 + 0.45 * Math.sin(t / (info.state === 'trouble' ? 140 : 220)) : 1;
  ctx.save();
  rr(ctx, x - w / 2, y, w, h, 9);
  ctx.fillStyle = s.fill; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = s.color; ctx.globalAlpha = pulse;
  if (info.state === 'next') ctx.setLineDash([7, 5]);
  ctx.stroke(); ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  const icon = info.state === 'trouble' && info.attempts > 1 ? `${CHIP_ICON.trouble}${info.attempts}` : CHIP_ICON[info.state];
  txt(ctx, icon, x - w / 2 + (tight ? 13 : 16), y + h / 2 + 1, tight ? 14 : 18, s.color, 'center', SANS, '700');
  const px = tight ? 13 : 15;
  const lines = wrapLabel(ctx, label, tight ? w - 28 : w - (info.issues > 0 ? 68 : 42), px);
  const col = info.state === 'pending' || info.state === 'dead' ? C.muted : C.text;
  lines.forEach((ln, i) => txt(ctx, ln, x - w / 2 + (tight ? 24 : 31), y + h / 2 + 1 + (i - (lines.length - 1) / 2) * (tight ? 14 : 16), px, col));
  if (info.issues > 0) {
    // On narrow chips the flag sits on the top-right corner so it never covers the label.
    const fx = x + w / 2 - (tight ? 3 : 14), fy = tight ? y + 3 : y + 14;
    ctx.beginPath(); ctx.arc(fx, fy, 13, 0, Math.PI * 2); ctx.fillStyle = AMBER; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = C.out; ctx.stroke();
    txt(ctx, `\u2691${info.issues > 9 ? '9+' : info.issues}`, fx, fy + 1, 14, C.out, 'center', SANS, '800');
  }
  ctx.restore();
}

/** Countdown ring under a chip while a stage is down (TV3-U7): arc = time left, label = whole seconds. */
function outageRing(ctx: Ctx, x: number, y: number, o: OutageVM, now: number, reduced: boolean): void {
  const f = outageFrame(o, now);
  const r = 16;
  ctx.save();
  ctx.globalAlpha = 1 - f.fade;
  ctx.beginPath(); ctx.arc(x, y, r + 2, 0, Math.PI * 2); ctx.fillStyle = 'rgba(14,10,22,0.92)'; ctx.fill();
  ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,77,94,0.28)';
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  const pulse = f.overrun && !reduced ? 0.55 + 0.45 * Math.sin(now / 160) : 1;
  ctx.globalAlpha = (1 - f.fade) * pulse;
  ctx.strokeStyle = f.overrun || o.endedAt !== null ? C.warn : C.fail; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (o.endedAt !== null ? 1 : Math.max(0.02, f.frac))); ctx.stroke();
  ctx.globalAlpha = 1 - f.fade;
  txt(ctx, o.endedAt !== null ? '\u2713' : ringLabel(f), x, y + 1, 13, o.endedAt !== null ? C.ok : C.text, 'center', MONO, '800');
  ctx.restore();
}

/** Tint on a stage chip while a transit stall lasts (weather, road hazard, delay, out of gas, not on truck): a coloured wash and border, and the fault word. */
function chipTint(ctx: Ctx, x: number, y: number, cw: number, color: string, now: number, reduced: boolean): void {
  const pulse = reduced ? 1 : 0.7 + 0.3 * Math.sin(now / 260);
  ctx.save();
  ctx.globalAlpha = 0.2; ctx.fillStyle = color; rr(ctx, x - cw / 2, y, cw, 40, 10); ctx.fill();
  ctx.globalAlpha = pulse; ctx.lineWidth = 3; ctx.strokeStyle = color; rr(ctx, x - cw / 2 - 2, y - 2, cw + 4, 44, 11); ctx.stroke();
  ctx.restore();
}

/** The fault word beside the countdown ring, on a dark pill so it reads over a creature. */
function chipWord(ctx: Ctx, x: number, y: number, color: string, word: string): void {
  ctx.save();
  ctx.font = `800 11px ${MONO}`;
  const w = Math.ceil(ctx.measureText(word).width) + 10;
  rr(ctx, x + 22, y + 53, w, 17, 6); ctx.fillStyle = 'rgba(10,8,18,0.86)'; ctx.fill();
  txt(ctx, word, x + 27, y + 62, 11, color, 'left', MONO, '800');
  ctx.restore();
}

/** Purple curse chip under a stage chip, left side (TV3-U11): the short kind, for as long as the curse lasts. */
function curseChip(ctx: Ctx, x: number, y: number, c: CurseVM, more: number): void {
  const label = more > 0 ? `${curseShort(c.kind)}+${more}` : curseShort(c.kind);
  ctx.save();
  ctx.font = `800 13px ${MONO}`;
  const w = Math.ceil(ctx.measureText(label).width) + 22;
  rr(ctx, x, y, w, 19, 6); ctx.fillStyle = 'rgba(70,40,120,0.97)'; ctx.fill();
  ctx.lineWidth = 2.5; ctx.strokeStyle = C.hex; ctx.stroke();
  txt(ctx, '\u263E', x + 9, y + 10, 13, '#d9c4ff', 'center', SANS, '800');
  txt(ctx, label, x + 17 + (w - 22) / 2, y + 10, 13, '#ffffff', 'center', MONO, '800');
  ctx.restore();
}

/** Answer to a cursed call floats up from its stage chip: HANDLED, REPORTED, SWALLOWED or CRASHED. */
function curseAnswer(ctx: Ctx, x: number, y: number, cls: CurseClass, age: number, reduced: boolean): void {
  if (age < 0 || age >= 1) return;
  const color = cls === 'handled' ? C.ok : cls === 'reported' ? C.ghost : C.fail;
  const label = `${CLASS_ICON[cls]} ${CLASS_WORD[cls]}`;
  ctx.save();
  ctx.globalAlpha = Math.min(1, (1 - age) * 2.4);
  ctx.font = `800 13px ${MONO}`;
  const w = Math.ceil(ctx.measureText(label).width) + 18;
  const cy = y - (reduced ? 0 : 22 * age);
  rr(ctx, x - w / 2, cy - 11, w, 22, 7); ctx.fillStyle = 'rgba(10,8,18,0.92)'; ctx.fill();
  ctx.lineWidth = cls === 'swallowed' ? 3 : 2; ctx.strokeStyle = color; ctx.stroke();
  txt(ctx, label, x, cy + 1, 13, color, 'center', MONO, '800');
  ctx.restore();
}

/** Curse tag on the lane card (bottom right): "CURSED 404", or the first kind plus a count. */
function curseTag(ctx: Ctx, b: LaneBox, list: readonly CurseVM[]): void {
  const first = list[0]!;
  const label = `${curseShort(first.kind)}${list.length > 1 ? ` +${list.length - 1}` : ''}`;
  ctx.save();
  ctx.font = `800 13px ${MONO}`;
  const w = Math.ceil(ctx.measureText(label).width) + 38;
  rr(ctx, 244 - w, b.top + b.h - 36, w, 21, 7); ctx.fillStyle = 'rgba(70,40,120,0.97)'; ctx.fill();
  ctx.lineWidth = 2.5; ctx.strokeStyle = C.hex; ctx.stroke();
  txt(ctx, '\u263E', 244 - w + 11, b.top + b.h - 25, 14, '#d9c4ff', 'center', SANS, '800');
  txt(ctx, label, 244 - 8, b.top + b.h - 25, 13, '#ffffff', 'right', MONO, '800');
  ctx.restore();
}

/** One heat strip segment under a chip: opacity follows the wave's issue count at the stage. */
function heatSegment(ctx: Ctx, x: number, y: number, alpha: number, w = 150): void {
  ctx.save();
  rr(ctx, x - w / 2, y, w, 4, 2); ctx.fillStyle = 'rgba(90,80,120,0.25)'; ctx.fill();
  if (alpha > 0) { ctx.globalAlpha = alpha; ctx.fillStyle = AMBER; ctx.fill(); }
  ctx.restore();
}

function torch(ctx: Ctx, x: number, y: number, t: number, lit: boolean, seed: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#3a2a1a'; ctx.strokeStyle = C.out; ctx.lineWidth = 3;
  ctx.fillRect(-4, 0, 8, 22); ctx.strokeRect(-4, 0, 8, 22);
  if (lit) {
    const f = 0.8 + 0.2 * Math.sin(t / 90 + seed) + 0.1 * Math.sin(t / 37 + seed * 3);
    ctx.fillStyle = C.torch; ctx.shadowColor = C.torch; ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.moveTo(-9, 2); ctx.quadraticCurveTo(-10, -14 * f, 0, -26 * f); ctx.quadraticCurveTo(10, -14 * f, 9, 2); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = '#ffe08a';
    ctx.beginPath(); ctx.moveTo(-4, 2); ctx.quadraticCurveTo(-5, -6 * f, 0, -13 * f); ctx.quadraticCurveTo(5, -6 * f, 4, 2); ctx.closePath(); ctx.fill();
  } else {
    ctx.fillStyle = '#555'; ctx.fillRect(-3, -4, 6, 6);
  }
  ctx.restore();
}

const GEAR_SLOTS: { id: string; label: string }[] = [
  { id: 'retry', label: 'R' }, { id: 'journal', label: 'J' }, { id: 'idempotency', label: 'I' },
  { id: 'breaker', label: 'B' }, { id: 'offline_queue', label: 'Q' },
];

function labelCard(ctx: Ctx, b: LaneBox, l: LaneVM, t: number, worn: string[], speed: number, reduced: boolean): void {
  const h = b.h;
  ctx.save();
  rr(ctx, 8, b.top + 4, 244, h - 8, 12);
  ctx.fillStyle = C.stone2; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = C.out; ctx.stroke();
  torch(ctx, 24, b.top + h / 2 - 14, reduced ? 0 : t, l.mode !== 'dead' && l.mode !== 'halted', l.lane);
  const name = l.label || (TIER_IDS.includes(l.tier as Tier) ? TIER_LABEL[l.tier as Tier] : l.tier);
  txt(ctx, name, 46, b.top + 24, 22, C.bone, 'left', SANS, '700');
  txt(ctx, `LANE ${l.lane}`, 46, b.top + 46, 14, C.muted, 'left', MONO, '600');
  // five gear slots
  GEAR_SLOTS.forEach((g, i) => {
    const gx = 56 + i * 34; const gy = b.top + h * 0.5 + 6;
    const on = worn.includes(g.id);
    const eq = l.equips.find((e) => e.part === g.id);
    const ph = eq ? equipPhase(eq, t, speed, reduced) : null;
    if (ph && ph.spark >= 0) {
      ctx.save(); ctx.globalAlpha = 1 - ph.spark; ctx.strokeStyle = C.warn; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(gx, gy, 14 + 16 * ph.spark, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    ctx.beginPath(); ctx.arc(gx, gy, 12, 0, Math.PI * 2);
    ctx.fillStyle = on ? C.warn : 'rgba(10,8,18,0.55)'; ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = on ? C.out : C.muted; ctx.setLineDash(on ? [] : [3, 3]); ctx.stroke(); ctx.setLineDash([]);
    txt(ctx, g.label, gx, gy + 1, 14, on ? C.out : C.muted, 'center', MONO, '700');
  });
  txt(ctx, String(l.score), 46, b.top + h - 24, 24, l.score < 0 ? C.fail : C.text, 'left', MONO, '700');
  if (l.stars) {
    const last = l.stars.last > 0 ? ` (${Number.isInteger(l.stars.last) ? l.stars.last : l.stars.last.toFixed(1)})` : '';
    txt(ctx, `\u2605 ${starTracker({ stars: l.stars.sum, max: l.stars.max })}${last}`, 46, b.top + h - 46, 14, l.stars.sum / Math.max(1, l.stars.max) >= 0.9 ? C.warn : C.muted, 'left', MONO, '700');
    const rt = laneRatingTitle(l.stars);
    if (rt && !l.fallen) txt(ctx, rt.title, 246, b.top + 46, 13, rt.tone === 'gold' ? C.warn : rt.tone === 'red' ? C.fail : C.muted, 'right', MONO, '700');
  }
  if (l.scorePop) {
    const age = (t - l.scorePop.since) * speed / 1100;
    if (age >= 0 && age < 1) {
      const up = l.scorePop.delta > 0;
      ctx.save(); ctx.globalAlpha = 1 - age;
      txt(ctx, (up ? '+' : '') + l.scorePop.delta, 130, b.top + h - 24 - (reduced ? 0 : 16 * age), 18, up ? C.ok : C.fail, 'left', MONO, '800');
      ctx.restore();
    }
  }
  if (l.depth > 0) {
    const bx = 224; const by = b.top + 24;
    rr(ctx, bx - 22, by - 14, 44, 28, 8); ctx.fillStyle = 'rgba(155,107,255,0.25)'; ctx.fill();
    ctx.strokeStyle = C.hex; ctx.lineWidth = 2.5; ctx.stroke();
    txt(ctx, `☠${l.depth}`, bx, by + 1, 18, C.text, 'center', SANS, '700');
  }
  ctx.restore();
}

/** Lessons on a lane card (TV3-U9): a small scroll with a count. `age` is ms since the last lesson (sparkles while it is young). */
function lessonScroll(ctx: Ctx, right: number, y: number, count: number, age: number, reduced: boolean): { x: number; w: number } {
  ctx.save();
  ctx.font = `800 14px ${MONO}`;
  const label = `\u00D7${count}`;
  const tw = Math.ceil(ctx.measureText(label).width);
  const sx = right - tw - 26;
  // the scroll: parchment body, two rolled ends, three ink lines
  rr(ctx, sx + 3, y - 7, 18, 14, 3); ctx.fillStyle = '#efe6d2'; ctx.fill(); ctx.lineWidth = 2.4; ctx.strokeStyle = C.out; ctx.stroke();
  for (const ex of [sx + 3, sx + 21]) { ctx.beginPath(); ctx.ellipse(ex, y, 3, 8, 0, 0, Math.PI * 2); ctx.fillStyle = '#c9b88e'; ctx.fill(); ctx.stroke(); }
  ctx.strokeStyle = '#6b4f2a'; ctx.lineWidth = 1.6;
  for (const dy of [-3, 0, 3]) { ctx.beginPath(); ctx.moveTo(sx + 7, y + dy); ctx.lineTo(sx + 17, y + dy); ctx.stroke(); }
  txt(ctx, label, right, y + 1, 14, C.bone, 'right', MONO, '800');
  if (age >= 0 && age < 1800) {
    const p = age / 1800;
    ctx.globalAlpha = 1 - p;
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + (reduced ? 0 : p * 1.6);
      const r = 14 + (reduced ? 6 : 16 * p);
      sparkle(ctx, sx + 12 + Math.cos(a) * r, y + Math.sin(a) * r * 0.8, 5 + 2 * (1 - p));
    }
  }
  ctx.restore();
  return { x: sx - 2, w: right - sx + 6 };
}

/** A four-point sparkle. */
function sparkle(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.quadraticCurveTo(x, y, x, y + r); ctx.quadraticCurveTo(x, y, x - r, y); ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.fillStyle = '#fff3a8'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = C.out; ctx.stroke();
}

/** "FALLEN R2" pill on a fallen lane's label card (TV3-U8). Drawn at full strength over the greyed row. */
function fallenTag(ctx: Ctx, b: LaneBox, round: number): void {
  const label = round > 0 ? `FALLEN R${round}` : 'FALLEN';
  ctx.save();
  ctx.font = `800 13px ${MONO}`;
  const w = Math.ceil(ctx.measureText(label).width) + 18;
  rr(ctx, 244 - w, b.top + 33, w, 21, 6); ctx.fillStyle = 'rgba(70,24,34,0.96)'; ctx.fill();
  ctx.lineWidth = 2.5; ctx.strokeStyle = C.fail; ctx.stroke();
  txt(ctx, label, 244 - w / 2, b.top + 44, 13, '#ff9aa6', 'center', MONO, '800');
  ctx.restore();
}

function stats(ctx: Ctx, b: LaneBox, l: LaneVM, app: string): void {
  const x = 1616; const y = b.top + 8;
  txt(ctx, `${vocabOf(app).unit.toUpperCase()} ${l.orderIndex}/${l.ordersTotal || '-'}`, x, y + 12, 16, C.text, 'left', MONO, '700');
  const rows: [string, number, string][] = [
    ['✓', l.counts.completed, C.ok], ['✕', l.counts.failed, C.fail], ['⚗', l.counts.quarantined, C.hex],
  ];
  rows.forEach(([icon, v, color], i) => {
    const cx = x + i * 66;
    txt(ctx, icon, cx, y + 42, 18, color, 'left', SANS, '700');
    txt(ctx, String(v), cx + 24, y + 42, 18, C.text, 'left', MONO, '700');
  });
  txt(ctx, `↻ repeats ${l.counts.repeats}`, x, y + 70, 16, l.counts.repeats > 0 ? C.fail : C.muted, 'left', MONO, '700');
  txt(ctx, `⚰ parked ${l.counts.parked}`, x, y + 92, 16, l.counts.parked > 0 ? C.ghost : C.muted, 'left', MONO, '600');
}

/** The start stack (ui.md section 2): queued scrolls at the left end of the track, max 4 plus +n. */
const stackY = (b: LaneBox): number => b.top + b.h * 0.8 - 28;
function startStack(ctx: Ctx, b: LaneBox, l: LaneVM): void {
  const q = queueShape(queueLeft(l.orderIndex, l.ordersTotal));
  const y = stackY(b);
  for (let i = q.shown - 1; i >= 0; i--) scroll(ctx, STACK_X + i * STACK_STEP, y - (i % 2) * 4, 0.5, l.lane + '' + i, false);
  if (q.more > 0) txt(ctx, `+${q.more}`, STACK_X + q.shown * STACK_STEP + 10, y + 8, 14, C.muted, 'left', MONO, '700');
}
function scroll(ctx: Ctx, x: number, y: number, s: number, seed: string, crumpled: boolean): void {
  ctx.save();
  ctx.translate(x, y); ctx.scale(s, s);
  ctx.fillStyle = '#e9dcb8'; ctx.strokeStyle = C.out; ctx.lineWidth = 4;
  rr(ctx, 0, 0, 40, 52, 6); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#c9b88a';
  ctx.fillRect(0, 0, 40, 7); ctx.fillRect(0, 45, 40, 7);
  let h = 0; for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  ctx.strokeStyle = '#6b4f2a'; ctx.lineWidth = 3;
  for (let i = 0; i < 3; i++) { const w = 12 + ((h >> (i * 3)) & 15); ctx.beginPath(); ctx.moveTo(6, 16 + i * 9); ctx.lineTo(6 + w, 16 + i * 9); ctx.stroke(); }
  ctx.fillStyle = C.fail; ctx.beginPath(); ctx.arc(32, 44, 5, 0, Math.PI * 2); ctx.fill();
  if (crumpled) { ctx.strokeStyle = C.fail; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(6, 10); ctx.lineTo(34, 42); ctx.moveTo(34, 10); ctx.lineTo(6, 42); ctx.stroke(); }
  ctx.restore();
}

/** Work props per `workAnimation` id (ui-spec section 6). p cycles 0..1. */
function workProp(ctx: Ctx, anim: string, p: number, x: number, y: number, size: number, doorX: number): void {
  const k = size / 68;
  const s = Math.sin(p * Math.PI * 2);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.lineWidth = 3; ctx.strokeStyle = C.out; ctx.lineJoin = 'round';
  const paper = (px: number, py: number, w: number, h: number) => { ctx.fillStyle = '#efe6d2'; rr(ctx, px, py, w, h, 3); ctx.fill(); ctx.stroke(); };
  switch (anim) {
    case 'read_mail': paper(10, -34, 26, 18); ctx.beginPath(); ctx.moveTo(10, -34); ctx.lineTo(23, -24 - 3 * Math.abs(s)); ctx.lineTo(36, -34); ctx.stroke();
      ctx.fillStyle = C.fail; ctx.beginPath(); ctx.arc(30, -20 + 4 * Math.max(0, s), 4, 0, Math.PI * 2); ctx.fill(); break;
    case 'fill_form': paper(10, -36, 24, 30); ctx.strokeStyle = '#6b4f2a'; ctx.beginPath(); ctx.moveTo(14, -28); ctx.lineTo(14 + 10 + 6 * s, -28); ctx.moveTo(14, -20); ctx.lineTo(28, -20); ctx.stroke();
      ctx.fillStyle = C.ghost; ctx.strokeStyle = C.out; rr(ctx, 14, -64 - 4 * Math.abs(s), 26, 18, 3); ctx.fill(); ctx.stroke(); break;
    case 'swipe_card': { ctx.fillStyle = C.warn; rr(ctx, 6 + 12 * p, -34, 28, 18, 3); ctx.fill(); ctx.stroke();
      const cx = (doorX - x) / k * p; ctx.fillStyle = '#ffd86b'; ctx.beginPath(); ctx.arc(cx, -8 - 16 * Math.sin(p * Math.PI), 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); break; }
    case 'write_letter': paper(10, -34, 24, 28); ctx.strokeStyle = C.torch; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(30 + 4 * s, -44); ctx.lineTo(22 + 4 * s, -24); ctx.stroke(); break;
    case 'load_scooter': case 'doorstep': case 'archive_box': case 'scooter_road':
      ctx.fillStyle = '#b98a50'; rr(ctx, 8, -30 - 5 * Math.abs(s), 26, 22, 3); ctx.fill(); ctx.stroke(); ctx.strokeStyle = '#7a5630'; ctx.beginPath(); ctx.moveTo(21, -30 - 5 * Math.abs(s)); ctx.lineTo(21, -8 - 5 * Math.abs(s)); ctx.stroke(); break;
    case 'send_bubbles': for (let i = 0; i < 3; i++) { const q = (p + i / 3) % 1; ctx.globalAlpha = 1 - q; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(14 + i * 10, -34 - q * 36, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); } ctx.globalAlpha = 1; break;
    case 'think': ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(26, -70, 15, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.strokeStyle = C.out;
      ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = p * 2 + (i * Math.PI) / 3; ctx.moveTo(26, -70); ctx.lineTo(26 + Math.cos(a) * 11, -70 + Math.sin(a) * 11); } ctx.stroke(); break;
    case 'file_ticket': ctx.fillStyle = C.warn; rr(ctx, 8, -34 + 6 * Math.max(0, s), 30, 18, 3); ctx.fill(); ctx.stroke(); break;
    case 'send_letter': { const cx = ((doorX - x) / k) * p; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(cx, -26); ctx.lineTo(cx + 18, -34); ctx.lineTo(cx + 8, -20); ctx.closePath(); ctx.fill(); ctx.stroke(); break; }
    default: for (let i = 0; i < 3; i++) { ctx.fillStyle = Math.floor(p * 3) === i ? C.torch : C.muted; ctx.beginPath(); ctx.arc(14 + i * 10, -46, 3.5, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.restore();
}

function confetti(ctx: Ctx, x: number, y: number, p: number, seed: number, count: number): void {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2; const v = 30 + r() * 50;
    const px = x + Math.cos(a) * v * p; const py = y - 20 - Math.abs(Math.sin(a)) * v * p + 70 * p * p;
    ctx.save(); ctx.translate(px, py); ctx.rotate(a + p * 6); ctx.globalAlpha = Math.max(0, 1 - p);
    ctx.fillStyle = C.bone; ctx.strokeStyle = C.out; ctx.lineWidth = 1.5;
    ctx.fillRect(-5, -2, 10, 4); ctx.strokeRect(-5, -2, 10, 4);
    ctx.restore();
  }
}

// ---------------------------------------------------------------- scene

interface Walker { x: number; lastT: number }

export class ArenaScene {
  /** Lessons ledger per lane (TV3-U9): count, tooltip, when the last one was learned and how. The page feeds it from the Casebook model. */
  lessonInfo: (lane: number) => { count: number; tip: string; learnedAt: number; mechanism: string } = () => ({ count: 0, tip: '', learnedAt: -1, mechanism: '' });
  /** Hover regions rebuilt every frame (design px): the caption of a gremlin or an UNKNOWN fault carries a tooltip. */
  hot: Array<{ x: number; y: number; w: number; h: number; tip: string }> = [];
  private statics = new Map<number, HTMLCanvasElement>();
  private walkers = new Map<number, Walker>();
  /** Divides animation durations (wave speed). */
  speed = 1;
  private lite = false;
  /** prefers-reduced-motion: creatures appear in place, no travel or shake. */
  reducedMotion = false;

  constructor(private readonly ctx: Ctx) {}

  private staticFor(n: number, inset: number): HTMLCanvasElement {
    const key = n + (inset > 0 ? 1000 : 0);
    let s = this.statics.get(key);
    if (!s) this.statics.set(key, (s = renderStatic(n, inset)));
    return s;
  }

  private target(vm: ArenaVM, l: LaneVM): number {
    const n = Math.max(1, vm.stages.length);
    if (l.mode === 'sleep') return START_X;
    const busy = l.mode === 'working' || l.mode === 'recovering' || l.mode === 'fail' || l.mode === 'dead' || l.mode === 'reassembling';
    if (busy || !l.order) return stationX(l.stageIndex, n);
    const next = l.chips[l.stageIndex] === 'done' || l.chips[l.stageIndex] === 'replayed' ? Math.min(n - 1, l.stageIndex + 1) : l.stageIndex;
    return stationX(next, n);
  }

  /** True while a creature that has started acting is still on the lane: the skeleton shoos it (TV3-U5). */
  static harassed(l: LaneVM, now: number): boolean {
    return l.creatures.some((c) => c.exitAt === null && !c.shrug && c.actAt !== null && now >= c.actAt && !c.killer);
  }

  /** Chosen pose for a lane at time `now` (ms). Pure of the canvas, exported for tests. */
  static poseOf(l: LaneVM, now: number, walking: boolean, speed = 1): { anim: string; p: number } {
    const el = Math.max(0, now - l.since) * speed;
    if (l.cheer && now - l.cheer.since < l.cheer.dur / speed && (l.mode === 'idle' || l.mode === 'working' || l.mode === 'done')) {
      return { anim: 'cheer', p: ((now - l.cheer.since) * speed % 800) / 800 };
    }
    if (!walking && (l.mode === 'working' || l.mode === 'recovering' || l.mode === 'fail' || l.mode === 'idle') && ArenaScene.harassed(l, now)) {
      return { anim: 'shoo', p: ((now - l.since) * speed % 520) / 520 };
    }
    switch (l.mode) {
      case 'sleep': return { anim: 'sleep', p: (now % 3200) / 3200 };
      case 'dead': return { anim: 'collapse', p: Math.min(1, el / 600) };
      case 'reassembling': return { anim: 'reassemble', p: Math.min(1, el / 700) };
      case 'fail': return walking ? { anim: 'walk', p: (now * speed * gaitRate(l) % 900) / 900 } : { anim: 'slump', p: (now % 1800) / 1800 };
      case 'recovering': return { anim: 'recover', p: (now % 1200) / 1200 };
      case 'halted': return { anim: 'halted', p: (now % 2400) / 2400 };
      case 'working': return walking ? { anim: 'walk', p: (now * speed % 900) / 900 } : { anim: 'work', p: (now * speed % 700) / 700 };
      default: return walking ? { anim: 'walk', p: (now * speed * gaitRate(l) % 900) / 900 } : { anim: 'idle', p: (now % 1800) / 1800 };
    }
  }

  /** Switch to lite mode (fewer particles, no blur) when frames run long. */
  setLite(v: boolean): void { this.lite = v; }

  draw(vm: ArenaVM, now: number): void {
    const ctx = this.ctx;
    this.hot = [];
    const quiet = vm.lanes.length === 0;
    const lanes: LaneVM[] = quiet ? [] : vm.lanes;
    const n = quiet ? 5 : lanes.length;
    ctx.setLineDash([]);
    const inset = vm.boss.phase === 'none' ? 0 : BOSS_INSET;
    ctx.drawImage(this.staticFor(n, inset), 0, 0);
    this.fog(ctx, now, n, inset);
    const boxes = laneBoxes(n, inset);
    const drawn = quiet ? sleepers(vm, now) : lanes;
    drawn.forEach((l, i) => this.drawLane(ctx, vm, l, boxes[i]!, now));
  }

  private fogTex: HTMLCanvasElement | null = null;
  private fogTex2: HTMLCanvasElement | null = null;

  private fog(ctx: Ctx, now: number, n: number, inset: number): void {
    if (this.lite) return;
    this.fogTex ??= fogTexture(STAGE_W, LANES_H, 7);
    this.fogTex2 ??= fogTexture(STAGE_W, LANES_H, 19);
    const drift = this.reducedMotion ? 0 : now;
    const o1 = (drift / 90) % STAGE_W; const o2 = STAGE_W - ((drift / 55) % STAGE_W);
    ctx.drawImage(this.fogTex, -o1, HEADER); ctx.drawImage(this.fogTex, STAGE_W - o1, HEADER);
    ctx.globalAlpha = 0.8;
    ctx.drawImage(this.fogTex2, -o2, HEADER); ctx.drawImage(this.fogTex2, STAGE_W - o2, HEADER);
    ctx.globalAlpha = 1;
    const boxes = laneBoxes(n, inset);
    ctx.save();
    for (let i = 0; i < 3; i++) {
      const x = ((now / 60 + i * 700) % 2400) - 300;
      const g = ctx.createRadialGradient(x, HEADER + 380, 10, x, HEADER + 380, 360);
      g.addColorStop(0, 'rgba(122,100,180,0.07)'); g.addColorStop(1, 'rgba(122,100,180,0)');
      ctx.fillStyle = g; ctx.fillRect(x - 360, HEADER, 720, LANES_H);
    }
    boxes.forEach((b) => {
      const f = this.reducedMotion ? 1 : 0.85 + 0.15 * Math.sin(now / 130 + b.top);
      const g = ctx.createRadialGradient(24, b.top + b.h / 2, 4, 24, b.top + b.h / 2, 190);
      g.addColorStop(0, `rgba(255,154,60,${0.22 * f})`); g.addColorStop(1, 'rgba(255,154,60,0)');
      ctx.fillStyle = g; ctx.fillRect(0, b.top, 420, b.h);
    });
    ctx.restore();
  }

  private drawLane(ctx: Ctx, vm: ArenaVM, l: LaneVM, b: LaneBox, now: number): void {
    const n = vm.stages.length;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, b.top, STAGE_W, b.h); ctx.clip();
    const fell = l.fallen ?? null;
    const deathIdx = fell ? Math.max(0, vm.stages.findIndex((s) => s.id === fell.stage)) : -1;
    if (fell) ctx.globalAlpha = 0.5;
    labelCard(ctx, b, l, now, wornParts(l.parts, l.equips, now, this.speed, this.reducedMotion), this.speed, this.reducedMotion);
    if (fell) { ctx.globalAlpha = 1; fallenTag(ctx, b, fell.round); ctx.globalAlpha = 0.4; }
    if ((l.curses?.length ?? 0) > 0) {
      ctx.globalAlpha = fell ? 0.7 : 1;
      curseTag(ctx, b, l.curses!);
      this.hot.push({ x: 244 - 120, y: b.top + b.h - 38, w: 120, h: 24, tip: l.curses!.map((c) => `${curseWord(c.kind)}${c.endpoint ? ` on ${c.endpoint}` : ''}${c.rate !== null ? ` (${Math.round(c.rate * 100)}%)` : ''}`).join('\n') });
      ctx.globalAlpha = fell ? 0.4 : 1;
    }
    const les = this.lessonInfo(l.lane);
    if (les.count > 0) {
      const age = les.learnedAt >= 0 ? (now - les.learnedAt) * this.speed : -1;
      if (fell) ctx.globalAlpha = 0.6;
      const box = lessonScroll(ctx, 244, b.top + b.h - 46, les.count, age, this.reducedMotion);
      ctx.globalAlpha = fell ? 0.4 : 1;
      this.hot.push({ x: box.x, y: b.top + b.h - 62, w: box.w, h: 32, tip: les.tip });
      // "learned" caption floating by the skeleton for a moment
      if (age >= 0 && age < 2200 && !fell) {
        const p = age / 2200;
        ctx.save(); ctx.globalAlpha = Math.min(1, (1 - p) * 2.4);
        const text = `LEARNED: ${les.mechanism || 'a new trick'}`;
        ctx.font = `800 15px ${MONO}`;
        const w = Math.min(420, Math.ceil(ctx.measureText(text).width) + 40);
        const cx = 700, cy = b.top + b.h * 0.56 - (this.reducedMotion ? 0 : 16 * p);
        rr(ctx, cx - w / 2, cy - 13, w, 26, 9); ctx.fillStyle = 'rgba(10,8,18,0.88)'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = C.warn; ctx.stroke();
        sparkle(ctx, cx - w / 2 + 14, cy, 6); sparkle(ctx, cx + w / 2 - 14, cy, 6);
        txt(ctx, fit(ctx, text, w - 40), cx, cy + 1, 15, C.text, 'center', MONO, '800');
        ctx.restore();
      }
    }
    stats(ctx, b, l, vm.app);
    if (l.mode !== 'sleep' && !fell) startStack(ctx, b, l);
    // stage chips and station props
    const chipY = b.top + 4;
    const cw = chipWidth(n);
    // Countdown rings and fault words are drawn last, over the skeleton and the creatures, so they stay readable.
    const rings: (() => void)[] = [];
    vm.stages.forEach((s, i) => {
      const x = stationX(i, n);
      ctx.fillStyle = 'rgba(10,8,18,0.5)'; ctx.beginPath(); ctx.ellipse(x, b.top + b.h * 0.8 + 2, 22, 6, 0, 0, Math.PI * 2); ctx.fill();
      let info = l.v2?.[i] ?? fromLegacy(l.chips[i] ?? 'pending', l.attempts[i] ?? 0);
      if (fell) { ctx.globalAlpha = i === deathIdx ? 1 : 0.4; if (i === deathIdx) info = { ...info, state: 'dead' }; }
      chipV2(ctx, x, chipY, s.label, info, cw, this.reducedMotion ? 0 : now);
      heatSegment(ctx, x, chipY + 44, heatAlpha(heatAt(l.heat, l.v2, l.heatFolded, i).issues), cw);
      if (l.lap?.next === i && info.state === 'pending') nextMark(ctx, x, chipY, cw);
      const cursed = (l.curses ?? []).filter((c) => c.stage === s.id);
      if (cursed.length > 0) {
        ctx.save(); ctx.globalAlpha = fell ? 0.5 : 1; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(155,107,255,0.9)'; ctx.setLineDash([6, 4]);
        rr(ctx, x - cw / 2 - 4, chipY - 4, cw + 8, 48, 12); ctx.stroke(); ctx.restore();
        curseChip(ctx, x - cw / 2, chipY + 44, cursed[0]!, cursed.length - 1);
      }
      for (const pop of l.cursepops ?? []) if (pop.stage === s.id) curseAnswer(ctx, x, chipY + 76, pop.cls, ((now - pop.at) * this.speed) / POP_MS, this.reducedMotion);
      const og = outageAt(l, s.id);
      if (og && (og.endedAt === null || now - og.endedAt < 700)) {
        const tint = tintOf(og.fault);
        if (tint && og.endedAt === null) chipTint(ctx, x, chipY, cw, tint, now, this.reducedMotion);
        rings.push(() => {
          if (tint && og.endedAt === null) chipWord(ctx, x, chipY, tint, captionOf(og.fault));
          outageRing(ctx, x, chipY + 41 + 20, og, now, this.reducedMotion);
        });
      }
    });
    ctx.globalAlpha = 1;
    // progress bar under the active chip
    const wi = vm.stages.length ? Math.min(l.stageIndex, n - 1) : 0;
    const bx = stationX(wi, n);
    const by = b.top + b.h - 26;
    if (l.mode !== 'sleep' && l.order && n > 0) {
      rr(ctx, bx - 70, by, 140, 12, 6); ctx.fillStyle = 'rgba(10,8,18,0.75)'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = C.out; ctx.stroke();
      const failed = l.chips[wi] === 'failed';
      const pct = (failed ? l.progress : l.progress) / 100;
      if (pct > 0) { rr(ctx, bx - 68, by + 2, Math.max(8, 136 * pct), 8, 4); ctx.fillStyle = failed ? C.fail : C.torch; ctx.fill(); }
      if (l.progressLabel && l.mode === 'working') { ctx.font = `600 13px ${MONO}`; txt(ctx, fit(ctx, l.progressLabel, 130), bx + 78, by + 7, 13, C.muted, 'left', MONO, '600'); }
    }
    this.drawCorpses(ctx, vm, l, b, now);
    if (fell) this.drawFallen(ctx, vm, l, b, now, deathIdx);
    else this.drawSkeleton(ctx, vm, l, b, now);
    this.drawCreatures(ctx, l, b, now);
    ctx.globalAlpha = fell ? 0.4 : 1;
    for (const draw of rings) draw();
    ctx.globalAlpha = 1;
    this.drawSurvived(ctx, l, b, now);
    ctx.restore();
  }

  /** Corpse markers on this lane: a wall stays under a living skeleton; an eliminated lane's tombstone is drawn by drawFallen. */
  private drawCorpses(ctx: Ctx, vm: ArenaVM, l: LaneVM, b: LaneBox, now: number): void {
    const n = vm.stages.length;
    const floorY = b.top + b.h * 0.8 + 4;
    for (const c of vm.tournament.corpses) {
      if (c.lane !== l.lane || c.kind !== 'wall') continue;
      const si = vm.stages.findIndex((s) => s.id === c.stage);
      if (si < 0) continue;
      const box = drawWallCorpse(ctx, stationX(si, n) + 6, floorY, Math.min(64, b.h * 0.42));
      if (!this.lite) drawWisp(ctx, stationX(si, n) + 6, floorY, 60, now, this.reducedMotion, l.lane);
      this.hot.push({ ...box, tip: epitaphOf(c, l.label || l.tier, vm.stages[si]!.label) });
    }
  }

  /** An eliminated lane: tombstone on the stage where it died, the skeleton lying beside it, a ghost wisp, and a dim swarm that keeps circling. */
  private drawFallen(ctx: Ctx, vm: ArenaVM, l: LaneVM, b: LaneBox, now: number, deathIdx: number): void {
    const n = vm.stages.length;
    const fell = l.fallen!;
    const size = Math.min(88, b.h * 0.5);
    const floorY = b.top + b.h * 0.8 + 4;
    const x = stationX(deathIdx, n) + 14;
    const corpse = vm.tournament.corpses.find((c) => c.lane === l.lane && c.kind === 'eliminated');
    // The creatures that followed this lane circle the stone, so the failure stays visible.
    let w = this.walkers.get(l.lane);
    if (!w) { w = { x, lastT: now }; this.walkers.set(l.lane, w); }
    w.x = x; w.lastT = now;
    // skeleton lying on the ground to the left of the stone
    const tier = TIER_IDS.includes(l.tier as Tier) ? (l.tier as Tier) : undefined;
    ctx.save();
    ctx.translate(x - 70, floorY - size / 2 + 4);
    ctx.scale(1.02, 1.02);
    ctx.filter = 'grayscale(0.7) brightness(0.82)';
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(0, size / 2, size * 0.42, 6, 0, 0, Math.PI * 2); ctx.fill();
    drawSkeleton(ctx, frameFor('collapse', 1), { silhouette: false, size }, tier, wornParts(l.parts, [], now, this.speed, this.reducedMotion));
    ctx.restore();
    ctx.filter = 'none';
    const h = tombHeight(b.h);
    const box = drawTombstone(ctx, x, floorY, h, fell.round);
    drawWisp(ctx, x, floorY - h, h, now, this.reducedMotion, l.lane);
    const label = vm.stages[deathIdx]?.label ?? fell.stage;
    const tip = epitaphOf(corpse ?? { lane: l.lane, stage: fell.stage, kind: 'eliminated', round: fell.round, epitaph: fell.epitaph, cause: fell.cause }, l.label || l.tier, label);
    this.hot.push({ x: box.x - 70, y: box.y, w: box.w + 80, h: box.h, tip });
    // dim, slow swarm
    const bugs = swarmBugs({ depth: 2, seed: l.lane * 31 + fell.round * 7, age: now, exit: 0, corpse: true, harass: false, speed: this.speed });
    const tint = bugTint('wisp');
    ctx.save();
    for (const g of (this.lite ? bugs.slice(0, 4) : bugs)) {
      ctx.globalAlpha = g.a * 0.8;
      const bx = x + g.x * 0.9, by = floorY - h * 0.55 + g.y * 0.8;
      const r = 3.6 * g.s;
      const wing = Math.abs(Math.sin(g.flap * Math.PI * 2)) * 5 * g.s;
      ctx.fillStyle = tint.wing;
      ctx.beginPath(); ctx.ellipse(bx - 3, by - 3 - wing * 0.2, 3.6 * g.s, wing + 1, -0.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(bx + 3, by - 3 - wing * 0.2, 3.6 * g.s, wing + 1, 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = tint.body;
      ctx.beginPath(); ctx.ellipse(bx, by, r * 1.1, r, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  /** "Survived" flash after boss_end (ui-spec section 5). Reduced motion: no rise, static for the same time. */
  private drawSurvived(ctx: Ctx, l: LaneVM, b: LaneBox, now: number): void {
    const age = survivedAge(l, now);
    if (age === null) return;
    const rise = this.reducedMotion ? 0 : age * 18;
    const a = Math.min(1, (1 - age) * 2.2);
    ctx.save();
    ctx.globalAlpha = a;
    const cx = 1000, cy = b.top + b.h / 2 - rise;
    rr(ctx, cx - 92, cy - 18, 184, 36, 10); ctx.fillStyle = 'rgba(10,8,18,0.8)'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = C.ok; ctx.stroke();
    txt(ctx, 'SURVIVED', cx, cy + 1, 20, C.ok, 'center', SANS, '800');
    ctx.restore();
  }

  /** Creature stack (ui-spec section 7): row above the skeleton, newest on the right, 70% scale when stacked. */
  private drawCreatures(ctx: Ctx, l: LaneVM, b: LaneBox, now: number): void {
    const list = shown(l, now, this.speed);
    if (!list.length) return;
    const skelX = this.walkers.get(l.lane)?.x ?? TRACK_X0 + 40;
    const stacked = list.length > 1;
    const baseX = Math.max(TRACK_X0 + 40, Math.min(skelX + 84, CREATURE_X1 - 56 * (list.length - 1)));
    const fromLeft = baseX < (TRACK_X0 + CREATURE_X1) / 2;
    list.forEach((c, i) => {
      const fr = creatureFrame(c, now, this.speed, this.reducedMotion);
      const scale = c.inner ? 0.55 : stacked ? 0.7 : 1;
      const size = 56 * scale;
      const hx = c.inner ? skelX : baseX + i * 56;
      const hy = c.inner ? b.top + b.h * 0.8 - 80 : b.top + 74 - (stacked ? 0 : 6);
      const e = 1 - Math.pow(1 - fr.enter, 3);
      const x = hx + (fromLeft ? -1 : 1) * (1 - e) * 360;
      const y = hy - (1 - e) * 90 - fr.exit * 14 + (fr.exit === 0 && !this.reducedMotion ? Math.sin(now / 420 + i) * 3 : 0);
      const shake = !this.reducedMotion && fr.acted && fr.p < 0.9 ? Math.sin(now / 24) * 1.5 : 0;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - fr.exit) * (e < 1 ? 0.35 + 0.65 * e : 1);
      ctx.translate(x + shake, y);
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(0, size / 2 + 3, size * 0.28, 4, 0, 0, Math.PI * 2); ctx.fill();
      const id = spriteOf(c.id);
      if (isWorld(c.id)) {
        const wp = worldPhase(c.shrug ? null : c.actAt, now, this.speed);
        drawWorldCreature(ctx, c.id, this.reducedMotion ? 0 : wp.p, wp.acted, size);
      } else if (id) {
        if (c.shrug && !this.reducedMotion) ctx.rotate(Math.sin(((now - (c.actAt ?? now)) / 500) * Math.PI * 4) * 0.12);
        drawCreature(ctx, id, fr.anim, fr.p, { silhouette: false, size });
      } else {
        ctx.filter = 'hue-rotate(160deg)';
        drawCreature(ctx, 'ghost', 'idle', fr.p, { silhouette: false, size });
        ctx.filter = 'none';
      }
      ctx.restore();
      if (isWorld(c.id) && !c.shrug && fr.exit === 0) drawWorldProp(ctx, worldProp(c.id, c.fault, c.actAt, now, this.speed), x, y + size * 0.9, size);
      this.creatureTags(ctx, c, x, y, size, now, fr.exit);
      this.drawSwarm(ctx, l, b, c, fr.exit, now, skelX);
    });
    if (l.creatures.length > MAX_SHOWN) txt(ctx, '+' + (l.creatures.length - MAX_SHOWN), baseX - 40, b.top + 74, 13, C.muted, 'center', MONO, '700');
  }

  /** Little attackers around the skeleton: orbit, peck, then dissipate in a puff (tournament-v3 section 7.1). */
  private drawSwarm(ctx: Ctx, l: LaneVM, b: LaneBox, c: CreatureVM, exit: number, now: number, skelX: number): void {
    if (c.inner && c.killer) return;
    const corpse = l.mode === 'dead' || l.mode === 'halted';
    const quiet = l.mode === 'idle' || l.mode === 'done';
    if (c.exitAt === null && swarmStale(now - c.born, this.speed, quiet)) { c.exitAt = now; c.exitDur = 600; }
    const acted = c.actAt !== null && now >= c.actAt;
    const size = Math.min(88, b.h * 0.5);
    const cx = skelX;
    const cy = b.top + b.h * 0.8 + 4 - size * 0.55;
    const age = now - (c.actAt ?? c.born);
    const lite = this.lite;
    const bugs = swarmBugs({ depth: c.depth, attempts: Math.min(3, Math.floor(age / 4000)), seed: seedOf(c.id, c.born), age, exit, corpse, harass: acted, speed: this.speed });
    const tint = bugTint(c.id);
    const pf = puff(exit);
    ctx.save();
    for (const g of (lite ? bugs.slice(0, 5) : bugs)) {
      if (g.a <= 0.02) continue;
      const bx = cx + g.x;
      const by = cy + g.y;
      ctx.globalAlpha = g.a;
      const r = 4.6 * g.s;
      const wing = Math.abs(Math.sin(g.flap * Math.PI * 2)) * 6.5 * g.s;
      ctx.fillStyle = tint.wing;
      ctx.beginPath(); ctx.ellipse(bx - 3, by - 4 - wing * 0.2, 4.4 * g.s, wing + 1, -0.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(bx + 3, by - 4 - wing * 0.2, 4.4 * g.s, wing + 1, 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = tint.body;
      ctx.beginPath(); ctx.ellipse(bx, by, r * 1.15, r, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(20,14,30,0.85)';
      ctx.fillRect(bx - 1, by - r + 0.5, 1.4, r * 2 - 1);
      if (g.peck > 0.7) { ctx.fillStyle = '#fff4b0'; ctx.fillRect(bx - 1, by + r, 2, 2); }
    }
    if (pf) {
      ctx.globalAlpha = pf.a;
      ctx.strokeStyle = tint.wing; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, pf.r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  /** Fault caption, dice for random chaos, hourglass for a deferred fault. */
  private creatureTags(ctx: Ctx, c: CreatureVM, x: number, y: number, size: number, now: number, exit: number): void {
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - exit);
    ctx.font = '700 11px ' + MONO;
    // Creatures stand 56 px apart: a long word (NOT ON TRUCK, RUNNING LATE) is cut so it never runs into the next tag; the chip's ring carries the full word.
    const cap = fit(ctx, captionOf(c.fault || c.id), 64);
    const w = Math.ceil(ctx.measureText(cap).width) + 10;
    rr(ctx, x - w / 2, y + size / 2 + 6, w, 15, 4); ctx.fillStyle = 'rgba(10,8,18,0.82)'; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = C.out; ctx.stroke();
    txt(ctx, cap, x, y + size / 2 + 14, 13, C.warn, 'center', MONO, '700');
    const tip = creatureTip(c);
    if (c.unknown) {
      const uw = 84, uy = y + size / 2 + 25;
      rr(ctx, x - uw / 2, uy, uw, 18, 5); ctx.fillStyle = C.hex; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = C.out; ctx.stroke();
      txt(ctx, '? UNKNOWN', x, uy + 10, 13, '#ffffff', 'center', MONO, '800');
      if (exit === 0) this.hot.push({ x: x - uw / 2, y: uy, w: uw, h: 18, tip });
    }
    if (tip && !c.unknown && exit === 0) this.hot.push({ x: x - w / 2, y: y + size / 2 + 6, w, h: 15, tip });
    if (c.random) {
      const dx = x + size * 0.38, dy = y - size * 0.42;
      rr(ctx, dx - 7, dy - 7, 14, 14, 3); ctx.fillStyle = C.bone; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = C.out; ctx.stroke();
      ctx.fillStyle = C.out;
      for (const [px, py] of [[-3, -3], [0, 0], [3, 3]] as const) { ctx.beginPath(); ctx.arc(dx + px, dy + py, 1.4, 0, Math.PI * 2); ctx.fill(); }
    }
    if (c.deferred && (c.actAt === null || now < c.actAt)) {
      const hx = x - size * 0.38, hy = y - size * 0.42;
      ctx.beginPath(); ctx.moveTo(hx - 6, hy - 8); ctx.lineTo(hx + 6, hy - 8); ctx.lineTo(hx, hy); ctx.lineTo(hx + 6, hy + 8); ctx.lineTo(hx - 6, hy + 8); ctx.lineTo(hx, hy); ctx.closePath();
      ctx.fillStyle = C.ghost; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = C.out; ctx.stroke();
    }
    ctx.restore();
  }
  /** Gear in flight from the screen edge, landing spark, and the "Kiro added" caption (UI-S4). */
  private drawEquips(ctx: Ctx, l: LaneVM, x: number, feetY: number, size: number, headY: number, now: number): void {
    let row = 0;
    for (const e of l.equips) {
      const ph = equipPhase(e, now, this.speed, this.reducedMotion);
      if (ph.done) continue;
      const to = { x, y: feetY - size * 0.5 };
      if (!ph.landed) {
        const from = { x: x < STAGE_W / 2 ? -30 : STAGE_W + 30, y: headY + 24 };
        const pt = flightPoint(ph.fly, from, to);
        ctx.save(); ctx.translate(pt.x, pt.y); ctx.rotate(pt.rot);
        ctx.shadowColor = C.warn; ctx.shadowBlur = this.lite ? 0 : 18;
        ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.fillStyle = C.warn; ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = C.out; ctx.stroke(); ctx.shadowBlur = 0;
        const g = GEAR_SLOTS.find((s) => s.id === e.part);
        txt(ctx, g?.label ?? '?', 0, 1, 16, C.out, 'center', MONO, '800');
        ctx.restore();
        continue;
      }
      if (ph.spark >= 0) {
        const s = ph.spark;
        ctx.save(); ctx.translate(to.x, to.y); ctx.globalAlpha = 1 - s; ctx.strokeStyle = '#ffe08a'; ctx.lineWidth = 3; ctx.lineCap = 'round';
        const rays = this.lite ? 6 : 10;
        for (let i = 0; i < rays; i++) {
          const a = (i / rays) * Math.PI * 2 + 0.3, r0 = 10 + 10 * s, r1 = 22 + 34 * s;
          ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); ctx.stroke();
        }
        ctx.restore();
      }
      if (ph.caption >= 0) {
        const label = PART_LABEL[e.part] ?? e.part;
        const text = 'Kiro added: ' + label + (e.spec ? ' (' + e.spec + ')' : '');
        ctx.save();
        ctx.globalAlpha = Math.min(1, (1 - ph.caption) * 2.5, ph.caption * 8 + 0.2);
        ctx.font = '700 15px ' + SANS;
        const w = Math.min(380, Math.ceil(ctx.measureText(text).width) + 22);
        const cy = feetY - 22 - row * 26 - (this.reducedMotion ? 0 : 8 * ph.caption);
        const left = x - 56 - w >= TRACK_X0 + 4;
        const cx = left ? x - 56 - w / 2 : x + 70 + w / 2;
        rr(ctx, cx - w / 2, cy - 12, w, 24, 8); ctx.fillStyle = 'rgba(10,8,18,0.85)'; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = C.warn; ctx.stroke();
        txt(ctx, fit(ctx, text, w - 14), cx, cy + 1, 15, C.text, 'center', SANS, '700');
        ctx.restore();
        row++;
      }
    }
  }

  private drawSkeleton(ctx: Ctx, vm: ArenaVM, l: LaneVM, b: LaneBox, now: number): void {
    const size = Math.min(88, b.h * 0.5);
    const feetY = b.top + b.h * 0.8 + 4;
    const tgt = this.target(vm, l);
    let w = this.walkers.get(l.lane);
    if (!w) { w = { x: tgt, lastT: now }; this.walkers.set(l.lane, w); }
    const dt = Math.min(100, now - w.lastT); w.lastT = now;
    const dx = tgt - w.x;
    const frozen = l.mode === 'dead' || l.mode === 'halted' || l.mode === 'reassembling' || l.mode === 'sleep';
    const lm = l.lap && l.mode !== 'sleep' && l.mode !== 'dead' && l.mode !== 'halted' ? lapMotion(l.lap, now) : null;
    const walking = lm ? lm.moving : !frozen && Math.abs(dx) > 3;
    if (lm) w.x = lm.x; else if (l.mode === 'sleep') w.x = tgt; else if (walking) w.x += Math.sign(dx) * Math.min(Math.abs(dx), 0.34 * dt * this.speed);
    const x = w.x;
    const pose = ArenaScene.poseOf(l, now, walking, this.speed);
    const fr = frameFor(pose.anim, pose.p);
    const tier = TIER_IDS.includes(l.tier as Tier) ? (l.tier as Tier) : undefined;
    // red flash over the lane on fail, opacity at most 0.35
    if (l.mode === 'fail') {
      const a = Math.max(0, 0.35 * (1 - (now - l.since) / (800 / this.speed)));
      if (a > 0) { ctx.fillStyle = `rgba(255,77,94,${a})`; ctx.fillRect(TRACK_X0, b.top, 1340, b.h); }
    }
    ctx.save();
    ctx.translate(x, feetY - size / 2);
    if (l.mode === 'halted') ctx.filter = 'grayscale(1) brightness(0.8)';
    const flip = walking && (lm ? lm.dir < 0 : dx < 0) ? -1 : 1;
    ctx.scale(flip, 1);
    // soft shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(0, size / 2, size * 0.3, 6, 0, 0, Math.PI * 2); ctx.fill();
    drawSkeleton(ctx, fr, { silhouette: false, size }, tier, wornParts(l.parts, l.equips, now, this.speed, this.reducedMotion));
    ctx.restore();
    ctx.filter = 'none';
    if (lm?.moving && l.lap?.move?.gait === 'run' && !this.reducedMotion) drawRunDust(ctx, x, feetY, lm.dir, now, this.lite);

    const k = size / 100;
    const headY = feetY - size * 0.98;
    if (l.mode === 'recovering') {
      // bandage across the skull and a spinner with the action caption
      ctx.save(); ctx.translate(x, headY + size * 0.2); ctx.rotate(-0.15);
      ctx.fillStyle = '#f4efe2'; ctx.strokeStyle = C.out; ctx.lineWidth = 2.5; ctx.fillRect(-22 * k, -5 * k, 44 * k, 9 * k); ctx.strokeRect(-22 * k, -5 * k, 44 * k, 9 * k);
      ctx.restore();
      // left of the skull, so it never overlaps the stage chip row above
      const sy = headY + size * 0.3;
      ctx.strokeStyle = C.warn; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(x - 34, sy, 10, now / 150, now / 150 + Math.PI * 1.4); ctx.stroke();
      const cap = ACTION_CAPTION[l.action] ?? 'Recovering';
      txt(ctx, cap, x - 52, sy, 15, C.warn, 'right', SANS, '700');
    }
    if (l.mode === 'dead') {
      const left = Math.max(0, 1 - (now - l.since) / Math.max(1, l.restartInMs));
      ctx.strokeStyle = 'rgba(143,134,168,0.9)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, feetY - 10, 22, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left); ctx.stroke();
    }
    this.drawEquips(ctx, l, x, feetY, size, headY, now);
    if (l.mode === 'halted') txt(ctx, '⚰ HALTED', x, headY + size * 0.2, 15, C.muted, 'center', SANS, '700');
    if (l.mode === 'fail') txt(ctx, '✕', x, headY + size * 0.22, 26, C.fail, 'center', SANS, '800');
    // scroll in hand
    const holding = l.order && !l.lap?.empty && l.lap?.ceremony?.kind !== 'cancel' && l.mode !== 'dead' && l.mode !== 'sleep' && l.mode !== 'halted' && l.mode !== 'reassembling';
    if (holding) {
      const hx = x + size * 0.34, hy = feetY - size * 0.62 + (l.mode === 'fail' ? 8 : 0), hs = size / 150;
      const gp = this.reducedMotion ? -1 : grabProgress(l.lap, now);
      const dp = gp >= 0 || l.lap?.grab ? -1 : dropProgress(l.orderDrop, now, this.speed, this.reducedMotion);
      const from = { x: STACK_X + 4, y: stackY(b) - 8 };
      if (gp >= 0 || dp >= 0) {
        const pt = gp >= 0 ? grabPoint(gp, from, { x: hx, y: hy }) : dropPoint(dp, from, { x: hx, y: hy });
        ctx.save(); ctx.translate(pt.x, pt.y); ctx.rotate(pt.rot); ctx.translate(-pt.x, -pt.y);
        scroll(ctx, pt.x, pt.y, hs * pt.scale, displayId(vm.app, l.order ?? ''), false);
        ctx.restore();
      } else scroll(ctx, hx, hy, hs, displayId(vm.app, l.order ?? ''), l.mode === 'fail' && l.chips.includes('failed'));
    }
    if (l.lap?.ceremony) {
      const hs = size / 150;
      drawHandoff(ctx, l.lap.ceremony, {
        doorX: 1548, floorY: b.top + b.h - 8, doorH: Math.min(100, b.h * 0.7), handX: x + size * 0.34, handY: feetY - size * 0.62, scrollScale: hs,
        size, skelX: x, feetY, drawScroll: (sx, sy, s, rot) => { ctx.save(); ctx.translate(sx, sy); ctx.rotate(rot); ctx.translate(-sx, -sy); scroll(ctx, sx, sy, s, displayId(vm.app, l.order ?? ''), false); ctx.restore(); },
        font: SANS, reduced: this.reducedMotion, lite: this.lite,
      }, now);
    }
    if (l.mode === 'working' && !walking) workProp(ctx, l.workAnim, pose.p, x + size * 0.1, feetY - 2, size, 1548);
    if (l.cheer && now - l.cheer.since < l.cheer.dur / this.speed) {
      const big = l.cheer.dur > 400;
      const p = (now - l.cheer.since) * this.speed / l.cheer.dur;
      confetti(ctx, x, feetY - size * 0.8, p, l.lane * 7 + l.orderIndex, this.lite ? 4 : big ? 22 : 6);
      if (big) {
        ctx.save(); ctx.globalAlpha = Math.max(0, 1 - p); txt(ctx, l.dirty ? '✕ repeats' : '✓ DONE', x, headY - 26 - 14 * p, 18, l.dirty ? C.fail : C.ok, 'center', SANS, '800'); ctx.restore();
      }
    }
  }
}

/** Step cadence: fast on the run back after a handoff, slow on the trudge after a cancel (PT-U2). */
function gaitRate(l: LaneVM): number {
  const g = l.lap?.move?.gait;
  return g === 'run' ? 2.4 : g === 'trudge' ? 0.5 : 1;
}

const ACTION_CAPTION: Record<string, string> = {
  replay: 'Replaying', reconcile: 'Reconciling', retry: 'Retrying', backoff: 'Backing off', restart: 'Restarting',
};

const SLEEP_TIERS: Tier[] = ['rookie', 'retrier', 'journaler', 'reconciler', 'phoenix'];

/** The quiet crypt: five sleeping skeletons, one per tier. */
function sleepers(vm: ArenaVM, now: number): LaneVM[] {
  return SLEEP_TIERS.map((t, i) => {
    const l = {
      lane: i + 1, tier: t, label: TIER_LABEL[t], parts: [] as string[], mode: 'sleep' as const, since: now,
      chips: Array<ChipState>(vm.stages.length).fill('pending'), attempts: Array<number>(vm.stages.length).fill(0),
      stageIndex: 0, progress: 0, progressLabel: '', workAnim: '', order: null, orderIndex: 0, ordersTotal: 0, score: 0,
      counts: { completed: 0, failed: 0, parked: 0, quarantined: 0, repeats: 0 }, depth: 0, action: '', restartInMs: 0, cheer: null, dirty: false, survivedAt: 0,
      ledger: {}, keyMax: {}, flash: {}, creatures: [], equips: [], scorePop: null,
    } satisfies LaneVM;
    return l;
  });
}
