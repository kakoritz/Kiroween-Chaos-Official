/// <reference lib="dom" />
// PT-U10: world creature choreographies (ui.md section 11). Pure choreography model plus code-drawn
// placeholder sprites for scarecrow, black cat, phantom car and prankster (final art is PT-ART).
// Cosmetic only. No clock: `now` is passed in.

export const WORLD_IDS = ['scarecrow', 'black_cat', 'phantom_car', 'prankster', 'storm_crow', 'pothole_imp', 'fuel_wraith', 'lost_parcel_ghoul'] as const;
export type WorldId = (typeof WORLD_IDS)[number];

export const isWorld = (id: string): id is WorldId => (WORLD_IDS as readonly string[]).includes(id);

/** Fault captions for world faults and the three caption-only creatures. */
export const WORLD_CAPTION: Record<string, string> = {
  sms_down: 'SMS DOWN', app_down: 'APP DOWN', updates_down: 'UPDATES DOWN',
  weather: 'STORM', road_hazard: 'POTHOLE', delay: 'RUNNING LATE', out_of_gas: 'OUT OF GAS', not_on_truck: 'NOT ON TRUCK',
  wrong_address: 'WRONG ADDRESS', no_answer: 'NO ANSWER', gated_house: 'GATED HOUSE', car_accident: 'CAR ACCIDENT', order_typo: 'ORDER TYPO',
};

export type PropKind = 'signpost' | 'nobody_home' | 'gate_bars' | 'crash' | 'wrong_order' | 'storm' | 'pothole' | 'late_clock' | 'empty_tank' | 'missing_parcel' | 'none';

/** Tint of the stage chip while a transit stall lasts (the chip border, the wash and the countdown ring caption). */
export const FAULT_TINT: Readonly<Record<string, string>> = {
  weather: '#7aa7e8', road_hazard: '#f0a93a', delay: '#d8c27a', out_of_gas: '#e0607e', not_on_truck: '#8fd47c', wrong_address: '#ffc247',
};
export const tintOf = (fault: string): string | null => FAULT_TINT[fault] ?? null;

export interface WorldProp { kind: PropKind; label: string; /** 0..1 progress of the prop animation. */ p: number; /** Hazard lights on (phantom car). */ blink: boolean }

export const WORLD_ACT_MS = 1100;

/** Which prop a world creature shows. Nothing until it has acted, so props follow the choreography. */
export function worldProp(id: string, fault: string, actAt: number | null, now: number, speed = 1): WorldProp {
  const none: WorldProp = { kind: 'none', label: '', p: 0, blink: false };
  if (!isWorld(id) || actAt === null || now < actAt) return none;
  const p = Math.min(1, ((now - actAt) * Math.max(0.1, speed)) / WORLD_ACT_MS);
  switch (id) {
    case 'scarecrow': return fault === 'delay' ? { kind: 'late_clock', label: 'RUNNING LATE', p, blink: Math.floor(now / 300) % 2 === 0 } : { kind: 'signpost', label: 'WRONG WAY', p, blink: false };
    case 'storm_crow': return { kind: 'storm', label: 'STORM', p, blink: Math.floor(now / 140) % 5 === 0 };
    case 'pothole_imp': return { kind: 'pothole', label: 'POTHOLE', p, blink: false };
    case 'fuel_wraith': return { kind: 'empty_tank', label: 'OUT OF GAS', p, blink: Math.floor(now / 380) % 2 === 0 };
    case 'lost_parcel_ghoul': return { kind: 'missing_parcel', label: 'NOT ON TRUCK', p, blink: Math.floor(now / 500) % 2 === 0 };
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
    case 'storm_crow': {
      const flap = Math.sin(p * Math.PI * 2 * (acted ? 3 : 1)) * 0.28;
      const cloud = acted ? Math.min(1, p * 2.2) : 0.45;
      ctx.globalAlpha = 0.5 + 0.5 * cloud;
      ctx.fillStyle = '#5a617f';
      for (const [cx, cy, cr] of [[-15, -28, 9], [0, -33, 12], [15, -28, 9]] as const) { ctx.beginPath(); ctx.arc(cx, cy - 3 * cloud, cr, 0, Math.PI * 2); ctx.fill(); outline(ctx); }
      ctx.globalAlpha = 1;
      if (acted && p < 0.75 && Math.floor(p * 18) % 2 === 0) {
        ctx.beginPath(); ctx.moveTo(2, -22); ctx.lineTo(-5, -6); ctx.lineTo(1, -6); ctx.lineTo(-6, 12); ctx.lineTo(8, -9); ctx.lineTo(2, -9); ctx.closePath();
        ctx.fillStyle = '#ffe45c'; ctx.fill(); outline(ctx);
      }
      ctx.fillStyle = '#1d1830';
      ctx.beginPath(); ctx.ellipse(0, 8, 13, 9, 0, 0, Math.PI * 2); ctx.fill(); outline(ctx);
      ctx.beginPath(); ctx.arc(11, 1, 7, 0, Math.PI * 2); ctx.fill(); outline(ctx);
      ctx.beginPath(); ctx.moveTo(17, 0); ctx.lineTo(25, 3); ctx.lineTo(17, 5); ctx.closePath(); ctx.fillStyle = '#e8b13a'; ctx.fill(); outline(ctx);
      ctx.save(); ctx.translate(-4, 4); ctx.rotate(-0.5 - flap);
      ctx.beginPath(); ctx.ellipse(-6, 0, 14, 5, 0, 0, Math.PI * 2); ctx.fillStyle = '#2a2342'; ctx.fill(); outline(ctx); ctx.restore();
      ctx.fillStyle = '#fff'; ctx.fillRect(12, -1, 3, 3);
      break;
    }
    case 'pothole_imp': {
      const up = acted ? Math.min(1, p * 2.5) : 0.35 + Math.sin(p * Math.PI * 2) * 0.06;
      ctx.beginPath(); ctx.ellipse(0, 22, 24, 7, 0, 0, Math.PI * 2); ctx.fillStyle = '#0c0912'; ctx.fill(); outline(ctx);
      ctx.beginPath(); ctx.ellipse(-24, 19, 7, 3, 0, 0, Math.PI * 2); ctx.ellipse(25, 20, 6, 3, 0, 0, Math.PI * 2); ctx.fillStyle = '#6b4a2b'; ctx.fill();
      ctx.save(); ctx.beginPath(); ctx.rect(-30, -40, 60, 62); ctx.clip();
      ctx.translate(0, 22 - up * 34);
      ctx.beginPath(); ctx.ellipse(0, 6, 11, 12, 0, 0, Math.PI * 2); ctx.fillStyle = '#c8473a'; ctx.fill(); outline(ctx);
      for (const sx of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sx * 5, -4); ctx.lineTo(sx * 11, -15); ctx.lineTo(sx * 11, -2); ctx.closePath(); ctx.fill(); outline(ctx); }
      ctx.fillStyle = '#ffe08a'; ctx.fillRect(-6, 2, 4, 4); ctx.fillRect(2, 2, 4, 4);
      ctx.beginPath(); ctx.moveTo(-5, 11); ctx.quadraticCurveTo(0, 15, 5, 11); ctx.lineWidth = 2; ctx.strokeStyle = OUT; ctx.stroke();
      ctx.save(); ctx.translate(13, 8); ctx.rotate(acted ? -0.9 + Math.sin(p * 30) * 0.5 : -0.3);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -22); ctx.lineWidth = 3; ctx.strokeStyle = '#8a6238'; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-8, -22); ctx.quadraticCurveTo(0, -30, 8, -22); ctx.lineWidth = 4; ctx.strokeStyle = '#aab'; ctx.stroke(); ctx.restore();
      ctx.restore();
      if (acted && p < 0.8) { ctx.fillStyle = '#6b4a2b'; for (let i = 0; i < 5; i++) { const a = p * 6 + i * 1.3; ctx.fillRect(-18 + i * 9 + Math.sin(a) * 4, 12 - Math.abs(Math.sin(a * 1.6)) * 22 * (1 - p), 3, 3); } }
      break;
    }
    case 'fuel_wraith': {
      const sip = acted ? Math.sin(p * Math.PI * 6) * 2 : 0;
      ctx.globalAlpha = 0.88;
      ctx.beginPath(); ctx.moveTo(-14, 16); ctx.lineTo(-14, -6); ctx.arc(0, -6, 14, Math.PI, 0); ctx.lineTo(14, 16);
      for (let i = 0; i < 4; i++) ctx.lineTo(14 - (i + 1) * 7, 16 + (i % 2 === 0 ? 6 : 0));
      ctx.closePath(); ctx.fillStyle = '#c8d6ff'; ctx.fill(); outline(ctx);
      ctx.globalAlpha = 1;
      ctx.fillStyle = OUT; ctx.beginPath(); ctx.ellipse(-5, -6, 2.5, 4, 0, 0, Math.PI * 2); ctx.ellipse(5, -6, 2.5, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(0, 2 + sip * 0.2, 3, acted ? 4 : 2.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.roundRect(15, 4, 13, 17, 3); ctx.fillStyle = '#d9a52a'; ctx.fill(); outline(ctx);
      ctx.beginPath(); ctx.moveTo(18, 4); ctx.lineTo(18, -1); ctx.lineTo(25, -1); ctx.lineTo(25, 4); ctx.lineWidth = 3; ctx.strokeStyle = OUT; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(15, 10); ctx.quadraticCurveTo(6, 8 + sip, 2, 2); ctx.lineWidth = 3; ctx.strokeStyle = '#4a4a5c'; ctx.stroke();
      if (acted) { ctx.fillStyle = '#f2b43c'; for (let i = 0; i < 3; i++) { const q = (p * 2 + i / 3) % 1; ctx.beginPath(); ctx.arc(8 - q * 6, 4 + q * 14, 2.2 * (1 - q * 0.4), 0, Math.PI * 2); ctx.fill(); } }
      break;
    }
    case 'lost_parcel_ghoul': {
      const run = acted ? Math.min(1, p * 1.4) : 0;
      ctx.save(); ctx.translate(run * 14, 0);
      ctx.beginPath(); ctx.ellipse(0, 10, 12, 14, 0, 0, Math.PI * 2); ctx.fillStyle = '#6f9a5c'; ctx.fill(); outline(ctx);
      ctx.beginPath(); ctx.arc(0, -10, 11, 0, Math.PI * 2); ctx.fillStyle = '#86b472'; ctx.fill(); outline(ctx);
      ctx.fillStyle = '#ffe28a'; ctx.beginPath(); ctx.arc(-4, -11, 3, 0, Math.PI * 2); ctx.arc(4, -11, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = OUT; ctx.fillRect(-3, -4, 6, 3);
      ctx.beginPath(); ctx.moveTo(-9, 4); ctx.lineTo(-20, 16 + Math.sin(p * 20) * 2); ctx.moveTo(9, 4); ctx.lineTo(21, 14); ctx.lineWidth = 4; ctx.strokeStyle = '#6f9a5c'; ctx.stroke();
      ctx.beginPath(); ctx.roundRect(8 + run * 6, 8 - run * 4, 17, 15, 2); ctx.fillStyle = '#c99a5a'; ctx.fill(); outline(ctx);
      ctx.fillStyle = '#f0e0b0'; ctx.fillRect(15 + run * 6, 8 - run * 4, 3, 15);
      ctx.restore();
      if (acted) { ctx.font = '800 15px ui-monospace, monospace'; ctx.fillStyle = '#ffe08a'; ctx.textAlign = 'center'; ctx.fillText('?', -14, -26 - Math.sin(p * 10) * 2); }
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
    case 'storm': {
      ctx.strokeStyle = '#9ec0ff'; ctx.lineWidth = 2;
      for (let i = -4; i <= 4; i++) { const q = (pr.p * 3 + i * 0.37) % 1; ctx.beginPath(); ctx.moveTo(i * 11 - 4 + q * 6, -h * 0.55 + q * h * 0.9); ctx.lineTo(i * 11 - 7 + q * 6, -h * 0.55 + q * h * 0.9 + 9); ctx.stroke(); }
      if (pr.blink) { ctx.fillStyle = 'rgba(255,255,220,0.22)'; ctx.fillRect(-50, -h * 0.7, 100, h * 1.2); }
      break;
    }
    case 'pothole': {
      ctx.beginPath(); ctx.ellipse(0, 4, 24 * pop, 7, 0, 0, Math.PI * 2); ctx.fillStyle = '#0c0912'; ctx.fill(); outline(ctx);
      ctx.beginPath(); ctx.moveTo(34, 8); ctx.lineTo(40, -10); ctx.lineTo(46, 8); ctx.closePath(); ctx.fillStyle = '#ff7a1f'; ctx.fill(); outline(ctx);
      ctx.fillStyle = '#fff'; ctx.fillRect(36, -1, 8, 3);
      break;
    }
    case 'late_clock': {
      ctx.beginPath(); ctx.arc(0, -h * 0.35, 15, 0, Math.PI * 2); ctx.fillStyle = '#f4ead0'; ctx.fill(); outline(ctx);
      ctx.strokeStyle = OUT; ctx.lineWidth = 2.5;
      const a = pr.p * Math.PI * 4;
      ctx.beginPath(); ctx.moveTo(0, -h * 0.35); ctx.lineTo(Math.sin(a) * 11, -h * 0.35 - Math.cos(a) * 11); ctx.moveTo(0, -h * 0.35); ctx.lineTo(Math.sin(a / 12) * 7, -h * 0.35 - Math.cos(a / 12) * 7); ctx.stroke();
      break;
    }
    case 'empty_tank': {
      ctx.beginPath(); ctx.arc(0, -h * 0.25, 18, Math.PI, 0); ctx.closePath(); ctx.fillStyle = '#2a2446'; ctx.fill(); outline(ctx);
      ctx.fillStyle = pr.blink ? '#ff4d5e' : '#8a2a36'; ctx.font = '800 11px ui-monospace, monospace'; ctx.fillText('E', -12, -h * 0.25 - 5); ctx.fillStyle = '#9fe38a'; ctx.fillText('F', 12, -h * 0.25 - 5);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(0, -h * 0.25); const na = Math.PI + 0.25 + (1 - Math.min(1, pr.p * 2)) * 1.6; ctx.lineTo(Math.cos(na) * 15, -h * 0.25 + Math.sin(na) * 15); ctx.stroke();
      break;
    }
    case 'missing_parcel': {
      ctx.setLineDash([4, 3]); ctx.strokeStyle = '#c99a5a'; ctx.lineWidth = 3; ctx.strokeRect(-14, -h * 0.5, 28, 22); ctx.setLineDash([]);
      ctx.fillStyle = '#ffe08a'; ctx.font = '800 16px ui-monospace, monospace'; ctx.fillText('?', 0, -h * 0.5 + 12 + (pr.blink ? -2 : 0));
      break;
    }
    case 'wrong_order': sign(pr.label, pr.blink ? '#ff4d5e' : '#7a2430', '#fff', 112); break;
  }
  ctx.restore();
}
