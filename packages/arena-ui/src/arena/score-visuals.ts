// PT-U8: score visuals (ui.md section 8). Pure model plus a small DOM overlay: downtime chip, cancel slam,
// boss recovered banner, and the score explainer popover. Cosmetic only; the authoritative score is `score.total`.

export const DOWNTIME_RATE_PER_S = 10;
export const SLAM_MS = 1200;
export const BANNER_MS = 3200;
export const EXPLAINER_ROWS = 8;

export interface ScoreRow { reason: string; delta: number }

export interface ScoreEv { type: string; lane?: unknown; detail?: unknown }

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/** Rolling cosmetic downtime count shown on the chip (negative number). */
export function downtimeCount(openMs: number): number { return -Math.floor((Math.max(0, openMs) / 1000) * DOWNTIME_RATE_PER_S) || 0; }

export function fmtDelta(n: number): string { return n > 0 ? `+${n}` : n < 0 ? `\u2212${Math.abs(n)}` : '0'; }

/** Keeps the last N score events per lane, newest first. Events with a zero delta are dropped. */
export class ScoreLog {
  private readonly rows = new Map<number, ScoreRow[]>();
  constructor(private readonly cap = EXPLAINER_ROWS) {}
  add(lane: number, row: ScoreRow): void {
    if (!row.delta) return;
    const list = this.rows.get(lane) ?? [];
    list.unshift(row);
    if (list.length > this.cap) list.length = this.cap;
    this.rows.set(lane, list);
  }
  last(lane: number): ScoreRow[] { return [...(this.rows.get(lane) ?? [])]; }
  clear(): void { this.rows.clear(); }
}

/** Explainer popover lines: reason and delta, summed per reason is NOT done; the spec asks for the last 8 events. */
export function explainLines(rows: readonly ScoreRow[]): string[] {
  return rows.map((r) => `${r.reason || 'score'} ${fmtDelta(r.delta)}`);
}

export type VisualKind = 'slam' | 'banner' | 'refund' | 'none';

/** Classifies an event into the visual it triggers. */
export function visualFor(ev: ScoreEv): { kind: VisualKind; delta: number } {
  const d = obj(ev.detail);
  if (ev.type === 'score') {
    const reason = typeof d.reason === 'string' ? d.reason : '';
    const delta = num(d.delta);
    if (reason === 'order cancelled') return { kind: 'slam', delta };
    if (reason === 'boss recovered') return { kind: 'banner', delta };
    if (reason === 'boss downtime refund') return { kind: 'refund', delta };
  }
  return { kind: 'none', delta: 0 };
}

interface LaneState { openAt: number | null; chip: HTMLElement | null }

export class ScoreVisuals {
  private readonly lanes = new Map<number, LaneState>();
  private readonly log = new ScoreLog();
  private readonly banners = new Map<number, { el: HTMLElement; sub: HTMLElement; timer: ReturnType<typeof setTimeout> }>();
  private readonly hits = new Map<number, HTMLElement>();
  private pop: HTMLElement | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly place: (lane: number) => { top: number; h: number } | null,
    private readonly reduced: () => boolean = () => (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches),
    private readonly clock: () => number = () => performance.now(),
    private readonly announce: (msg: string) => void = () => undefined,
  ) {}

  private st(lane: number): LaneState {
    let s = this.lanes.get(lane);
    if (!s) { s = { openAt: null, chip: null }; this.lanes.set(lane, s); }
    return s;
  }

  onEvent(ev: ScoreEv): void {
    if (typeof ev.lane !== 'number') {
      if (ev.type === 'wave_start') this.reset();
      return;
    }
    const lane = ev.lane;
    const d = obj(ev.detail);
    switch (ev.type) {
      case 'recover_start': this.openDowntime(lane); break;
      case 'process_dead': this.openDowntime(lane); break;
      case 'order_done': case 'order_failed': case 'order_parked': case 'order_quarantined': this.closeDowntime(lane); break;
      case 'score': {
        const reason = typeof d.reason === 'string' ? d.reason : '';
        const delta = num(d.delta);
        this.log.add(lane, { reason, delta });
        if (reason === 'downtime') { this.closeDowntime(lane); this.floatOff(lane, delta); }
        const v = visualFor(ev);
        if (v.kind === 'slam') this.slam(lane, v.delta);
        else if (v.kind === 'banner') this.banner(lane, v.delta, null);
        else if (v.kind === 'refund') this.banner(lane, null, Math.abs(v.delta));
        break;
      }
      default: break;
    }
    this.layoutHits();
  }

  reset(): void {
    for (const l of [...this.lanes.keys()]) this.closeDowntime(l);
    this.log.clear();
    this.lanes.clear();
  }

  private openDowntime(lane: number): void {
    const s = this.st(lane);
    if (s.openAt !== null) return;
    s.openAt = this.clock();
    const box = this.place(lane);
    const chip = document.createElement('div');
    chip.className = 'sv-chip';
    chip.setAttribute('role', 'status');
    chip.style.top = `${(box ? box.top : 80) + 6}px`;
    chip.textContent = `DOWNTIME ${downtimeCount(0)}`;
    this.host.append(chip);
    s.chip = chip;
    if (!this.timer) this.timer = setInterval(() => this.tick(), 250);
  }

  private closeDowntime(lane: number): void {
    const s = this.lanes.get(lane);
    if (!s || s.openAt === null) return;
    s.openAt = null;
    s.chip?.remove();
    s.chip = null;
    if (![...this.lanes.values()].some((x) => x.openAt !== null) && this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private tick(): void {
    const now = this.clock();
    for (const s of this.lanes.values()) if (s.openAt !== null && s.chip) s.chip.textContent = `DOWNTIME ${downtimeCount(now - s.openAt)}`;
  }

  private floatOff(lane: number, delta: number): void {
    if (!delta) return;
    const box = this.place(lane);
    const el = document.createElement('div');
    el.className = 'sv-float';
    el.style.top = `${(box ? box.top : 80) + 30}px`;
    el.textContent = fmtDelta(delta);
    this.host.append(el);
    setTimeout(() => el.remove(), 1400);
  }

  private slam(lane: number, delta: number): void {
    const box = this.place(lane);
    const el = document.createElement('div');
    el.className = `sv-slam${this.reduced() ? ' sv-still' : ''}`;
    el.setAttribute('role', 'status');
    el.style.top = `${(box ? box.top + box.h / 2 : 160) - 40}px`;
    el.textContent = fmtDelta(delta || -300);
    this.host.append(el);
    this.announce(`Lane ${lane} order cancelled ${fmtDelta(delta)}`);
    setTimeout(() => el.remove(), SLAM_MS);
  }

  private banner(lane: number, bonus: number | null, refund: number | null): void {
    let b = this.banners.get(lane);
    if (!b) {
      const box = this.place(lane);
      const el = document.createElement('div');
      el.className = 'sv-banner';
      el.setAttribute('role', 'status');
      el.style.top = `${(box ? box.top + box.h / 2 : 160) - 36}px`;
      const head = document.createElement('b');
      head.className = 'sv-banner-head';
      head.textContent = 'RECOVERED';
      const sub = document.createElement('span');
      sub.className = 'sv-banner-sub';
      el.append(head, sub);
      if (!this.reduced()) for (let i = 0; i < 14; i++) { const c = document.createElement('i'); c.className = 'sv-conf'; c.style.left = `${6 + i * 7}%`; c.style.animationDelay = `${(i % 5) * 90}ms`; el.append(c); }
      this.host.append(el);
      const timer = setTimeout(() => { el.remove(); this.banners.delete(lane); }, BANNER_MS);
      b = { el, sub, timer };
      this.banners.set(lane, b);
      this.announce(`Lane ${lane} boss recovered`);
    }
    const head = b.el.querySelector('.sv-banner-head');
    if (bonus !== null && head) head.textContent = `RECOVERED ${fmtDelta(bonus)}`;
    if (refund !== null) b.sub.textContent = `+${refund} downtime refunded`;
  }

  /** Invisible hover targets over each lane score; the popover lists the last 8 score events. */
  private layoutHits(): void {
    for (const lane of this.lanes.keys()) this.hit(lane);
  }

  private hit(lane: number): void {
    const box = this.place(lane);
    if (!box) return;
    let el = this.hits.get(lane);
    if (!el) {
      el = document.createElement('div');
      el.className = 'sv-hit';
      el.setAttribute('tabindex', '0');
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `Lane ${lane} score breakdown`);
      el.addEventListener('mouseenter', () => this.openPop(lane));
      el.addEventListener('focus', () => this.openPop(lane));
      el.addEventListener('mouseleave', () => this.closePop());
      el.addEventListener('blur', () => this.closePop());
      this.host.append(el);
      this.hits.set(lane, el);
    }
    el.style.top = `${box.top + box.h - 46}px`;
  }

  /** Ensure targets exist for lanes that have never emitted an event (called per frame is not needed; call after lanes appear). */
  ensure(lanes: readonly number[]): void { for (const l of lanes) { this.st(l); this.hit(l); } }

  openPop(lane: number): void {
    this.closePop();
    const box = this.place(lane);
    const lines = explainLines(this.log.last(lane));
    const el = document.createElement('div');
    el.className = 'sv-pop';
    el.setAttribute('role', 'tooltip');
    el.style.top = `${(box ? box.top + box.h : 200) - 40 - Math.max(1, lines.length) * 20 - 30}px`;
    const h = document.createElement('b');
    h.textContent = `Lane ${lane} score`;
    el.append(h);
    if (!lines.length) { const p = document.createElement('div'); p.textContent = 'No score events yet'; el.append(p); }
    for (const t of lines) { const p = document.createElement('div'); p.textContent = t; el.append(p); }
    this.host.append(el);
    this.pop = el;
  }

  closePop(): void { this.pop?.remove(); this.pop = null; }
}
