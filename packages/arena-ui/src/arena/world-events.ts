/// <reference lib="dom" />
// PT-U10: world creature choreographies (ui.md section 11). Pure choreography model plus code-drawn
// placeholder sprites for scarecrow, black cat, phantom car and prankster (final art is PT-ART).
// Cosmetic only. No clock: `now` is passed in.

export const WORLD_IDS = ['scarecrow', 'black_cat', 'phantom_car', 'prankster'] as const;
export type WorldId = (typeof WORLD_IDS)[number];

export const isWorld = (id: string): id is WorldId => (WORLD_IDS as readonly string[]).includes(id);

/** Fault captions for world faults and the three caption-only creatures. */
export const WORLD_CAPTION: Record<string, string> = {
  sms_down: 'SMS DOWN', app_down: 'APP DOWN', updates_down: 'UPDATES DOWN',
  wrong_address: 'WRONG ADDRESS', no_answer: 'NO ANSWER', gated_house: 'GATED HOUSE', car_accident: 'CAR ACCIDENT', order_typo: 'ORDER TYPO',
};

export type PropKind = 'signpost' | 'nobody_home' | 'gate_bars' | 'crash' | 'wrong_order' | 'none';

export interface WorldProp { kind: PropKind; label: string; /** 0..1 progress of the prop animation. */ p: number; /** Hazard lights on (phantom car). */ blink: boolean }

export const WORLD_ACT_MS = 1100;

/** Which prop a world creature shows. Nothing until it has acted, so props follow the choreography. */
export function worldProp(id: string, fault: string, actAt: number | null, now: number, speed = 1): WorldProp {
  const none: WorldProp = { kind: 'none', label: '', p: 0, blink: false };
  if (!isWorld(id) || actAt === null || now < actAt) return none;
  const p = Math.min(1, ((now - actAt) * Math.max(0.1, speed)) / WORLD_ACT_MS);
  switch (id) {
    case 'scarecrow': return { kind: 'signpost', label: 'WRONG WAY', p, blink: false };
    case 'black_cat': return fault === 'gated_house' ? { kind: 'gate_bars', label: 'GATED', p, blink: false } : { kind: 'nobody_home', label: 'NOBODY HOME', p, blink: false };
    case 'phantom_car': return { kind: 'crash', label: 'CRASH', p, blink: Math.floor(now / 260) % 2 === 0 };
    case 'prankster': return { kind: 'wrong_order', label: 'WRONG ORDER', p, blink: Math.floor(now / 200) % 2 === 0 };
  }
  return none;
}

/** Act animation progress for the code-drawn sprite (0..1, loops while idle). */
export function worldPhase(actAt: number | null, now: number, speed = 1): { acted: boolean; p: number } {
  if (actAt === null || now < actAt) return { acted: false, p: (now % 2000) / 2000 };
  return { acted: true, p: Math.min(1, ((now - actAt) * Math.max(0.1, speed)) / WORLD_ACT_MS) };
}

type Ctx = CanvasRenderingContext2D;
const OUT = '#14101f';

function outline(ctx: Ctx): void { ctx.lineWidth = 3; ctx.strokeStyle = OUT; ctx.lineJoin = 'round'; ctx.stroke(); }

/** Draws a world creature centred at the origin, `size` px tall. Silhouette-friendly flat shapes. */
export function drawWorldCreature(ctx: Ctx, id: WorldId, p: number, acted: boolean, size: number): void {
  const s = size / 56;
  ctx.save(); ctx.scale(s, s);
  const sway = Math.sin(p * Math.PI * 2) * (acted ? 0.18 : 0.06);
  switch (id) {
    case 'scarecrow': {
      ctx.rotate(sway);
      ctx.beginPath(); ctx.rect(-3, -6, 6, 34); ctx.fillStyle = '#6b4a2b'; ctx.fill(); outline(ctx);
      ctx.beginPath(); ctx.rect(-26, -4, 52, 7); ctx.fillStyle = '#8a6238'; ctx.fill(); outline(ctx);
      ctx.beginPath(); ctx.arc(0, -16, 11, 0, Math.PI * 2); ctx.fillStyle = '#d9b36b'; ctx.fill(); outline(ctx);
      ctx.beginPath(); ctx.moveTo(-14, -22); ctx.lineTo(0, -38); ctx.lineTo(14, -22); ctx.closePath(); ctx.fillStyle = '#3a2d52'; ctx.fill(); outline(ctx);
      ctx.fillStyle = OUT; ctx.fillRect(-5, -18, 3, 3); ctx.fillRect(2, -18, 3, 3);
      break;
    }
    case 'black_cat': {
      ctx.fillStyle = '#1b1626';
      ctx.beginPath(); ctx.ellipse(0, 12, 17, 13, 0, 0, Math.PI * 2); ctx.fill(); outline(ctx);
      ctx.beginPath(); ctx.arc(0, -8, 11, 0, Math.PI * 2); ctx.fill(); outline(ctx);
      for (const sx of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sx * 4, -16); ctx.lineTo(sx * 11, -26); ctx.lineTo(sx * 12, -11); ctx.closePath(); ctx.fill(); outline(ctx); }
      ctx.beginPath(); ctx.moveTo(15, 18); ctx.quadraticCurveTo(30, 14 + Math.sin(p * Math.PI * 2) * 8, 26, -4); ctx.lineWidth = 6; ctx.strokeStyle = '#1b1626'; ctx.stroke();
      ctx.fillStyle = '#ffd24a'; ctx.beginPath(); ctx.ellipse(-4, -9, 2.6, acted ? 4 : 3, 0, 0, Math.PI * 2); ctx.ellipse(4, -9, 2.6, acted ? 4 : 3, 0, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'phantom_car': {
      const lurch = acted ? (1 - p) * 14 : Math.sin(p * Math.PI * 2) * 2;
      ctx.translate(lurch, 0);
      ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.roundRect(-28, 0, 56, 18, 6); ctx.fillStyle = '#9fd0ff'; ctx.fill(); outline(ctx);
      ctx.beginPath(); ctx.moveTo(-17, 0); ctx.lineTo(-10, -14); ctx.lineTo(12, -14); ctx.lineTo(20, 0); ctx.closePath(); ctx.fillStyle = '#c8e4ff'; ctx.fill(); outline(ctx);
      for (const wx of [-16, 16]) { ctx.beginPath(); ctx.arc(wx, 19, 6, 0, Math.PI * 2); ctx.fillStyle = '#2a2446'; ctx.fill(); outline(ctx); }
      ctx.globalAlpha = 1;
      break;
    }
    case 'prankster': {
      ctx.rotate(sway);
      ctx.beginPath(); ctx.ellipse(0, -10, 16, 15, 0, 0, Math.PI * 2); ctx.fillStyle = '#ff8a1f'; ctx.fill(); outline(ctx);
      ctx.beginPath(); ctx.rect(-2, -28, 4, 7); ctx.fillStyle = '#4a7a2b'; ctx.fill(); outline(ctx);
      ctx.fillStyle = OUT;
      ctx.beginPath(); ctx.moveTo(-9, -14); ctx.lineTo(-3, -14); ctx.lineTo(-6, -8); ctx.closePath(); ctx.moveTo(9, -14); ctx.lineTo(3, -14); ctx.lineTo(6, -8); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-8, -2); ctx.quadraticCurveTo(0, 6, 8, -2); ctx.lineWidth = 2.5; ctx.strokeStyle = OUT; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-6, 5); ctx.lineTo(-10, 24); ctx.moveTo(6, 5); ctx.lineTo(10, 24); ctx.lineWidth = 4; ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

/** Draws the prop next to the creature at (x, y). `h` is the creature size. */
export function drawWorldProp(ctx: Ctx, pr: WorldProp, x: number, y: number, h: number): void {
  if (pr.kind === 'none') return;
  const pop = Math.min(1, pr.p * 3);
  ctx.save(); ctx.translate(x, y); ctx.globalAlpha = pop;
  ctx.font = '800 12px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const sign = (text: string, fill: string, ink: string, w: number): void => {
    ctx.beginPath(); ctx.roundRect(-w / 2, -9, w, 18, 4); ctx.fillStyle = fill; ctx.fill(); outline(ctx);
    ctx.fillStyle = ink; ctx.fillText(text, 0, 1);
  };
  switch (pr.kind) {
    case 'signpost':
      ctx.rotate(pr.p < 1 ? Math.sin(pr.p * 18) * 0.12 : 0);
      ctx.beginPath(); ctx.rect(-2, 0, 4, h * 0.6); ctx.fillStyle = '#6b4a2b'; ctx.fill(); outline(ctx);
      sign('\u2190 ' + pr.label, '#ffc247', OUT, 104);
      break;
    case 'nobody_home': sign(pr.label, '#efe6d2', OUT, 112); break;
    case 'gate_bars':
      ctx.strokeStyle = '#9aa0b4'; ctx.lineWidth = 4;
      for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(i * 9, -h * 0.5 * pop); ctx.lineTo(i * 9, h * 0.5); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(-30, 0); ctx.lineTo(30, 0); ctx.stroke();
      break;
    case 'crash': {
      ctx.fillStyle = pr.blink ? '#ffb020' : '#7a4a10';
      ctx.beginPath(); ctx.arc(-24, -h * 0.35, 5, 0, Math.PI * 2); ctx.arc(24, -h * 0.35, 5, 0, Math.PI * 2); ctx.fill();
      if (pr.p < 0.5) { ctx.fillStyle = '#ffe08a'; ctx.font = '800 16px ui-monospace, monospace'; ctx.fillText('CRUNCH!', 0, -h * 0.7); }
      break;
    }
    case 'wrong_order': sign(pr.label, pr.blink ? '#ff4d5e' : '#7a2430', '#fff', 112); break;
  }
  ctx.restore();
}
