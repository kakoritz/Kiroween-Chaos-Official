import { GROUP_LABEL, animProgress, listSprites, type AnimDef, type SpriteDef } from '../src/lab/registry';
import '../src/rig/draw';

const root = document.getElementById('lab')!;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const state = { speed: 1, silhouette: false, paused: false };

interface Card { sprite: SpriteDef; canvas: HTMLCanvasElement; anim: AnimDef; start: number; label: HTMLElement; sil: HTMLCanvasElement }
const cards: Card[] = [];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function build(): void {
  const bar = el('div', 'bar');
  bar.append(el('strong', undefined, 'Sprite lab'));
  const speed = el('select');
  for (const v of [0.25, 0.5, 1, 2]) {
    const o = el('option', undefined, `${v}x`);
    o.value = String(v);
    o.selected = v === 1;
    speed.append(o);
  }
  speed.onchange = () => { state.speed = Number(speed.value); };
  speed.setAttribute('aria-label', 'Playback speed');
  const sil = el('button', 'btn', 'Silhouette: off');
  sil.setAttribute('aria-pressed', 'false');
  sil.onclick = () => {
    state.silhouette = !state.silhouette;
    sil.textContent = `Silhouette: ${state.silhouette ? 'on' : 'off'}`;
    sil.setAttribute('aria-pressed', String(state.silhouette));
  };
  const pause = el('button', 'btn', 'Pause');
  pause.onclick = () => {
    state.paused = !state.paused;
    pause.textContent = state.paused ? 'Resume' : 'Pause';
  };
  const all = el('button', 'btn', 'Replay all');
  all.onclick = () => { for (const c of cards) c.start = performance.now(); };
  bar.append(speed, sil, pause, all);
  if (reduced) bar.append(el('span', 'note', 'Reduced motion is on: animations start paused on a still frame.'));
  root.append(bar);

  const sprites = listSprites();
  let lastGroup = '';
  let grid: HTMLElement | null = null;
  for (const sprite of sprites) {
    if (sprite.group !== lastGroup) {
      lastGroup = sprite.group;
      root.append(el('h2', undefined, GROUP_LABEL[sprite.group]));
      grid = el('div', 'grid');
      root.append(grid);
    }
    const card = el('section', 'card');
    card.dataset.sprite = sprite.id;
    const canvas = el('canvas');
    canvas.width = 320;
    canvas.height = 320;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `${sprite.name} preview`);
    const silc = el('canvas', 'sil');
    silc.width = 56;
    silc.height = 56;
    silc.title = 'Silhouette test at 56 px';
    const label = el('div', 'meta', '');
    const btns = el('div', 'btns');
    const c: Card = { sprite, canvas, anim: sprite.anims[0]!, start: performance.now(), label, sil: silc };
    for (const a of sprite.anims) {
      const b = el('button', 'btn', a.label);
      b.dataset.anim = a.id;
      b.onclick = () => { c.anim = a; c.start = performance.now(); };
      btns.append(b);
    }
    card.append(el('h3', undefined, sprite.name), canvas, silc, label, btns);
    grid!.append(card);
    cards.push(c);
  }
  if (cards.length === 0) root.append(el('p', 'note', 'No sprites registered yet.'));
}

function paint(c: Card, now: number): void {
  const elapsed = reduced || state.paused ? 0 : (now - c.start) * state.speed;
  const { p, done } = animProgress(c.anim, reduced ? c.anim.duration * 0.25 : elapsed);
  const targets: [HTMLCanvasElement, number][] = [[c.canvas, 220], [c.sil, 56]];
  for (const [cv, size] of targets) {
    const ctx = cv.getContext('2d')!;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.save();
    ctx.translate(cv.width / 2, cv.height / 2);
    c.sprite.draw(ctx, c.anim, p, { silhouette: cv === c.sil ? true : state.silhouette, size });
    ctx.restore();
  }
  c.label.textContent = `${c.anim.label} - ${c.anim.loop ? 'loop' : 'once'} ${c.anim.duration} ms${done ? ' - done' : ''}`;
}

function frame(now: number): void {
  for (const c of cards) paint(c, now);
  requestAnimationFrame(frame);
}

// Review sheet: ?sheet=<sprite id> draws every animation as a strip of still frames.
function sheet(id: string): void {
  const sprite = listSprites().find((s) => s.id === id);
  if (!sprite) { root.append(el('p', 'note', `No sprite ${id}`)); return; }
  root.append(el('h2', undefined, `${sprite.name} contact sheet`));
  const frames = 8;
  for (const anim of sprite.anims) {
    root.append(el('h3', undefined, `${anim.label} (${anim.loop ? 'loop' : 'once'})`));
    const cv = el('canvas', 'strip');
    cv.width = frames * 220;
    cv.height = 290;
    const ctx = cv.getContext('2d')!;
    for (let i = 0; i < frames; i++) {
      const p = anim.loop ? i / frames : i / (frames - 1);
      ctx.save();
      ctx.translate(i * 220 + 110, 150);
      sprite.draw(ctx, anim, p, { silhouette: false, size: 200 });
      ctx.restore();
    }
    root.append(cv);
  }
}

const sheetId = new URLSearchParams(location.search).get('sheet');
if (sheetId) sheet(sheetId);
else {
  build();
  requestAnimationFrame(frame);
}
