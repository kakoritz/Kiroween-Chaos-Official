import { ease, registerSprite, type AnimDef, type DrawOpts } from './registry';

// Lab self-test sprite. It proves the lab plays idle, cheer and one-shot animations with the
// style guide basics (4 px #14101f outline, flat fill plus one shade and one rim, big head).
// UI-ART1 replaces it with the real skeleton rig.

const OUT = '#14101f';
const BONE = '#efe6d2';
const SHADE = '#cfc3a8';
const RIM = '#fffaf0';

const anims: AnimDef[] = [
  { id: 'idle', label: 'Idle', loop: true, duration: 1800 },
  { id: 'cheer', label: 'Cheer', loop: true, duration: 700 },
  { id: 'collapse', label: 'Collapse', loop: false, duration: 900 },
];

function draw(ctx: CanvasRenderingContext2D, anim: AnimDef, p: number, o: DrawOpts): void {
  const s = o.size / 100;
  const fill = (c: string) => (o.silhouette ? OUT : c);
  let dy = 0;
  let squash = 1;
  let tilt = 0;
  if (anim.id === 'idle') squash = 1 + Math.sin(p * Math.PI * 2) * 0.03;
  if (anim.id === 'cheer') {
    const up = Math.abs(Math.sin(p * Math.PI));
    dy = -up * 14;
    squash = 1 + (1 - up) * 0.08;
  }
  if (anim.id === 'collapse') {
    const f = ease.outBounce(p);
    dy = f * 18;
    tilt = ease.inOutCubic(p) * 0.5;
    squash = 1 - f * 0.25;
  }
  ctx.save();
  ctx.scale(s, s);
  ctx.translate(0, 50 + dy);
  ctx.rotate(tilt);
  ctx.scale(1 / squash, squash);
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = OUT;
  // body
  ctx.fillStyle = fill(SHADE);
  ctx.beginPath();
  ctx.roundRect(-16, -42, 32, 40, 10);
  ctx.fill();
  ctx.stroke();
  // head: 35% of height
  ctx.fillStyle = fill(BONE);
  ctx.beginPath();
  ctx.ellipse(0, -66, 30, 28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (!o.silhouette) {
    ctx.strokeStyle = RIM;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, -66, 22, Math.PI * 1.15, Math.PI * 1.5);
    ctx.stroke();
    ctx.fillStyle = OUT;
    for (const x of [-11, 11]) {
      ctx.beginPath();
      ctx.ellipse(x, -66, 8, 9, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = BONE;
    const look = anim.id === 'collapse' ? 0 : Math.sin(p * Math.PI * 2) * 2;
    for (const x of [-11, 11]) {
      ctx.beginPath();
      ctx.arc(x + look, -65, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = OUT;
    ctx.lineWidth = 4;
    ctx.beginPath();
    if (anim.id === 'collapse') ctx.arc(0, -46, 7, Math.PI * 1.1, Math.PI * 1.9);
    else ctx.arc(0, -52, 8, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }
  ctx.restore();
}

registerSprite({ id: 'selftest-skull', name: 'Lab self-test skull', group: 'skeleton', anims, draw });
