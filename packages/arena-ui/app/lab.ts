import { GROUP_LABEL, animProgress, listSprites, type AnimDef, type SpriteDef } from '../src/lab/registry';
import '../src/rig/draw';
import '../src/rig/tiers';
import '../src/creatures/draw';

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

// Review lineup: ?lineup=tiers draws the five tiers side by side, large, then as 56 px silhouettes.
function lineup(): void {
  const tiers = listSprites().filter((s) => s.group === 'tier');
  root.append(el('h2', undefined, 'Tier lineup'));
  for (const [anim, size, title] of [['idle', 260, 'Idle'], ['cheer', 260, 'Cheer']] as const) {
    root.append(el('h3', undefined, title));
    const cv = el('canvas', 'strip');
    cv.width = tiers.length * 360;
    cv.height = 380;
    const ctx = cv.getContext('2d')!;
    tiers.forEach((s, i) => {
      const a = s.anims.find((x) => x.id === anim)!;
      ctx.save();
      ctx.translate(i * 360 + 180, 205);
      s.draw(ctx, a, anim === 'cheer' ? 0.25 : 0.1, { silhouette: false, size });
      ctx.restore();
      ctx.fillStyle = '#f3ecff';
      ctx.font = '600 22px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(s.name, i * 360 + 180, 370);
    });
    root.append(cv);
  }
  root.append(el('h3', undefined, 'Silhouette test (56 px, then 112 px)'));
  const sc = el('canvas', 'strip');
  sc.width = tiers.length * 360;
  sc.height = 140;
  const sctx = sc.getContext('2d')!;
  tiers.forEach((s, i) => {
    for (const [dx, size] of [[110, 56], [240, 112]] as const) {
      sctx.save();
      sctx.translate(i * 360 + dx, 70);
      s.draw(sctx, s.anims[0]!, 0.1, { silhouette: true, size });
      sctx.restore();
    }
  });
  root.append(sc);
}

// Review lineup: ?lineup=creatures draws the seven creatures idle, mid action, then as 56 px silhouettes.
function creatureLineup(): void {
  const list = listSprites().filter((s) => s.id.startsWith('creature-'));
  root.append(el('h2', undefined, 'Creature lineup'));
  const W = 300;
  for (const [idx, title, p] of [[0, 'Idle', 0.25], [1, 'Acting', 0.55]] as const) {
    root.append(el('h3', undefined, title));
    const cv = el('canvas', 'strip');
    cv.width = list.length * W;
    cv.height = 380;
    const ctx = cv.getContext('2d')!;
    list.forEach((s, i) => {
      ctx.save();
      ctx.translate(i * W + W / 2, 195);
      s.draw(ctx, s.anims[idx]!, p, { silhouette: false, size: 250 });
      ctx.restore();
      ctx.fillStyle = '#f3ecff';
      ctx.font = '600 22px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${s.name}: ${s.anims[idx]!.label}`, i * W + W / 2, 370);
    });
    root.append(cv);
  }
  root.append(el('h3', undefined, 'Silhouette test (56 px, then 112 px)'));
  const sc = el('canvas', 'strip');
  sc.width = list.length * W;
  sc.height = 140;
  const sctx = sc.getContext('2d')!;
  list.forEach((s, i) => {
    for (const [dx, size] of [[80, 56], [200, 112]] as const) {
      sctx.save();
      sctx.translate(i * W + dx, 70);
      s.draw(sctx, s.anims[1]!, 0.55, { silhouette: true, size });
      sctx.restore();
    }
  });
  root.append(sc);
}const sheetId = new URLSearchParams(location.search).get('sheet');
if (new URLSearchParams(location.search).get('lineup') === 'tiers') lineup();
else if (new URLSearchParams(location.search).get('lineup') === 'creatures') creatureLineup();
else if (sheetId) sheet(sheetId);
else {
  build();
  requestAnimationFrame(frame);
}
