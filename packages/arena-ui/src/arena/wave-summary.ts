// PT-U6: wave end card v2 (ui.md section 6). One card per lane: rating title, avg stars, best / slowest / average lap,
// totals, outcomes, issues-by-step heat row, and the star progression chart. Opens on `wave_end` (not for stopped waves).
import './laps.css';
import type { ArenaEvent } from '../api';
import { renderHeatRow, renderStarChart } from './laps-view';
import { laneCards, ordersWord, secText, starNum, starSeriesFromEvents, starSeriesOf, type LaneCard, type StarPoint } from './laps-model';

export interface WaveSummaryHost {
  stageIds(): string[];
  stageLabel(id: string): string;
  laneTitle(lane: number): string;
  fetchStars(n: number): Promise<unknown>;
  nextWave(): void;
  playDemo(): void;
  reportUrl(n: number): string;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class WaveSummary {
  private buf: ArenaEvent[] = [];
  private root: HTMLElement | null = null;
  private returnFocus: HTMLElement | null = null;
  private suppressed = false;
  private token = 0;

  constructor(private readonly stage: HTMLElement, private readonly host: WaveSummaryHost) {}

  get isOpen(): boolean { return this.root !== null; }

  /** The next wave_end is shown by someone else (campaign results). */
  suppressNext(): void { this.suppressed = true; }

  onEvent(ev: ArenaEvent): void {
    if (ev.type === 'reset' || ev.type === 'wave_start') { this.buf = []; this.close(); return; }
    if (ev.type === 'review') { this.buf.push(ev); return; }
    if (ev.type !== 'wave_end') return;
    const d = (ev.detail ?? {}) as Record<string, any>;
    const skip = this.suppressed;
    this.suppressed = false;
    if (skip || d.stopped || !d.summary || Object.keys(d.summary).length === 0) return;
    void this.open(typeof ev.wave === 'number' ? ev.wave : 0, d.summary);
  }

  private async open(n: number, summary: unknown): Promise<void> {
    const my = ++this.token;
    const series = new Map<number, StarPoint[]>();
    for (const k of Object.keys(summary as object)) {
      const lane = Number(k);
      if (Number.isFinite(lane)) series.set(lane, starSeriesFromEvents(this.buf, lane));
    }
    try {
      const raw = (await this.host.fetchStars(n)) as { lanes?: { lane?: number; series?: unknown }[] } | null;
      for (const l of raw?.lanes ?? []) {
        const s = starSeriesOf(l.series);
        if (typeof l.lane === 'number' && s.length > 0) series.set(l.lane, s);
      }
    } catch { /* the event derived series stays */ }
    if (my !== this.token) return;
    const cards = laneCards(summary, this.host.stageIds(), series, (l) => this.host.laneTitle(l));
    if (cards.length === 0) return;
    this.paint(n, cards);
  }

  close(): void {
    this.token++;
    this.root?.remove();
    this.root = null;
    this.returnFocus?.focus?.();
    this.returnFocus = null;
  }

  private paint(n: number, cards: LaneCard[]): void {
    this.root?.remove();
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dim = el('div', 'ws-dim');
    const dlg = el('section', 'ws');
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-labelledby', 'ws-title');
    const head = el('div', 'ws-head');
    const h = el('h2', '', `Wave ${n} is over`); h.id = 'ws-title';
    head.append(h, el('span', 'ws-sub', 'How each lane served its customers'));
    const lanes = el('div', 'ws-lanes');
    for (const c of cards) lanes.append(this.card(c));
    const foot = el('div', 'ws-foot');
    const rep = el('a', 'btn btn--ghost', 'View report'); rep.id = 'report-btn'; rep.href = this.host.reportUrl(n); rep.target = '_blank'; rep.rel = 'noopener';
    const next = el('button', 'btn', 'Next wave'); next.type = 'button';
    const demo = el('button', 'btn btn--ghost', 'Play demo again'); demo.type = 'button';
    const close = el('button', 'btn btn--ghost', 'Close'); close.type = 'button';
    next.addEventListener('click', () => { this.close(); this.host.nextWave(); });
    demo.addEventListener('click', () => { this.close(); this.host.playDemo(); });
    close.addEventListener('click', () => this.close());
    foot.append(rep, close, demo, next);
    dlg.append(head, lanes, foot);
    dim.append(dlg);
    dim.addEventListener('mousedown', (e) => { if (e.target === dim) this.close(); });
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); this.close(); return; }
      if (e.key !== 'Tab') return;
      const f = Array.from(dlg.querySelectorAll<HTMLElement>('a[href], button'));
      if (f.length === 0) return;
      const first = f[0]!; const last = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    this.stage.append(dim);
    this.root = dim;
    next.focus();
  }

  private card(c: LaneCard): HTMLElement {
    const box = el('article', 'ws-card');
    box.setAttribute('aria-label', `${c.title}: ${c.rating || 'no rating'}`);
    box.append(el('h3', '', `Lane ${c.lane}: ${c.title}`));
    box.append(el('div', `ws-rating ws-rating--${c.tone}`, c.rating || 'No reviews'));
    box.append(el('div', 'ws-avg', c.avgStars === null ? 'No stars yet' : `\u2605 ${starNum(c.avgStars)} avg${c.stars ? ` (${c.stars})` : ''}`));
    const kv = el('dl', 'ws-kv');
    const add = (k: string, v: string, bad = false) => { kv.append(el('dt', '', k), el('dd', bad ? 'bad' : '', v)); };
    add('Best lap', secText(c.bestMs));
    add('Slowest lap', secText(c.slowestMs));
    add('Average lap', secText(c.avgMs));
    add('Total time', secText(c.totalMs));
    add('Retries', String(c.retries));
    add('Downtime', c.downtimeMs > 0 ? secText(c.downtimeMs) : '\u2013', c.downtimeMs > 0);
    add('Orders', ordersWord(c.orders));
    if (c.score !== null) add('Score', String(c.score), c.score < 0);
    box.append(kv);
    box.append(el('div', 'ws-sec', 'Issues by step'), renderHeatRow(c.issues, this.host.stageLabel));
    box.append(el('div', 'ws-sec', 'Stars over the wave'), renderStarChart(c.series, `Lane ${c.lane} star progression`));
    return box;
  }
}
