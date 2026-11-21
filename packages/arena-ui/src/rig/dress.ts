/// <reference lib="dom" />
// Tier dressings (UI-ART2). The same skeleton rig, five looks. Each dressing is a list of
// items; every item is drawn in the local space of the part it is attached to, so it follows
// the rig through idle, walk, cheer, collapse and reassemble. No imports from draw.ts, so
// draw.ts can call dressPart without a cycle.

export const TIER_IDS = ['rookie', 'retrier', 'journaler', 'reconciler', 'phoenix'] as const;
export type Tier = (typeof TIER_IDS)[number];

export type Item =
  | 'crack' | 'bigSocket' | 'note'
  | 'belt' | 'lantern' | 'book'
  | 'brow' | 'glasses' | 'bowtie' | 'medal' | 'scarf' | 'crown' | 'grin';

export const DRESSING: Record<Tier, readonly Item[]> = {
  rookie: ['crack', 'bigSocket', 'note'],
  retrier: ['belt', 'lantern', 'brow'],
  journaler: ['belt', 'book', 'glasses'],
  reconciler: ['belt', 'book', 'glasses', 'medal', 'bowtie'],
  phoenix: ['belt', 'lantern', 'book', 'glasses', 'medal', 'scarf', 'crown', 'grin'],
};

export const TIER_LABEL: Record<Tier, string> = {
  rookie: 'Rookie',
  retrier: 'Retrier',
  journaler: 'Journaler',
  reconciler: 'Reconciler',
  phoenix: 'Phoenix',
};

/** The five gear pieces a lane can install. A tier shows the ones it owns. */
export const GEAR_ITEMS: readonly Item[] = ['lantern', 'book', 'medal', 'scarf', 'crown'];

const OUT = '#14101f';
const GOLD = '#ffc247';
const TORCH = '#ff9a3c';
const FAIL = '#ff4d5e';
const HEX = '#9b6bff';
const HEX_SHADE = '#6f45cc';
const LEATHER = '#8a5a34';
const NOTE = '#ffe27a';

type Ctx = CanvasRenderingContext2D;

function poly(ctx: Ctx, pts: [number, number][]): Path2D {
  const p = new Path2D();
  p.moveTo(pts[0]![0], pts[0]![1]);
  for (const [x, y] of pts.slice(1)) p.lineTo(x, y);
  p.closePath();
  return p;
}

function solid(ctx: Ctx, path: Path2D, fill: string, sil: boolean, shade?: string): void {
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = OUT;
  ctx.fillStyle = sil ? OUT : fill;
  ctx.fill(path);
  if (shade && !sil) {
    ctx.save();
    ctx.clip(path);
    ctx.fillStyle = shade;
    ctx.fillRect(-40, 2, 80, 80);
    ctx.restore();
  }
  ctx.stroke(path);
}

function rect(x: number, y: number, w: number, h: number, r: number): Path2D {
  const p = new Path2D();
  p.roundRect(x, y, w, h, r);
  return p;
}

function circle(x: number, y: number, r: number): Path2D {
  const p = new Path2D();
  p.arc(x, y, r, 0, Math.PI * 2);
  return p;
}

function skull(ctx: Ctx, items: readonly Item[], face: string, sil: boolean): void {
  const eyes = face !== 'happy' && face !== 'dead';
  if (items.includes('bigSocket') && eyes) {
    ctx.fillStyle = OUT;
    ctx.beginPath();
    ctx.ellipse(-8.5, -19, 8.4, 9.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#efe6d2';
    ctx.beginPath();
    ctx.arc(-7.5, -18, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  if (items.includes('crack')) {
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(4, -35.5);
    ctx.lineTo(0, -31);
    ctx.lineTo(5, -28);
    ctx.lineTo(-1, -24);
    ctx.moveTo(0, -31);
    ctx.lineTo(-5, -30);
    ctx.stroke();
  }
  if (items.includes('note')) {
    ctx.save();
    ctx.translate(11, -29);
    ctx.rotate(0.28);
    solid(ctx, rect(-6, -6, 12, 12, 1.5), NOTE, sil, '#e6c24f');
    if (!sil) {
      ctx.strokeStyle = OUT;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-3.5, -2);
      ctx.lineTo(3.5, -2);
      ctx.moveTo(-3.5, 1.5);
      ctx.lineTo(2, 1.5);
      ctx.stroke();
    }
    ctx.restore();
  }
  if (items.includes('brow') && face !== 'dead') {
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 3.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-15, -30);
    ctx.lineTo(-4, -26);
    ctx.moveTo(15, -30);
    ctx.lineTo(4, -26);
    ctx.stroke();
  }
  if (items.includes('glasses') && !sil) {
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 2.4;
    ctx.fillStyle = 'rgba(122,184,255,0.22)';
    for (const x of [-8.5, 8.5]) {
      ctx.beginPath();
      ctx.arc(x, -19, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-0.6, -20);
    ctx.lineTo(0.6, -20);
    ctx.moveTo(-17.4, -19);
    ctx.lineTo(-20, -21);
    ctx.stroke();
  }
  if (items.includes('grin') && face === 'neutral') {
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 2.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-9, -8.5);
    ctx.quadraticCurveTo(2, -5, 11, -11);
    ctx.stroke();
  }
  if (items.includes('crown')) {
    const c = poly(ctx, [[-12, -34], [-14, -49], [-7, -42], [0, -52], [7, -42], [14, -49], [12, -34]]);
    solid(ctx, c, GOLD, sil, '#d99a1f');
    if (!sil) {
      for (const [x, y, col] of [[0, -39, FAIL], [-7, -38, '#7ab8ff'], [7, -38, '#5ee08a']] as const) {
        ctx.fillStyle = col;
        ctx.strokeStyle = OUT;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(x, y, 2.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }
}

function ribcage(ctx: Ctx, items: readonly Item[], sil: boolean): void {
  if (items.includes('scarf')) {
    // Tail first so the band sits over it.
    solid(ctx, poly(ctx, [[-9, -17], [-17, -14], [-25, 2], [-19, 4], [-14, -4], [-8, -9]]), FAIL, sil, '#d83a4c');
    solid(ctx, rect(-14.5, -21, 29, 8, 3.5), TORCH, sil, '#e07a22');
    if (!sil) {
      ctx.strokeStyle = OUT;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(-7, -21);
      ctx.lineTo(-7, -14);
      ctx.moveTo(7, -21);
      ctx.lineTo(7, -14);
      ctx.stroke();
    }
  }
  if (items.includes('bowtie')) {
    ctx.save();
    ctx.translate(0, -17.5);
    ctx.scale(0.85, 0.85);
    solid(ctx, poly(ctx, [[0, 0], [-10, -5], [-10, 5]]), FAIL, sil, '#d83a4c');
    solid(ctx, poly(ctx, [[0, 0], [10, -5], [10, 5]]), FAIL, sil, '#d83a4c');
    solid(ctx, circle(0, 0, 2.6), '#d83a4c', sil);
    ctx.restore();
  }
  if (items.includes('medal')) {
    ctx.save();
    ctx.translate(0, -5);
    solid(ctx, poly(ctx, [[-4, -10], [0, -3], [-6, -3]]), '#7ab8ff', sil);
    solid(ctx, poly(ctx, [[4, -10], [0, -3], [6, -3]]), FAIL, sil);
    solid(ctx, circle(0, 3, 6.4), GOLD, sil, '#d99a1f');
    if (!sil) {
      ctx.strokeStyle = OUT;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-2.6, 3.4);
      ctx.lineTo(-0.6, 5.4);
      ctx.lineTo(3, 0.8);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function pelvis(ctx: Ctx, items: readonly Item[], sil: boolean): void {
  if (items.includes('belt')) {
    solid(ctx, rect(-12.5, -3.5, 25, 6, 2), LEATHER, sil, '#6a4224');
    if (!sil) solid(ctx, rect(-2.6, -3, 5.2, 5, 1), GOLD, false);
  }
  if (items.includes('book')) {
    ctx.save();
    ctx.translate(-12, 11);
    ctx.rotate(0.08);
    solid(ctx, rect(-6.5, -7, 13, 16, 2), HEX, sil, HEX_SHADE);
    if (!sil) {
      ctx.fillStyle = '#efe6d2';
      ctx.fillRect(4.2, -5.5, 2.4, 13);
      solid(ctx, circle(-0.5, 0.8, 2.6), GOLD, false);
    }
    ctx.restore();
  }
  if (items.includes('lantern')) {
    ctx.save();
    ctx.translate(12, 3);
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -1);
    ctx.lineTo(0, 3);
    ctx.stroke();
    if (!sil) {
      const g = ctx.createRadialGradient(0, 10, 1, 0, 10, 15);
      g.addColorStop(0, 'rgba(255,154,60,0.55)');
      g.addColorStop(1, 'rgba(255,154,60,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-16, -6, 32, 32);
    }
    solid(ctx, rect(-4.6, 3, 9.2, 4, 1), '#4a4660', sil);
    solid(ctx, rect(-4.6, 6.5, 9.2, 9, 2), TORCH, sil, '#ffc247');
    if (!sil) {
      ctx.fillStyle = '#fff3c4';
      ctx.fillRect(-1.5, 8.5, 3, 4.5);
    }
    solid(ctx, rect(-5.4, 15, 10.8, 3, 1), '#4a4660', sil);
    ctx.restore();
  }
}

/**
 * Draw the dressing items attached to one part. Call with the context already translated
 * and rotated into that part's local space. The face id selects expression-aware items.
 */
export function dressPart(ctx: Ctx, tier: Tier, partId: string, face: string, silhouette: boolean): void {
  const items = DRESSING[tier];
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (partId === 'skull') skull(ctx, items, face, silhouette);
  else if (partId === 'ribcage') ribcage(ctx, items, silhouette);
  else if (partId === 'pelvis') pelvis(ctx, items, silhouette);
  ctx.restore();
}
