// Stage inspector (UI-C1, requirements A2). Pure helpers (hit test, line formatting, replay
// timing, summary) plus a small DOM popup. Lines come from contract events filtered by lane,
// stage and order; the popup streams while the stage is active, offers a Chaos button then, and
// replays a finished stage as a short animation.
import type { ArenaEvent } from '../api/types';
import { stationX, type ChipState } from './model';
import { laneBoxes } from './scene';

export type Level = 'info' | 'warn' | 'error' | 'good';
export interface InspLine { seq: number; level: Level; icon: string; text: string }

const CHIP_W = 150;
const CHIP_H = 40;

/** Which stage chip sits under a point in design pixels, as zero-based lane and stage indexes. */
export function chipAt(x: number, y: number, laneCount: number, stageCount: number): { lane: number; stage: number } | null {
  const boxes = laneBoxes(laneCount);
  for (let l = 0; l < boxes.length; l++) {
    const top = boxes[l]!.top + 4;
    if (y < top || y > top + CHIP_H) continue;
    for (let s = 0; s < stageCount; s++) {
      if (Math.abs(x - stationX(s, stageCount)) <= CHIP_W / 2) return { lane: l, stage: s };
    }
  }
  return null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** One game-style line for an event, or null when it is not about a stage. */
export function inspLine(ev: ArenaEvent): InspLine | null {
  const d = (ev.detail ?? {}) as Record<string, unknown>;
  const mk = (level: Level, icon: string, text: string): InspLine => ({ seq: ev.seq, level, icon, text });
  switch (ev.type) {
    case 'stage_start': return mk('info', '\u25B6', `Started, attempt ${num(d.attempt) ?? 1}`);
    case 'stage_progress': return mk('info', '\u2026', `${num(d.pct) ?? 0}% ${str(d.label)}`.trim());
    case 'stage_done': return d.skipped ? mk('good', '\u21BA', 'Skipped, replayed from the journal') : mk('good', '\u2713', `Done in ${num(d.ms) ?? 0} ms`);
    case 'stage_fail': return mk('error', '\u2717', `Failed: ${str(d.error) || 'error'}${d.retryable ? ' (retryable)' : ''}`);
    case 'chaos': return mk('warn', '\u2620', `Chaos hit: ${str(d.creature) || 'creature'} ${str(d.fault)}`.trim());
    case 'chaos_absorbed': return mk('good', '\u26E8', 'Chaos absorbed');
    case 'effect': return mk('info', '\u270E', `Effect ${str(d.kind)} ${str(d.key)}${d.replayed ? ' (replayed)' : ''}`.trim());
    case 'repeat': return mk('error', '\u21BB', `Repeated side effect ${str(d.kind)} ${str(d.key)}`.trim());
    case 'recover_start': return mk('warn', '\u21BB', `Recovery: ${str(d.action) || 'retry'}`);
    case 'recover_done': return mk('good', '\u2713', 'Recovered');
    case 'process_dead': return mk('error', '\u2620', 'Process died');
    case 'process_up': return mk('warn', '\u21BB', 'Process restarted');
    default: return null;
  }
}

/** Events belong to the stage when lane and stage match, and order too when both sides name one. */
export function matchesStage(ev: ArenaEvent, lane: number, stage: string, order: string | null): boolean {
  if (ev.lane !== lane || ev.stage !== stage) return false;
  return !(order && ev.order && ev.order !== order);
}

/** Lines for a stage from a list of events, oldest first, one per seq. */
export function stageLines(events: ArenaEvent[], lane: number, stage: string, order: string | null): InspLine[] {
  const seen = new Set<number>();
  const out: InspLine[] = [];
  for (const ev of [...events].sort((a, b) => a.seq - b.seq)) {
    if (seen.has(ev.seq) || !matchesStage(ev, lane, stage, order)) continue;
    const ln = inspLine(ev);
    if (!ln) continue;
    seen.add(ev.seq);
    out.push(ln);
  }
  return out;
}

export interface Summary { duration: number | null; attempts: number; chaosHit: string; recovery: string; effects: number }

export function summarize(events: ArenaEvent[], lane: number, stage: string, order: string | null): Summary {
  const own = events.filter((e) => matchesStage(e, lane, stage, order));
  let duration: number | null = null;
  let attempts = 0;
  let chaosHit = '';
  let recovery = '';
  let effects = 0;
  for (const e of own) {
    const d = (e.detail ?? {}) as Record<string, unknown>;
    if (e.type === 'stage_start') attempts++;
    if (e.type === 'stage_done' && !d.skipped) duration = num(d.ms);
    if (e.type === 'chaos') chaosHit = `${str(d.creature)} ${str(d.fault)}`.trim() || 'chaos';
    if (e.type === 'recover_start') recovery = str(d.action) || 'retry';
    if (e.type === 'effect') effects++;
  }
  return { duration, attempts, chaosHit, recovery, effects };
}

/** True while the stage is running, so the popup streams and offers the Chaos button. */
export const isLive = (s: ChipState): boolean => s === 'active' || s === 'retrying';

export const REPLAY_MS = 2400;

/** How many lines a replay shows `t` ms in (linear reveal over REPLAY_MS, at least one once started). */
export function replayCount(total: number, t: number, ms = REPLAY_MS): number {
  if (total <= 0 || t < 0) return 0;
  return Math.min(total, Math.max(1, Math.ceil((t / ms) * total)));
}

const STATE_WORD: Record<ChipState, string> = {
  pending: 'Waiting', active: 'In progress', done: 'Done', replayed: 'Replayed', retrying: 'Retrying',
  failed: 'Failed', dead: 'Process dead', parked: 'Parked', quarantined: 'Quarantined',
};
export const stateWord = (s: ChipState): string => STATE_WORD[s];

export interface InspectorHost {
  stageLabel(id: string): string;
  chaos(lane: number): Promise<unknown>;
  fetchStage(lane: number, stage: string, order?: string): Promise<any>;
  chipState(lane: number, stageIdx: number): ChipState;
  onError(e: unknown): void;
}

const MAX_BUF = 600;

export class StageInspector {
  private buf: ArenaEvent[] = [];
  private target: { lane: number; stageIdx: number; stage: string; order: string | null } | null = null;
  private detail: any = null;
  private replayAt: number | null = null;
  private sig = '';
  private readonly dlg: HTMLElement;
  private readonly body: HTMLElement;
  private readonly title: HTMLElement;
  private readonly chaosBtn: HTMLButtonElement;
  private readonly replayBtn: HTMLButtonElement;
  private readonly meta: HTMLElement;
  private readonly facts: HTMLElement;

  constructor(root: HTMLElement, private readonly host: InspectorHost) {
    root.innerHTML = `
      <div class="insp-head"><h2 id="insp-title">Stage</h2><span class="insp-state" id="insp-state"></span>
        <button class="btn btn--ghost insp-x" type="button" id="insp-close" aria-label="Close inspector">Close</button></div>
      <div class="insp-meta" id="insp-meta"></div>
      <div class="insp-facts" id="insp-facts"></div>
      <div class="insp-log" id="insp-log" role="log" aria-live="off"></div>
      <div class="insp-foot">
        <button class="btn" type="button" id="insp-chaos">Chaos</button>
        <button class="btn btn--ghost" type="button" id="insp-replay">Replay</button>
      </div>`;
    this.dlg = root;
    this.title = root.querySelector('#insp-title')!;
    this.body = root.querySelector('#insp-log')!;
    this.meta = root.querySelector('#insp-state')!;
    this.facts = root.querySelector('#insp-facts')!;
    this.chaosBtn = root.querySelector('#insp-chaos')!;
    this.replayBtn = root.querySelector('#insp-replay')!;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Stage inspector');
    root.querySelector('#insp-close')!.addEventListener('click', () => this.close());
    this.chaosBtn.addEventListener('click', () => {
      if (!this.target) return;
      this.chaosBtn.disabled = true;
      this.host.chaos(this.target.lane).catch((e) => this.host.onError(e)).finally(() => { this.chaosBtn.disabled = false; });
    });
    this.replayBtn.addEventListener('click', () => { this.replayAt = performance.now(); this.sig = ''; });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); });
  }

  get isOpen(): boolean { return this.target !== null; }

  /** Every event passes through here so a stage opened later still has its history. */
  record(ev: ArenaEvent): void {
    if (ev.type === 'reset') { this.buf = []; this.close(); return; }
    if (typeof ev.lane !== 'number') return;
    this.buf.push(ev);
    if (this.buf.length > MAX_BUF) this.buf.splice(0, this.buf.length - MAX_BUF);
  }

  open(lane: number, stageIdx: number, stage: string, order: string | null): void {
    this.target = { lane, stageIdx, stage, order };
    this.detail = null;
    this.replayAt = null;
    this.sig = '';
    this.dlg.classList.remove('hidden');
    this.title.textContent = `Lane ${lane}: ${this.host.stageLabel(stage)}`;
    this.host.fetchStage(lane, stage, order ?? undefined).then((d) => {
      if (this.target && this.target.lane === lane && this.target.stage === stage) { this.detail = d; this.sig = ''; }
    }).catch(() => { /* the live buffer still fills the log */ });
  }

  close(): void {
    this.target = null;
    this.dlg.classList.add('hidden');
  }

  private events(): ArenaEvent[] {
    const fetched = Array.isArray(this.detail?.events) ? (this.detail.events as ArenaEvent[]) : [];
    return [...fetched, ...this.buf];
  }

  /** Redraws only when something changed, so streaming costs nothing at idle. */
  render(now: number): void {
    const t = this.target;
    if (!t) return;
    const state = this.host.chipState(t.lane - 1, t.stageIdx);
    const all = this.events();
    let lines = stageLines(all, t.lane, t.stage, t.order);
    let replaying = false;
    if (this.replayAt !== null) {
      const n = replayCount(lines.length, now - this.replayAt);
      replaying = n < lines.length || now - this.replayAt < REPLAY_MS;
      if (!replaying) this.replayAt = null;
      lines = lines.slice(0, n);
    }
    const live = isLive(state);
    const key = `${state}|${lines.length}|${lines[lines.length - 1]?.seq ?? 0}|${replaying}|${this.detail ? 1 : 0}`;
    this.chaosBtn.classList.toggle('hidden', !live);
    this.replayBtn.disabled = live || replaying || stageLines(all, t.lane, t.stage, t.order).length === 0;
    if (key === this.sig) return;
    this.sig = key;
    this.meta.textContent = `${live ? '\u25CF LIVE ' : ''}${stateWord(state)}`;
    this.meta.className = `insp-state insp-state--${live ? 'live' : state}`;
    const sm = summarize(all, t.lane, t.stage, t.order);
    const d = this.detail ?? {};
    const eff = Array.isArray(d.effects) ? d.effects.length : sm.effects;
    const rows: [string, string][] = [
      ['Order', t.order ?? '-'],
      ['Duration', sm.duration !== null ? `${sm.duration} ms` : live ? 'running' : '-'],
      ['Attempts', String(Math.max(sm.attempts, Array.isArray(d.attempts) ? d.attempts.length : 0))],
      ['Input', d.input ? 'order ' + String(d.input.order?.id ?? t.order ?? '') : '-'],
      ['Output', d.output ? String(d.output.id ?? 'ok') : '-'],
      ['Side effects', String(eff)],
      ['Chaos hit', sm.chaosHit || 'none'],
      ['Recovery', sm.recovery || 'none'],
    ];
    this.facts.replaceChildren(...rows.map(([k, v]) => {
      const el = document.createElement('div');
      el.className = 'insp-fact';
      const a = document.createElement('span'); a.textContent = k;
      const b = document.createElement('b'); b.textContent = v;
      el.append(a, b);
      return el;
    }));
    this.body.replaceChildren(...lines.map((ln) => {
      const el = document.createElement('div');
      el.className = `insp-line insp-line--${ln.level}`;
      const i = document.createElement('span'); i.className = 'insp-ic'; i.textContent = ln.icon;
      const x = document.createElement('span'); x.textContent = ln.text;
      el.append(i, x);
      return el;
    }));
    this.body.scrollTop = this.body.scrollHeight;
  }
}
