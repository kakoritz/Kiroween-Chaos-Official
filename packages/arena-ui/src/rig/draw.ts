/// <reference lib="dom" />
// Canvas drawing for the skeleton rig. Style guide: 4 px #14101f outline with rounded joins,
// flat bone fill, one shade layer (bottom right), one rim highlight (top left), big head.
import { ANIMS, PARTS, frameFor, type Face, type Frame, type PartDef } from './skeleton';
import { registerSprite, type AnimDef, type DrawOpts } from '../lab/registry';
import { dressPart, type Tier } from './dress';

export const OUT = '#14101f';
export const BONE = '#efe6d2';
export const SHADE = '#cfc3a8';
export const RIM = '#fffaf0';

const cache = new Map<string, Path2D>();
const pathOf = (d: PartDef): Path2D => {
  let p = cache.get(d.id);
  if (!p) cache.set(d.id, (p = new Path2D(d.path)));
  return p;
};

function crescent(ctx: CanvasRenderingContext2D, path: Path2D, dx: number, dy: number, color: string): void {
  const p = new Path2D();
  p.addPath(path, { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy });
  const q = new Path2D();
  q.addPath(path);
  ctx.save();
  ctx.clip(q);
  ctx.fillStyle = color;
  ctx.fill(p, 'evenodd');
  ctx.restore();
}

function face(ctx: CanvasRenderingContext2D, f: Face, look: number, blink: number): void {
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (const x of [-8.5, 8.5]) {
    ctx.fillStyle = OUT;
    ctx.strokeStyle = OUT;
    if (f === 'happy') {
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(x, -17, 5, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
      continue;
    }
    if (f === 'dead') {
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x - 4, -23);
      ctx.lineTo(x + 4, -15);
      ctx.moveTo(x + 4, -23);
      ctx.lineTo(x - 4, -15);
      ctx.stroke();
      continue;
    }
    const big = f === 'surprised' ? 1.25 : 1;
    const ry = (blink ? 1.2 : 6.2) * big;
    ctx.beginPath();
    ctx.ellipse(x, -19, 5.2 * big, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    if (!blink) {
      ctx.fillStyle = BONE;
      ctx.beginPath();
      ctx.arc(x + look * 1.8, f === 'worry' ? -17.5 : -19, f === 'surprised' ? 1.6 : 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = OUT;
  ctx.beginPath();
  ctx.moveTo(0, -13);
  ctx.lineTo(-2.6, -8.5);
  ctx.lineTo(2.6, -8.5);
  ctx.closePath();
  ctx.fill();
  if (f === 'worry') {
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-14, -29);
    ctx.lineTo(-5, -26);
    ctx.moveTo(14, -29);
    ctx.lineTo(5, -26);
    ctx.stroke();
  }
}

function details(ctx: CanvasRenderingContext2D, id: PartDef['id'], fr: Frame): void {
  ctx.strokeStyle = OUT;
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  if (id === 'ribcage') {
    ctx.beginPath();
    for (const y of [-18, -12, -6]) {
      ctx.moveTo(-9, y);
      ctx.quadraticCurveTo(0, y + 3, 9, y);
    }
    ctx.moveTo(0, -23);
    ctx.lineTo(0, -1);
    ctx.stroke();
  } else if (id === 'skull') {
    face(ctx, fr.face, fr.look, fr.blink);
  } else if (id === 'jaw') {
    ctx.beginPath();
    for (const x of [-6, 0, 6]) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 4);
    }
    ctx.stroke();
  } else if (id === 'pelvis') {
    ctx.beginPath();
    ctx.moveTo(0, -3);
    ctx.lineTo(0, 5);
    ctx.stroke();
  }
}

/** Draw one frame centred on x = 0 with the feet at y = size / 2. */
export function drawSkeleton(ctx: CanvasRenderingContext2D, fr: Frame, o: DrawOpts, tier?: Tier): void {
  const s = o.size / 100;
  ctx.save();
  ctx.translate(0, o.size / 2);
  ctx.scale(s * fr.sx, s * fr.sy);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const byId = new Map(fr.parts.map((p) => [p.id, p.xf]));
  for (const d of [...PARTS].sort((a, b) => a.z - b.z)) {
    const xf = byId.get(d.id)!;
    const path = pathOf(d);
    ctx.save();
    ctx.translate(xf.x, xf.y);
    ctx.rotate(xf.rot);
    ctx.lineWidth = 4;
    ctx.strokeStyle = OUT;
    ctx.fillStyle = o.silhouette ? OUT : BONE;
    ctx.fill(path);
    if (!o.silhouette) {
      crescent(ctx, path, -3, -3, SHADE);
      crescent(ctx, path, 2.5, 2.5, RIM);
    }
    ctx.stroke(path);
    if (!o.silhouette) details(ctx, d.id, fr);
    if (tier) dressPart(ctx, tier, d.id, fr.face, o.silhouette);
    ctx.restore();
  }
  ctx.restore();
}

const anims: AnimDef[] = ANIMS.map((a) => ({ ...a }));

registerSprite({
  id: 'skeleton-rig',
  name: 'Skeleton worker',
  group: 'skeleton',
  anims,
  draw(ctx, anim, p, opts) {
    drawSkeleton(ctx, frameFor(anim.id, p), opts);
  },
});