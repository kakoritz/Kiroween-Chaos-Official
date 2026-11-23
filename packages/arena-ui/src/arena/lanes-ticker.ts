// Lane ticker (playtest-v2 ui.md section 4): one row per lane, one current message each. A new message
// slides up and pushes the old one out. Minimum display 1.8 s; up to 3 queued messages, fast-forwarded
// (600 ms each) when more are waiting. Model is pure (no DOM, no clock); LaneTickerView draws it.
import type { ArenaEvent } from '../api/types';
import { isIssue } from './chips';
import { chaosPhrase } from './creatures';
import { displayId, vocabOf, type AppVocab } from './vocab';

export type MsgTone = 'info' | 'good' | 'warn' | 'error';
export interface LaneMsg { tone: MsgTone; icon: string; text: string }

export const MIN_SHOW_MS = 1800;
export const FAST_SHOW_MS = 600;
export const SLIDE_MS = 250;
export const MAX_QUEUE = 3;

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const stars = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Message for one event, or null for events that stay quiet. Lane-less events are handled by the model. */
export function laneMessage(ev: ArenaEvent, stageLabel: (id: string) => string, app = 'orders'): LaneMsg | null {
  const v: AppVocab = vocabOf(app);
  const d = (ev.detail ?? {}) as Record<string, unknown>;
  const stage = ev.stage ? stageLabel(ev.stage) : '';
  const order = displayId(app, str(ev.order));
  switch (ev.type) {
    case 'order_start': return { tone: 'info', icon: '\u25B7', text: `${v.start} ${v.unit} ${order}`.trim() };
    case 'stage_done': {
      if (d.skipped === true) return null;
      const tries = num(d.attempts, num(d.attempt, 1));
      const retries = num(d.retries, Math.max(0, tries - 1));
      if (retries <= 0 || !stage) return null;
      return { tone: 'good', icon: '\u2713', text: `passed ${stage} after ${retries} ${retries === 1 ? 'retry' : 'retries'}` };
    }
    case 'order_done': return { tone: 'good', icon: '\u2713', text: `${v.unit} ${order} ${v.done}`.replace('  ', ' ') };
    case 'order_failed': return { tone: 'error', icon: '\u2717', text: v.cancelled };
    case 'order_parked': return { tone: 'warn', icon: '\u29D6', text: `${v.unit} parked` };
    case 'order_quarantined': return { tone: 'error', icon: '\u2620', text: `${v.unit} quarantined` };
    case 'stage_fail': return { tone: 'error', icon: '\u2717', text: `${stage || 'stage'} failed${str(d.error) ? ` (${str(d.error)})` : ''}` };
    case 'chaos': return { tone: d.source === 'gremlin' ? 'warn' : 'error', icon: d.unknown === true ? '?' : d.source === 'gremlin' ? '\u26A0' : '\u2620', text: chaosPhrase(d, stage) };
    case 'outage': return { tone: 'warn', icon: '\u23F3', text: `outage ${Math.round(num(d.outageMs) / 100) / 10} s${stage ? ` at ${stage}` : ''}` };
    case 'chaos_absorbed': return { tone: 'good', icon: '\u26E8', text: 'chaos absorbed' };
    case 'process_dead': return { tone: 'error', icon: '\u2620', text: 'process died' };
    case 'process_up': return { tone: 'warn', icon: '\u21BB', text: 'process restarted' };
    case 'recover_start': return { tone: 'warn', icon: '\u21BB', text: `recovering${str(d.action) ? ` (${str(d.action)})` : ''}` };
    case 'repeat': return { tone: 'error', icon: '\u21BB', text: 'repeated side effect' };
    case 'lane_halted': return { tone: 'error', icon: '\u25A0', text: 'halted' };
    case 'review': {
      const s = num(d.stars, NaN);
      if (!Number.isFinite(s)) return null;
      const t = str(d.text);
      return { tone: s >= 4 ? 'good' : s >= 3 ? 'warn' : 'error', icon: '\u2605', text: `\u2605 ${stars(s)}${t ? ` "${t}"` : ''}` };
    }
    case 'decision_needed': {
      const at = str(d.detectedAt);
      return { tone: 'warn', icon: '\u26A0', text: `WRONG ${v.unit.toUpperCase()}${at ? ` at ${at.charAt(0).toUpperCase()}${at.slice(1)}` : ''}: choose` };
    }
    case 'score': {
      if (str(d.reason) !== 'downtime') return null;
      const delta = num(d.delta);
      return { tone: 'warn', icon: '\u23F1', text: `downtime ${delta < 0 ? '-' : '+'}${Math.abs(delta)}` };
    }
    default: return null;
  }
}

/** Boss messages have no lane, so every lane row shows them. */
export function bossMessage(ev: ArenaEvent): LaneMsg | null {
  switch (ev.type) {
    case 'boss_warning': return { tone: 'warn', icon: '\u26A0', text: 'Boss incoming' };
    case 'boss_start': return { tone: 'error', icon: '\u2694', text: 'Boss attack' };
    case 'boss_end': return { tone: 'good', icon: '\u2713', text: 'Boss over' };
    default: return null;
  }
}

export interface LaneRowState {
  cur: LaneMsg | null;
  shownAt: number;
  queue: LaneMsg[];
  /** Bumps on every message change, so the view knows when to animate. */
  gen: number;
  issues: number;
}

const newRow = (): LaneRowState => ({ cur: null, shownAt: 0, queue: [], gen: 0, issues: 0 });

export class LaneTickerModel {
  readonly rows = new Map<number, LaneRowState>();
  constructor(private readonly stageLabel: (id: string) => string, private readonly app: () => string = () => 'orders') {}

  row(lane: number): LaneRowState {
    let r = this.rows.get(lane);
    if (!r) { r = newRow(); this.rows.set(lane, r); }
    return r;
  }

  reset(): void { this.rows.clear(); }

  /** Feed one event at time `now` (ms). */
  push(ev: ArenaEvent, now: number): void {
    if (ev.type === 'reset') { this.reset(); return; }
    const boss = bossMessage(ev);
    if (boss) { for (const [lane] of this.rows) this.enqueue(lane, boss, now); return; }
    if (typeof ev.lane !== 'number') return;
    const r = this.row(ev.lane);
    if (ev.type === 'order_start') r.issues = 0;
    if (isIssue(ev)) r.issues++;
    const m = laneMessage(ev, this.stageLabel, this.app());
    if (m) this.enqueue(ev.lane, m, now);
  }

  private enqueue(lane: number, m: LaneMsg, now: number): void {
    const r = this.row(lane);
    if (!r.cur) { r.cur = m; r.shownAt = now; r.gen++; return; }
    r.queue.push(m);
    if (r.queue.length > MAX_QUEUE) r.queue.shift();
  }

  /** Advance every lane whose current message has been shown long enough. Returns true if anything moved. */
  step(now: number): boolean {
    let moved = false;
    for (const r of this.rows.values()) {
      if (!r.queue.length) continue;
      const need = r.queue.length > 1 ? FAST_SHOW_MS : MIN_SHOW_MS;
      if (now - r.shownAt < need) continue;
      r.cur = r.queue.shift()!;
      r.shownAt = now;
      r.gen++;
      moved = true;
    }
    return moved;
  }
}

export interface LaneTickerHost {
  tier: (lane: number) => string;
  open: (lane: number) => void;
}

/** DOM view: one button per lane. Rows are keyboard focusable, and Enter or click opens the lane popup. */
export class LaneTickerView {
  private els = new Map<number, { row: HTMLButtonElement; view: HTMLElement; badge: HTMLElement; gen: number; out: { el: HTMLElement; at: number } | null; issues: number; tier: string }>();
  constructor(private readonly el: HTMLElement, private readonly model: LaneTickerModel, private readonly host: LaneTickerHost) {}

  /** Make sure every lane in `lanes` has a row. */
  ensure(lanes: readonly number[]): void {
    if (lanes.length === this.els.size && lanes.every((l) => this.els.has(l))) return;
    this.el.textContent = '';
    this.els.clear();
    for (const lane of lanes) {
      this.model.row(lane);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'lt-row';
      row.dataset.lane = String(lane);
      row.addEventListener('click', () => this.host.open(lane));
      const dot = document.createElement('span'); dot.className = `lt-dot lt-dot-${lane}`; dot.textContent = String(lane);
      const name = document.createElement('span'); name.className = 'lt-name';
      const view = document.createElement('span'); view.className = 'lt-view';
      const badge = document.createElement('span'); badge.className = 'lt-badge hidden';
      row.append(dot, name, view, badge);
      this.el.append(row);
      this.els.set(lane, { row, view, badge, gen: -1, out: null, issues: -1, tier: '' });
    }
  }

  render(now: number): void {
    this.model.step(now);
    for (const [lane, e] of this.els) {
      const r = this.model.row(lane);
      const tier = this.host.tier(lane);
      if (tier !== e.tier) {
        e.tier = tier;
        (e.row.querySelector('.lt-name') as HTMLElement).textContent = tier;
        e.row.setAttribute('aria-label', `Lane ${lane} ${tier}: open lane details`);
      }
      if (e.out && now - e.out.at >= SLIDE_MS) { e.out.el.remove(); e.out = null; }
      if (e.gen !== r.gen) {
        const fresh = e.gen !== -1;
        e.gen = r.gen;
        const prev = e.view.querySelector('.lt-msg:not(.lt-out)') as HTMLElement | null;
        if (prev) { prev.classList.add('lt-out'); e.out?.el.remove(); e.out = { el: prev, at: now }; }
        if (r.cur) {
          const m = document.createElement('span');
          m.className = `lt-msg lt-${r.cur.tone}${fresh && prev ? ' lt-in' : ''}`;
          const i = document.createElement('span'); i.className = 'lt-i'; i.textContent = r.cur.icon;
          const t = document.createElement('span'); t.className = 'lt-t'; t.textContent = r.cur.text;
          m.append(i, t);
          e.view.append(m);
        }
      }
      if (e.issues !== r.issues) {
        e.issues = r.issues;
        e.badge.classList.toggle('hidden', r.issues <= 0);
        e.badge.textContent = `\u2691 ${r.issues}`;
        e.badge.title = `${r.issues} ${r.issues === 1 ? 'issue' : 'issues'} on this order`;
      }
    }
  }
}
