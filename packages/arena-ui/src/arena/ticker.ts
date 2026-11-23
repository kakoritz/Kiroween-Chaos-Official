// Event ticker (ui-spec section 3, bottom right): newest event on top, icon plus text so colour is
// never the only signal. Pure formatting is exported for tests; the DOM class only appends rows.
import type { ArenaEvent } from '../api/types';
import { chaosPhrase } from './creatures';
import { displayId, vocabOf } from './vocab';

export type Tone = 'ok' | 'bad' | 'warn' | 'info' | 'boss';
export interface TickerLine { tone: Tone; icon: string; text: string }

const MAX_ROWS = 7;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** One short line per notable event, or null for events that are too chatty (progress, effects, scores). */
export function tickerLine(ev: ArenaEvent, stageLabel: (id: string) => string, app = 'orders'): TickerLine | null {
  const unit = vocabOf(app).unit;
  const order = displayId(app, str(ev.order));
  const lane = ev.lane ? `L${ev.lane} ` : '';
  const stage = ev.stage ? stageLabel(ev.stage) : '';
  const d = (ev.detail ?? {}) as Record<string, unknown>;
  switch (ev.type) {
    case 'wave_start': return { tone: 'info', icon: '\u25B6', text: `Wave ${typeof ev.wave === 'number' ? ev.wave : ''} started` };
    case 'wave_end': return { tone: 'info', icon: '\u25A0', text: 'Wave ended' };
    case 'order_start': return { tone: 'info', icon: '\u25B7', text: `${lane}${unit} ${order} started`.replace('  ', ' ') };
    case 'stage_done': return { tone: 'ok', icon: '\u2713', text: `${lane}${stage || 'stage'} done` };
    case 'order_done': return { tone: 'ok', icon: '\u2713', text: `${lane}${unit} ${order} done`.replace('  ', ' ') };
    case 'order_failed': return { tone: 'bad', icon: '\u2717', text: `${lane}${unit} ${order} failed`.replace('  ', ' ') };
    case 'order_parked': return { tone: 'warn', icon: '\u29D6', text: `${lane}${unit} parked` };
    case 'order_quarantined': return { tone: 'boss', icon: '\u2620', text: `${lane}${unit} quarantined` };
    case 'stage_fail': return { tone: 'bad', icon: '\u2717', text: `${lane}${stage || 'stage'} failed` };
    case 'chaos': return { tone: 'bad', icon: d.unknown === true ? '?' : '\u2620', text: `${lane}${chaosPhrase(d, stage)}` };
    case 'chaos_absorbed': return { tone: 'ok', icon: '\u26E8', text: `${lane}chaos absorbed` };
    case 'process_dead': return { tone: 'bad', icon: '\u2620', text: `${lane}process died` };
    case 'process_up': return { tone: 'warn', icon: '\u21BB', text: `${lane}process restarted` };
    case 'recover_start': return { tone: 'warn', icon: '\u21BB', text: `${lane}recovering${str(d.action) ? ` (${str(d.action)})` : ''}` };
    case 'repeat': return { tone: 'bad', icon: '\u21BB', text: `${lane}repeated side effect` };
    case 'lane_halted': return { tone: 'bad', icon: '\u25A0', text: `${lane}halted` };
    case 'boss_warning': return { tone: 'boss', icon: '\u26A0', text: 'Boss incoming' };
    case 'boss_start': return { tone: 'boss', icon: '\u2694', text: 'Boss attack' };
    case 'boss_end': return { tone: 'ok', icon: '\u2713', text: 'Boss over' };
    default: return null;
  }
}

export class EventTicker {
  private rows: TickerLine[] = [];
  private dirty = true;
  private seen = 0;
  constructor(private readonly el: HTMLElement, private readonly stageLabel: (id: string) => string, private readonly app: () => string = () => 'orders') {}

  push(ev: ArenaEvent): void {
    if (ev.type === 'reset') { this.rows = []; this.seen = 0; this.dirty = true; return; }
    this.seen++;
    if (this.seen === 2) this.dirty = true;
    const line = tickerLine(ev, this.stageLabel, this.app());
    if (!line) return;
    this.rows.unshift(line);
    if (this.rows.length > MAX_ROWS) this.rows.length = MAX_ROWS;
    this.dirty = true;
  }

  render(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.el.textContent = '';
    if (!this.rows.length) { const p = document.createElement('p'); p.className = 'tk-empty'; p.textContent = this.seen > 1 ? 'Quiet so far, nothing notable yet' : 'Waiting for events'; this.el.append(p); return; }
    for (const r of this.rows) {
      const row = document.createElement('div');
      row.className = `tk-row tk-${r.tone}`;
      const i = document.createElement('span'); i.className = 'tk-i'; i.textContent = r.icon;
      const t = document.createElement('span'); t.textContent = r.text;
      row.append(i, t);
      this.el.append(row);
    }
  }
}
