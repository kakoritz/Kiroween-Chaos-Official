// Lane popup v2 model (playtest-v2 ui.md section 5). Pure functions over contract events: split a lane's
// events into orders, build the stage table, the lap summary, the review card and the filtered log.
// No DOM, no clock. Server records (contract/V1_1.md section 9) fill in what the event buffer misses.
import type { ArenaEvent } from '../api/types';
import { chaosPhrase } from './creatures';
import { displayId, vocabOf } from './vocab';
import { CHIP_ICON, CHIP_WORD, chipState, isIssue, type ChipV2State } from './chips';

export type Level = 'info' | 'warn' | 'error' | 'good';
export type Outcome = 'running' | 'done' | 'cancelled' | 'parked' | 'quarantined';
export type LogFilter = 'all' | 'issues' | 'score';
export const FILTERS: readonly LogFilter[] = ['all', 'issues', 'score'];

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/** Dedupe by seq and sort. */
export function sortUnique(events: readonly ArenaEvent[]): ArenaEvent[] {
  const seen = new Set<number>();
  const out: ArenaEvent[] = [];
  for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
    if (seen.has(e.seq)) continue;
    seen.add(e.seq);
    out.push(e);
  }
  return out;
}

/** The order an event belongs to: its own `order`, else `detail.order`, else the order running before it. */
export function segment(events: readonly ArenaEvent[], lane: number): Map<string, ArenaEvent[]> {
  const out = new Map<string, ArenaEvent[]>();
  let cur = '';
  for (const e of sortUnique(events)) {
    if (e.lane !== lane) continue;
    const own = e.order ?? str(rec(e.detail).order);
    if (e.type === 'order_start' && own) cur = own;
    const key = own || cur;
    if (!key) continue;
    let list = out.get(key);
    if (!list) { list = []; out.set(key, list); }
    list.push(e);
  }
  return out;
}

export interface StageRow {
  stage: string;
  state: ChipV2State;
  word: string;
  icon: string;
  attempts: number;
  retries: number;
  issues: number;
  downtimeMs: number;
  ms: number | null;
  recoverable: 'yes' | 'no' | 'n/a';
}

const RETRY = new Set(['retry', 'backoff', 'restart']);

/** One row per stage from one order's events (state, issues and downtime come from the chip model). */
export function stageRows(events: readonly ArenaEvent[], stageIds: readonly string[], record?: unknown): StageRow[] {
  const ordered = sortUnique(events);
  const chips = chipState(ordered, stageIds);
  const idx = new Map(stageIds.map((s, i) => [s, i] as const));
  const starts = stageIds.map(() => 0);
  const fails = stageIds.map(() => 0);
  const retries = stageIds.map(() => 0);
  const ms = stageIds.map<number | null>(() => null);
  const failedAt = stageIds.map(() => false);
  const healed = stageIds.map(() => false);
  let open = -1;
  for (const e of ordered) {
    const d = rec(e.detail);
    const si = e.stage ? idx.get(e.stage) ?? open : open;
    switch (e.type) {
      case 'stage_start': if (si >= 0) { open = si; starts[si]!++; } break;
      case 'stage_fail': if (si >= 0) { fails[si]!++; failedAt[si] = true; } break;
      case 'recover_start': if (si >= 0 && RETRY.has(str(d.action) || 'retry')) retries[si]!++; break;
      case 'stage_done':
        if (si >= 0 && d.skipped !== true) { ms[si] = num(d.ms, 0); if (failedAt[si]) healed[si] = true; }
        break;
      default: break;
    }
  }
  const server = new Map<string, Record<string, unknown>>();
  if (record && Array.isArray(rec(record).stages)) for (const s of rec(record).stages as unknown[]) server.set(str(rec(s).stage), rec(s));
  return stageIds.map((stage, i): StageRow => {
    const c = chips[i]!;
    const sv = server.get(stage);
    const touched = starts[i]! > 0 || fails[i]! > 0 || c.state !== 'pending';
    const useServer = !!sv && !touched;
    const state: ChipV2State = useServer ? serverState(str(sv!.status)) : c.state;
    return {
      stage, state, word: CHIP_WORD[state], icon: CHIP_ICON[state],
      attempts: useServer ? num(sv!.attempts) : Math.max(c.attempts, starts[i]!),
      retries: useServer ? num(sv!.retries) : retries[i]!,
      issues: useServer ? num(sv!.issues) : Math.max(c.issues, fails[i]!),
      downtimeMs: useServer ? num(sv!.downtimeMs) : c.downtimeMs,
      ms: useServer ? (typeof sv!.ms === 'number' ? sv!.ms : null) : ms[i]!,
      recoverable: useServer
        ? (sv!.recoverable === true ? 'yes' : num(sv!.issues) > 0 ? 'no' : 'n/a')
        : !failedAt[i] ? 'n/a' : healed[i] ? 'yes' : 'no',
    };
  });
}

function serverState(status: string): ChipV2State {
  switch (status) {
    case 'done': case 'passed': return 'passed';
    case 'healed': return 'healed';
    case 'failed': return 'failed';
    case 'skipped': case 'replayed': return 'replayed';
    case 'parked': case 'quarantined': case 'trouble': case 'active': case 'dead': case 'next': return status;
    default: return 'pending';
  }
}

export interface Lap {
  ms: number;
  workMs: number | null;
  attempts: number;
  retries: number;
  downtimeMs: number;
  issues: number;
  /** True when the server lap object was used; false when derived from the buffer (order still running). */
  final: boolean;
}

const sumIssues = (v: unknown): number => (Array.isArray(v) ? v.reduce((a: number, x) => a + num(rec(x).count), 0) : num(v));

/** The lap: the server's `detail.lap` of order_done/order_failed, else a running tally from the events. */
export function lapOf(events: readonly ArenaEvent[], rows: readonly StageRow[], record?: unknown): Lap | null {
  const ordered = sortUnique(events);
  const end = [...ordered].reverse().find((e) => e.type === 'order_done' || e.type === 'order_failed');
  const l = rec(rec(end?.detail).lap ?? rec(record).lap);
  if (Object.keys(l).length > 0) {
    return {
      ms: num(l.ms), workMs: typeof l.workMs === 'number' ? l.workMs : null, attempts: num(l.attempts), retries: num(l.retries),
      downtimeMs: num(l.downtimeMs), issues: sumIssues(l.issues), final: true,
    };
  }
  if (ordered.length === 0) return null;
  const first = ordered.find((e) => e.type === 'order_start') ?? ordered[0]!;
  const last = ordered[ordered.length - 1]!;
  return {
    ms: Math.max(0, num(last.ts) - num(first.ts)), workMs: null,
    attempts: rows.reduce((a, r) => a + r.attempts, 0), retries: rows.reduce((a, r) => a + r.retries, 0),
    downtimeMs: rows.reduce((a, r) => a + r.downtimeMs, 0), issues: rows.reduce((a, r) => a + r.issues, 0), final: false,
  };
}

export interface Review {
  stars: number;
  sub: { key: string; label: string; value: number }[];
  reasons: string[];
  text: string;
  cancelled: boolean;
  cum: { stars: number; max: number; count: number } | null;
}

export const SUB_LABELS: readonly [string, string][] = [
  ['timeliness', 'Timeliness'], ['delays', 'Delays'], ['issues', 'Issues'], ['delivery', 'Delivery'], ['ease', 'Ease'],
];

/** Normalize a review from the `review` event (detail is the review object) or a server record. */
export function normReview(raw: unknown, cancelled = false): Review | null {
  const r0 = rec(raw);
  const r = r0.review && typeof r0.review === 'object' ? rec(r0.review) : r0;
  if (typeof r.stars !== 'number') return null;
  const sub = rec(r.sub);
  const cum = rec(r.cum);
  return {
    stars: r.stars,
    sub: SUB_LABELS.map(([key, label]) => ({ key, label, value: num(sub[key]) })),
    reasons: Array.isArray(r.reasons) ? r.reasons.filter((x): x is string => typeof x === 'string') : [],
    text: str(r.text),
    cancelled: cancelled || r.stars <= 1 && Object.keys(sub).length === 0,
    cum: typeof cum.stars === 'number' ? { stars: cum.stars, max: num(cum.max), count: num(cum.count) } : null,
  };
}

export function reviewOf(events: readonly ArenaEvent[], outcome: Outcome, record?: unknown): Review | null {
  const ev = [...sortUnique(events)].reverse().find((e) => e.type === 'review');
  return normReview(ev?.detail ?? rec(record).review, outcome === 'cancelled');
}

/** Star text: whole numbers without a decimal, halves with one. */
export const starText = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Gold at 4.5 or more, amber from 3, red below (ui.md section 7). */
export const starTone = (n: number): 'gold' | 'amber' | 'red' => (n >= 4.5 ? 'gold' : n >= 3 ? 'amber' : 'red');

/** Star glyphs with half stars: filled, half, empty (always five). */
export function starGlyphs(n: number): string {
  const full = Math.floor(n);
  const half = n - full >= 0.5 ? 1 : 0;
  return '\u2605'.repeat(full) + (half ? '\u00BD' : '') + '\u2606'.repeat(Math.max(0, 5 - full - half));
}

export const OUTCOME_ICON: Record<Outcome, string> = { running: '\u25B6', done: '\u2713', cancelled: '\u2715', parked: '\u26B0', quarantined: '\u2697' };
export const OUTCOME_WORD: Record<Outcome, string> = { running: 'running', done: 'delivered', cancelled: 'cancelled', parked: 'parked', quarantined: 'quarantined' };

export function outcomeOf(events: readonly ArenaEvent[]): Outcome {
  let o: Outcome = 'running';
  for (const e of sortUnique(events)) {
    if (e.type === 'order_start') o = 'running';
    else if (e.type === 'order_done') o = 'done';
    else if (e.type === 'order_failed') o = 'cancelled';
    else if (e.type === 'order_parked') o = 'parked';
    else if (e.type === 'order_quarantined') o = 'quarantined';
  }
  return o;
}

export interface OrderRow { order: string; outcome: Outcome; lapMs: number | null; stars: number | null }

const outcomeFromServer = (s: string): Outcome =>
  s === 'done' || s === 'delivered' || s === 'completed' ? 'done'
    : s === 'cancelled' || s === 'failed' ? 'cancelled'
      : s === 'parked' ? 'parked' : s === 'quarantined' ? 'quarantined' : 'running';

/** Orders of the lane in wave order: from the buffer, plus older ones the server listed (`getLaneLaps`). */
export function orderRows(events: readonly ArenaEvent[], lane: number, serverLaps?: unknown): OrderRow[] {
  const seg = segment(events, lane);
  const rows = new Map<string, OrderRow>();
  for (const [order, evs] of seg) {
    const outcome = outcomeOf(evs);
    const end = [...evs].reverse().find((e) => e.type === 'order_done' || e.type === 'order_failed');
    const lapMs = end ? (rec(rec(end.detail).lap).ms as number | undefined) : undefined;
    const rv = normReview(([...evs].reverse().find((e) => e.type === 'review'))?.detail);
    rows.set(order, { order, outcome, lapMs: typeof lapMs === 'number' ? lapMs : null, stars: rv ? rv.stars : null });
  }
  const list = Array.isArray(serverLaps) ? serverLaps : Array.isArray(rec(serverLaps).laps) ? (rec(serverLaps).laps as unknown[]) : [];
  const older: OrderRow[] = [];
  for (const x of list) {
    const o = str(rec(x).order);
    if (!o || rows.has(o)) continue;
    const lapMs = rec(rec(x).lap).ms;
    const rv = normReview(rec(x).review);
    older.push({ order: o, outcome: outcomeFromServer(str(rec(x).outcome)), lapMs: typeof lapMs === 'number' ? lapMs : null, stars: rv ? rv.stars : null });
  }
  return [...older, ...rows.values()];
}

/** Best (shortest completed lap) and slowest (longest completed lap) order ids, or null with fewer than two laps. */
export function bestSlowest(rows: readonly OrderRow[]): { best: string; slowest: string } | null {
  const laps = rows.filter((r) => r.outcome === 'done' && r.lapMs !== null);
  if (laps.length < 2) return null;
  const sorted = [...laps].sort((a, b) => a.lapMs! - b.lapMs!);
  return { best: sorted[0]!.order, slowest: sorted[sorted.length - 1]!.order };
}

export interface LogEntry {
  seq: number;
  /** Seconds since the order's first event. */
  t: number;
  level: Level;
  icon: string;
  text: string;
  kind: 'issue' | 'score' | 'other';
  stage: string | null;
}

/** Format an offset like `+3.2s`. */
export const offsetText = (t: number): string => `+${Math.max(0, t).toFixed(1)}s`;

function line(e: ArenaEvent, label: (id: string) => string, app = 'orders'): { level: Level; icon: string; text: string } | null {
  const d = rec(e.detail);
  const st = e.stage ? label(e.stage) : '';
  const v = vocabOf(app);
  const Unit = v.unit.charAt(0).toUpperCase() + v.unit.slice(1);
  switch (e.type) {
    case 'order_start': return { level: 'info', icon: '\u25B7', text: `Grabbed order ${str(e.order)}${d.redo === true ? ' (redo)' : ''}`.trim() };
    case 'stage_start': return { level: 'info', icon: '\u25B6', text: `${st || 'Stage'} started, attempt ${num(d.attempt, 1)}` };
    case 'stage_progress': return { level: 'info', icon: '\u2026', text: `${st} ${num(d.pct)}% ${str(d.label)}`.trim() };
    case 'stage_done': return d.skipped === true
      ? { level: 'good', icon: '\u21BA', text: `${st} skipped, replayed from the journal` }
      : { level: 'good', icon: '\u2713', text: `${st || 'Stage'} done in ${num(d.ms)} ms` };
    case 'stage_fail': return { level: 'error', icon: '\u2717', text: `${st || 'Stage'} failed: ${str(d.error) || 'error'}${d.retryable ? ' (retryable)' : ''}` };
    case 'chaos': return { level: 'warn', icon: d.unknown === true ? '?' : '\u2620', text: d.unknown === true || d.source === 'gremlin' ? `Chaos: ${chaosPhrase(d)}` : `Chaos hit: ${str(d.creature) || 'creature'} ${str(d.fault)}`.trim() };
    case 'outage': return { level: 'warn', icon: '\u23F3', text: `Outage: ${Math.round(num(d.outageMs) / 100) / 10} s window${str(d.fault) ? ` (${str(d.fault).replace(/_/g, ' ')})` : ''}` };
    case 'chaos_absorbed': return { level: 'good', icon: '\u26E8', text: 'Chaos absorbed' };
    case 'effect': return { level: 'info', icon: '\u270E', text: `Effect ${str(d.kind)} ${str(d.key)}${d.replayed ? ' (replayed)' : ''}`.trim() };
    case 'repeat': return { level: 'error', icon: '\u21BB', text: `Repeated side effect ${str(d.kind)} ${str(d.key)}`.trim() };
    case 'recover_start': return { level: 'warn', icon: '\u21BB', text: `Recovery: ${str(d.action) || 'retry'}` };
    case 'recover_done': return { level: 'good', icon: '\u2713', text: 'Recovered' };
    case 'breaker': return { level: d.state === 'open' ? 'error' : 'good', icon: '\u26A1', text: `Breaker ${str(d.state) || 'changed'}` };
    case 'process_dead': return { level: 'error', icon: '\u2620', text: 'Process died' };
    case 'process_up': return { level: 'warn', icon: '\u21BB', text: 'Process restarted' };
    case 'order_done': return { level: 'good', icon: '\u2713', text: `${Unit} ${displayId(app, str(e.order))} ${v.done}`.replace('  ', ' ') };
    case 'order_failed': return { level: 'error', icon: '\u2717', text: v.cancelled };
    case 'order_parked': return { level: 'warn', icon: '\u26B0', text: `${Unit} parked` };
    case 'order_quarantined': return { level: 'error', icon: '\u2697', text: `${Unit} quarantined` };
    case 'decision_needed': return { level: 'warn', icon: '\u26A0', text: 'WRONG ORDER: a decision is needed' };
    case 'decision_made': return { level: 'info', icon: '\u2714', text: `Decision: ${str(d.choice)} (${str(d.source) || 'user'})` };
    case 'review': {
      const rv = normReview(e.detail);
      return rv ? { level: rv.stars >= 4 ? 'good' : rv.stars >= 3 ? 'warn' : 'error', icon: '\u2605', text: `Review ${starText(rv.stars)} stars${rv.text ? `: "${rv.text}"` : ''}` } : null;
    }
    case 'score': {
      const delta = num(d.delta);
      const reason = str(d.reason) || 'score';
      return { level: delta < 0 ? 'warn' : 'good', icon: reason === 'downtime' ? '\u23F1' : '\u25C6', text: `Score ${delta >= 0 ? '+' : ''}${delta} (${reason})` };
    }
    default: return null;
  }
}

/** Log lines for one order, oldest first. */
export function logEntries(events: readonly ArenaEvent[], stageLabel: (id: string) => string, app = 'orders'): LogEntry[] {
  const ordered = sortUnique(events);
  const t0 = ordered.length > 0 ? num((ordered.find((e) => e.type === 'order_start') ?? ordered[0]!).ts) : 0;
  const out: LogEntry[] = [];
  for (const e of ordered) {
    const l = line(e, stageLabel, app);
    if (!l) continue;
    out.push({
      seq: e.seq, t: (num(e.ts) - t0) / 1000, ...l,
      kind: isIssue(e) ? 'issue' : e.type === 'score' ? 'score' : 'other',
      stage: e.stage ?? null,
    });
  }
  return out;
}

/** Apply the filter chips (All, Issues, Score) and the optional stage filter from a table row click. */
export function filterLog(entries: readonly LogEntry[], filter: LogFilter, stage: string | null): LogEntry[] {
  return entries.filter((x) => (filter === 'all' || (filter === 'issues' ? x.kind === 'issue' : x.kind === 'score')) && (!stage || x.stage === stage));
}

/** Downtime points: the sum of negative downtime score deltas for the order, as a positive number. */
export function downtimePoints(events: readonly ArenaEvent[]): number {
  let n = 0;
  for (const e of events) {
    const d = rec(e.detail);
    if (e.type === 'score' && str(d.reason) === 'downtime') n += Math.max(0, -num(d.delta));
  }
  return n;
}

export const secs = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;
