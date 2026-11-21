/// <reference lib="dom" />
// Crypt look (UI-S1, ui-spec section 20). Pure code-generated painters: flagstone floors,
// torch light pools, cobwebs and a tileable fog texture. The static painters run once per
// lane count; the fog texture is built once and scrolled by scene.ts.

type Ctx = CanvasRenderingContext2D;

export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** Irregular flagstone floor with grout, edge highlights, cracks and moss. */
export function flagstoneFloor(ctx: Ctx, x: number, y: number, w: number, h: number, seed: number): void {
  const r = seeded(seed);
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#1c1832');
  g.addColorStop(1, '#15112a');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  const floorTop = y + h * 0.58;
  const rows = 3;
  const rh = (y + h - floorTop) / rows;
  for (let row = 0; row < rows; row++) {
    const ry = floorTop + row * rh;
    // rows get wider stones toward the viewer to hint at perspective
    const base = 62 + row * 16;
    let xx = x - r() * base;
    while (xx < x + w) {
      const sw = base * (0.7 + r() * 0.7);
      const shade = Math.floor(r() * 16);
      ctx.fillStyle = `rgba(${50 + shade},${44 + shade},${82 + shade},0.42)`;
      ctx.fillRect(xx + 1.5, ry + 1.5, sw - 3, rh - 3);
      // lit top edge, dark bottom edge
      ctx.fillStyle = 'rgba(190,175,230,0.10)';
      ctx.fillRect(xx + 1.5, ry + 1.5, sw - 3, 2);
      ctx.fillStyle = 'rgba(6,4,12,0.35)';
      ctx.fillRect(xx + 1.5, ry + rh - 4.5, sw - 3, 3);
      // speckle
      if (r() < 0.55) {
        ctx.fillStyle = 'rgba(8,6,16,0.35)';
        ctx.fillRect(xx + 6 + r() * (sw - 14), ry + 6 + r() * (rh - 14), 2 + r() * 3, 1.5);
      }
      // crack
      if (r() < 0.14) {
        ctx.strokeStyle = 'rgba(6,4,12,0.8)'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        let cx = xx + sw * (0.2 + r() * 0.6); let cy = ry + 3;
        ctx.moveTo(cx, cy);
        for (let k = 0; k < 4; k++) { cx += (r() - 0.5) * 14; cy += rh / 4; ctx.lineTo(cx, Math.min(cy, ry + rh - 2)); }
        ctx.stroke();
      }
      // moss
      if (r() < 0.12) {
        ctx.fillStyle = 'rgba(70,110,70,0.28)';
        ctx.beginPath(); ctx.ellipse(xx + sw * r(), ry + rh - 6, 6 + r() * 10, 3, 0, 0, Math.PI * 2); ctx.fill();
      }
      xx += sw;
    }
  }
  // grout lines
  ctx.strokeStyle = 'rgba(8,6,16,0.75)'; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let row = 0; row <= rows; row++) { const gy = floorTop + row * rh; ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); }
  ctx.stroke();
  // soft baseboard shadow where wall meets floor
  const sh = ctx.createLinearGradient(0, floorTop - 14, 0, floorTop + 10);
  sh.addColorStop(0, 'rgba(6,4,12,0)'); sh.addColorStop(1, 'rgba(6,4,12,0.45)');
  ctx.fillStyle = sh; ctx.fillRect(x, floorTop - 14, w, 24);
  ctx.restore();
}

/** Warm elliptical light pools on a lane floor. */
export function torchPools(ctx: Ctx, xs: number[], y: number, h: number): void {
  ctx.save();
  ctx.beginPath(); ctx.rect(0, y, 1920, h); ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  const cy = y + h * 0.8;
  for (const px of xs) {
    ctx.save();
    ctx.translate(px, cy); ctx.scale(1, 0.32);
    const g = ctx.createRadialGradient(0, 0, 4, 0, 0, 230);
    g.addColorStop(0, 'rgba(255,154,60,0.34)');
    g.addColorStop(0.45, 'rgba(255,120,40,0.13)');
    g.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = g; ctx.fillRect(-230, -230, 460, 460);
    ctx.restore();
    // faint wall wash above the pool
    const wg = ctx.createRadialGradient(px, y + h * 0.28, 2, px, y + h * 0.28, 120);
    wg.addColorStop(0, 'rgba(255,170,90,0.10)'); wg.addColorStop(1, 'rgba(255,170,90,0)');
    ctx.fillStyle = wg; ctx.fillRect(px - 120, y, 240, h);
  }
  ctx.restore();
}

/** Darken the lane toward its far edges so the pools read as the only light. */
export function laneVignette(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, 'rgba(6,4,12,0.0)'); g.addColorStop(0.85, 'rgba(6,4,12,0.0)'); g.addColorStop(1, 'rgba(6,4,12,0.4)');
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  const v = ctx.createLinearGradient(0, y, 0, y + h);
  v.addColorStop(0, 'rgba(6,4,12,0.32)'); v.addColorStop(0.3, 'rgba(6,4,12,0)'); v.addColorStop(1, 'rgba(6,4,12,0.22)');
  ctx.fillStyle = v; ctx.fillRect(x, y, w, h);
}

/** Cobweb anchored at a corner; dx/dy are +1 or -1 for the direction it spreads. Strands sag between spokes. */
export function cobweb(ctx: Ctx, x: number, y: number, dx: number, dy: number, size: number): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(239,230,210,0.34)';
  ctx.lineWidth = 1.2;
  const spokes = 5;
  const pt = (a: number, rad: number): [number, number] => [x + dx * Math.cos(a) * rad, y + dy * Math.sin(a) * rad];
  ctx.beginPath();
  for (let i = 0; i < spokes; i++) {
    const [px, py] = pt((i / (spokes - 1)) * (Math.PI / 2), size);
    ctx.moveTo(x, y); ctx.lineTo(px, py);
  }
  for (let k = 1; k <= 4; k++) {
    const rad = (size * k) / 4;
    for (let i = 0; i < spokes - 1; i++) {
      const [ax, ay] = pt((i / (spokes - 1)) * (Math.PI / 2), rad);
      const [bx, by] = pt(((i + 1) / (spokes - 1)) * (Math.PI / 2), rad);
      const [mx, my] = pt(((i + 0.5) / (spokes - 1)) * (Math.PI / 2), rad * 0.8);
      ctx.moveTo(ax, ay); ctx.quadraticCurveTo(mx, my, bx, by);
    }
  }
  ctx.stroke();
  // a dangling strand with a tiny spider
  ctx.strokeStyle = 'rgba(239,230,210,0.22)';
  ctx.beginPath(); ctx.moveTo(x + dx * size * 0.55, y + dy * size * 0.2); ctx.lineTo(x + dx * size * 0.55, y + dy * (size * 0.2 + size * 0.55)); ctx.stroke();
  ctx.fillStyle = 'rgba(10,8,18,0.8)';
  ctx.beginPath(); ctx.arc(x + dx * size * 0.55, y + dy * (size * 0.2 + size * 0.55), 2.2, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/** Tileable (horizontally) fog texture, built once. Alpha is low; scene.ts scrolls and layers it. */
export function fogTexture(w: number, h: number, seed: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d')!;
  const r = seeded(seed);
  for (let i = 0; i < 26; i++) {
    const bx = r() * w; const by = h * (0.35 + r() * 0.65);
    const rad = 90 + r() * 170; const a = 0.05 + r() * 0.06;
    for (const ox of [-w, 0, w]) {
      const g = ctx.createRadialGradient(bx + ox, by, 4, bx + ox, by, rad);
      g.addColorStop(0, `rgba(150,128,206,${a})`); g.addColorStop(1, 'rgba(150,128,206,0)');
      ctx.save(); ctx.translate(0, by); ctx.scale(1, 0.55); ctx.translate(0, -by);
      ctx.fillStyle = g; ctx.fillRect(bx + ox - rad, by - rad, rad * 2, rad * 2);
      ctx.restore();
    }
  }
  return cv;
}
