/// <reference lib="dom" />
// Code-drawn streaming creatures (PK-U2). Same style guide as draw.ts: 4 px #14101f outline, flat fill, one shade and one rim crescent.
// Units: a 100-tall box centred on x = 0, feet at y = 0, up is negative.
import { registerSprite, ease, type DrawOpts } from '../lab/registry';
import { OUT, TAU, ball, blob, eyes, glow, limb, seg, unit } from './draw';
import { STREAMING, type StreamingId } from './streaming-defs';

type Ctx = CanvasRenderingContext2D;
const BONE = '#efe6d2';

function bufferWraith(ctx: Ctx, o: DrawOpts, a: string, p: number): void {
  const t = p * TAU;
  const stall = a === 'stall';
  ctx.translate(0, Math.sin(t) * 3 - 5);
  glow(ctx, o, 0, -52, 60, '#9ab8ff', 0.28);
  blob(ctx, o, 'M-22,-70C-22,-86 22,-86 22,-70L24,-8L16,-16L8,-6L0,-16L-8,-6L-16,-16L-24,-8Z', '#cfd8f5', '#9aa8d6', '#ffffff');
  eyes(ctx, o, [[-8, -66], [8, -66]], 4.2, OUT);
  // the loading ring that never fills: a spinning arc on the belly
  if (!o.silhouette) {
    const sweep = stall ? t * 2 : t;
    ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(20,16,31,0.25)'; ctx.beginPath(); ctx.arc(0, -40, 11, 0, TAU); ctx.stroke();
    ctx.strokeStyle = stall ? '#ff6b7a' : '#4a63b8'; ctx.beginPath(); ctx.arc(0, -40, 11, sweep, sweep + 1.7); ctx.stroke();
  }
  if (stall && !o.silhouette) {
    ctx.fillStyle = '#ff6b7a';
    for (const k of [0, 1, 2]) { const q = (p * 2 + k / 3) % 1; ctx.globalAlpha = 1 - q; ctx.fillRect(-26 + k * 26, -24 + q * -6, 8, 4); }
    ctx.globalAlpha = 1;
  }
}

function cdnKraken(ctx: Ctx, o: DrawOpts, a: string, p: number): void {
  const t = p * TAU;
  const sq = a === 'squeeze' ? ease.inOutCubic(seg(p, 0.1, 0.55)) * (1 - seg(p, 0.85, 1)) : 0;
  ctx.translate(0, Math.sin(t) * 2);
  for (const k of [-2, -1, 0, 1, 2]) {
    const sway = Math.sin(t + k) * 5;
    const reach = 22 + Math.abs(k) * 9;
    blob(ctx, o, `M${k * 11 - 5},-34C${k * 17 + sway},-22 ${k * 20 - sway},-10 ${k * 14 + sway * 1.4 - sq * k * 3},0L${k * 14 + sway * 1.4 + 6 - sq * k * 3},-2C${k * 20 - sway + 5},-14 ${k * 16 + sway + 4},-24 ${k * 11 + 6},-34Z`, '#7b4fa8', '#573678', '#a77fd2');
    if (!o.silhouette && reach > 30) { ctx.fillStyle = '#d9c2f0'; ctx.beginPath(); ctx.arc(k * 15 + sway * 0.7, -12, 2.4, 0, TAU); ctx.fill(); }
  }
  ball(ctx, o, 0, -58, 28, 25, '#8f5fc4', '#6a3f98', '#bd94e8');
  eyes(ctx, o, [[-10, -60], [10, -60]], 7, '#fff6c8');
  eyes(ctx, o, [[-10 + sq * 2, -60], [10 - sq * 2, -60]], 3.2, OUT);
  // cable ring it crushes: a ring of "network" nodes around the body
  if (!o.silhouette) {
    ctx.strokeStyle = '#7fe3e0'; ctx.lineWidth = 3; ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.ellipse(0, -34, 36 - sq * 10, 7, 0, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
  }
}

function drmGatekeeper(ctx: Ctx, o: DrawOpts, a: string, p: number): void {
  const t = p * TAU;
  const deny = a === 'deny';
  const slam = deny ? ease.outBack(seg(p, 0, 0.35)) : 0;
  ctx.translate(0, Math.sin(t) * 2 - 3);
  glow(ctx, o, 0, -52, 54, '#ffc247', 0.18);
  blob(ctx, o, 'M-20,-72C-20,-88 20,-88 20,-72L22,-6L-22,-6Z', '#8a7fb0', '#615884', '#bdb2de');
  ball(ctx, o, 0, -72, 13, 13, '#d9d2ee', '#a79fc6', '#ffffff');
  eyes(ctx, o, [[-5, -74], [5, -74]], 2.6, OUT);
  // padlock belly
  blob(ctx, o, 'M-9,-50H9V-30H-9Z', '#ffc247', '#c98f1d', '#ffe08a');
  if (!o.silhouette) {
    ctx.lineWidth = 4; ctx.strokeStyle = OUT; ctx.beginPath(); ctx.arc(0, -52, 7, Math.PI, 0); ctx.stroke();
    ctx.fillStyle = OUT; ctx.beginPath(); ctx.arc(0, -41, 2.2, 0, TAU); ctx.fill();
  }
  // barred arm and the DENIED stamp
  limb(ctx, o, -18, -58, -32 + slam * 4, -40, 6, '#8a7fb0');
  limb(ctx, o, 18, -58, 32 - slam * 4, -40, 6, '#8a7fb0');
  limb(ctx, o, -38, -48, -38, -8, 5, BONE);
  if (deny && !o.silhouette) {
    ctx.save();
    ctx.translate(0, -22); ctx.rotate(-0.14); ctx.globalAlpha = seg(p, 0.3, 0.45);
    ctx.fillStyle = 'rgba(255,77,94,0.18)'; ctx.fillRect(-24, -8, 48, 16);
    ctx.lineWidth = 3; ctx.strokeStyle = '#ff4d5e'; ctx.strokeRect(-24, -8, 48, 16);
    ctx.font = '800 11px ui-monospace, monospace'; ctx.fillStyle = '#ff4d5e'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('DENIED', 0, 1);
    ctx.restore();
  }
}

function renderGremlin(ctx: Ctx, o: DrawOpts, a: string, p: number): void {
  const t = p * TAU;
  const glitch = a === 'glitch';
  ctx.translate(0, glitch ? Math.abs(Math.sin(p * TAU * 3)) * -3 : Math.sin(t * 2) * -1.5);
  limb(ctx, o, -7, -16, -9, -1, 5, '#6f8f86');
  limb(ctx, o, 7, -16, 9, -1, 5, '#6f8f86');
  ball(ctx, o, 0, -32, 17, 18, '#7fa89b', '#567a6f', '#b6dccf');
  // the smashed screen it carries
  const tilt = glitch ? Math.sin(p * 40) * 0.08 : 0;
  ctx.save(); ctx.translate(16, -40); ctx.rotate(0.25 + tilt);
  blob(ctx, o, 'M-13,-10H13V10H-13Z', '#2a2446', '#14101f', '#4a4268');
  if (!o.silhouette) {
    const cols = ['#ff4d5e', '#5ee08a', '#7ab8ff', '#ffc247'];
    const n = glitch ? 6 : 2;
    for (let k = 0; k < n; k++) { const gx = -11 + ((k * 7 + Math.floor(p * 12) * 5) % 18); const gy = -8 + ((k * 5 + Math.floor(p * 9) * 3) % 12); ctx.fillStyle = cols[k % 4]!; ctx.fillRect(gx, gy, 6, 3); }
  }
  ctx.restore();
  blob(ctx, o, 'M-6,-62L-3,-72L0,-63L4,-73L6,-62Z', '#567a6f', '#3d5a51');
  ball(ctx, o, 0, -52, 14.5, 12.5, '#7fa89b', '#567a6f', '#b6dccf');
  glow(ctx, o, 0, -54, 24, '#ff4d5e', 0.2);
  eyes(ctx, o, [[-5.5, -54], [5.5, -54]], 4, '#fff6c8');
  eyes(ctx, o, [[-5, -54], [6, -54]], 1.8, OUT);
}

function cloudBanshee(ctx: Ctx, o: DrawOpts, a: string, p: number): void {
  const t = p * TAU;
  const wail = a === 'wail';
  const open = wail ? ease.inOutCubic(seg(p, 0, 0.25)) * (1 - seg(p, 0.85, 1)) : 0;
  ctx.translate(0, Math.sin(t) * 3 - 6);
  // storm cloud body
  blob(ctx, o, 'M-30,-50C-42,-52-42,-72-28,-72C-24,-88-2,-90 4,-78C16,-92 36,-80 30,-68C46,-66 44,-48 28,-50Z', '#7e87b0', '#59618a', '#b4bcdc');
  ball(ctx, o, 0, -62, 13, 14, '#e6f3f8', '#b6d3df', '#ffffff');
  eyes(ctx, o, [[-5, -65], [5, -65]], 2.6, OUT);
  ctx.fillStyle = OUT; ctx.beginPath(); ctx.ellipse(0, -56, 4 + open * 2, 2 + open * 8, 0, 0, TAU); ctx.fill();
  // ragged gown under the cloud
  blob(ctx, o, 'M-12,-48C-20,-30-24,-14-28,-2L-18,-8L-10,2L-2,-6L6,2L14,-6L24,-2C20,-14,18,-30,12,-48Z', '#8fb7d9', '#5f88aa', '#cfe9f6');
  if (!o.silhouette) {
    ctx.strokeStyle = '#ffe45c'; ctx.lineWidth = 3;
    if (wail && p > 0.2 && p < 0.7 && Math.floor(p * 16) % 2 === 0) { ctx.beginPath(); ctx.moveTo(-20, -48); ctx.lineTo(-26, -34); ctx.lineTo(-20, -34); ctx.lineTo(-28, -18); ctx.stroke(); }
    ctx.strokeStyle = '#9ec0ff'; ctx.lineWidth = 2;
    for (const k of [0, 1, 2, 3]) { const q = (p * 2.2 + k * 0.27) % 1; ctx.globalAlpha = 1 - q; ctx.beginPath(); ctx.moveTo(-22 + k * 14, -44 + q * 38); ctx.lineTo(-24 + k * 14, -38 + q * 38); ctx.stroke(); }
    ctx.globalAlpha = 1;
  }
}

function regionGhost(ctx: Ctx, o: DrawOpts, a: string, p: number): void {
  const t = p * TAU;
  const lock = a === 'lock';
  const up = lock ? ease.outBack(seg(p, 0, 0.4)) : 0.3;
  ctx.translate(0, Math.sin(t) * 3 - 5);
  glow(ctx, o, 0, -50, 56, '#7ab8ff', 0.22);
  blob(ctx, o, 'M-20,-68C-20,-86 20,-86 20,-68L22,-8L14,-16L7,-6L0,-16L-7,-6L-14,-16L-22,-8Z', '#e9f1ff', '#bccbe8', '#ffffff');
  eyes(ctx, o, [[-7, -66], [7, -66]], 3.6, OUT);
  ctx.fillStyle = OUT; ctx.beginPath(); ctx.ellipse(0, -56, 3, 4, 0, 0, TAU); ctx.fill();
  // the map it holds up: a globe tile with a red region border and slash
  ctx.save(); ctx.translate(0, -34 - up * 8);
  blob(ctx, o, 'M-17,-12H17V12H-17Z', '#2f6f9f', '#1f4d73', '#5aa3d6');
  if (!o.silhouette) {
    ctx.fillStyle = '#6fbf73'; ctx.beginPath(); ctx.ellipse(-5, -2, 7, 5, 0.3, 0, TAU); ctx.ellipse(8, 3, 5, 4, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#ff4d5e'; ctx.lineWidth = 3; ctx.strokeRect(-14, -9, 28, 18);
    if (lock) { ctx.beginPath(); ctx.moveTo(-14, 9); ctx.lineTo(14, -9); ctx.stroke(); }
  }
  ctx.restore();
}

const DRAW: Record<StreamingId, (ctx: Ctx, o: DrawOpts, anim: string, p: number) => void> = {
  buffer_wraith: bufferWraith, cdn_kraken: cdnKraken, drm_gatekeeper: drmGatekeeper,
  render_gremlin: renderGremlin, cloud_banshee: cloudBanshee, region_ghost: regionGhost,
};

export function drawStreaming(ctx: Ctx, id: StreamingId, anim: string, p: number, o: DrawOpts): void {
  unit(ctx, o, () => DRAW[id](ctx, o, anim, p));
}

for (const c of STREAMING) {
  registerSprite({
    id: `creature-${c.id}`,
    name: c.name,
    group: c.group,
    anims: c.anims.map((x) => ({ ...x })),
    draw(ctx, anim, p, opts) { drawStreaming(ctx, c.id, anim.id, p, opts); },
  });
}
