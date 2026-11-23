// PT-U6: pure models for lap tables, star progression, ratings and the wave end card v2 (ui.md section 6).
// No DOM here so everything is unit tested. Input is the contract v1.1 shapes (laps, review, wave_end summary).
import type { ArenaEvent } from '../api';

export type LapOutcome = 'done' | 'cancelled' | 'parked' | 'quarantined' | 'abandoned' | 'running';

export interface LapRow {
  order: string;
  outcome: LapOutcome;
  ms: number | null;
  attempts: number;
  retries: number;
  downtimeMs: number;
  issues: number;
  issueList: { stage: string; count: number }[];
  stars: number | null;
}

export type LapTag = 'best' | 'slowest' | null;
export interface LapTableRow extends LapRow { tag: LapTag }
export interface LapFooter { count: number; done: number; totalMs: number; avgMs: number | null; attempts: number; retries: number; downtimeMs: number; issues: number; avgStars: number | null }
export interface LapTable { rows: LapTableRow[]; footer: LapFooter }

const rec = (v: unknown): Record<string, any> => (v && typeof v === 'object' ? (v as Record<string, any>) : {});
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export const OUTCOME_MARK: Record<LapOutcome, string> = { done: '\u2713', cancelled: '\u2715', parked: '\u26B0', quarantined: '\u2697', abandoned: '\u2298', running: '\u25B6' };

export function normOutcome(s: string): LapOutcome {
  if (s === 'done' || s === 'delivered' || s === 'completed') return 'done';
  if (s === 'cancelled' || s === 'failed') return 'cancelled';
  if (s === 'parked' || s === 'quarantined' || s === 'abandoned') return s;
  return 'running';
}

function issueList(v: unknown): { stage: string; count: number }[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => ({ stage: str(rec(x).stage), count: num(rec(x).count) })).filter((x) => x.stage && x.count > 0);
}

/** One row from a server lap record `{order, outcome, lap, review}` (laps endpoints, V1_1.md section 9). */
export function lapRowOf(raw: unknown): LapRow | null {
  const r = rec(raw);
  const order = str(r.order);
  if (!order) return null;
  const lap = rec(r.lap);
  const issues = issueList(lap.issues);
  const stars = rec(r.review).stars;
  return {
    order, outcome: normOutcome(str(r.outcome)),
    ms: typeof lap.ms === 'number' ? lap.ms : null,
    attempts: num(lap.attempts), retries: num(lap.retries), downtimeMs: num(lap.downtimeMs),
    issues: issues.reduce((a, x) => a + x.count, 0), issueList: issues,
    stars: typeof stars === 'number' ? stars : null,
  };
}

export function lapRowsOf(raw: unknown): LapRow[] {
  const list = Array.isArray(raw) ? raw : Array.isArray(rec(raw).laps) ? (rec(raw).laps as unknown[]) : [];
  return list.map(lapRowOf).filter((x): x is LapRow => x !== null);
}

/** Rows from the live event buffer of one lane (order_done / order_failed plus the review that follows). */
export function lapRowsFromEvents(events: readonly ArenaEvent[], lane: number): LapRow[] {
  const reviews = new Map<string, unknown>();
  const rows: LapRow[] = [];
  const mine = events.filter((e) => e.lane === lane).sort((a, b) => a.seq - b.seq);
  for (const e of mine) if (e.type === 'review' && e.order) reviews.set(e.order, e.detail);
  for (const e of mine) {
    if ((e.type !== 'order_done' && e.type !== 'order_failed') || !e.order) continue;
    const row = lapRowOf({ order: e.order, outcome: e.type === 'order_done' ? 'done' : 'cancelled', lap: rec(e.detail).lap, review: reviews.get(e.order) });
    if (row) rows.push(row);
  }
  return rows;
}

/** Server rows first (older orders), then buffer rows overriding same-order entries. */
export function mergeLapRows(server: readonly LapRow[], live: readonly LapRow[]): LapRow[] {
  const by = new Map<string, LapRow>();
  for (const r of server) by.set(r.order, r);
  for (const r of live) by.set(r.order, r);
  return [...by.values()];
}

/** Best = shortest completed lap, slowest = longest completed lap. Needs two completed laps so the tags mean something. */
export function lapTable(rows: readonly LapRow[]): LapTable {
  const done = rows.filter((r) => r.outcome === 'done' && r.ms !== null);
  let best = '';
  let slow = '';
  if (done.length >= 2) {
    const sorted = [...done].sort((a, b) => a.ms! - b.ms!);
    if (sorted[0]!.ms !== sorted[sorted.length - 1]!.ms) { best = sorted[0]!.order; slow = sorted[sorted.length - 1]!.order; }
  }
  const out: LapTableRow[] = rows.map((r) => ({ ...r, tag: r.order === best ? 'best' : r.order === slow ? 'slowest' : null }));
  const rated = rows.filter((r) => r.stars !== null);
  const totalMs = rows.reduce((a, r) => a + (r.ms ?? 0), 0);
  return {
    rows: out,
    footer: {
      count: rows.length, done: done.length, totalMs,
      avgMs: done.length ? Math.round(done.reduce((a, r) => a + r.ms!, 0) / done.length) : null,
      attempts: rows.reduce((a, r) => a + r.attempts, 0), retries: rows.reduce((a, r) => a + r.retries, 0),
      downtimeMs: rows.reduce((a, r) => a + r.downtimeMs, 0), issues: rows.reduce((a, r) => a + r.issues, 0),
      avgStars: rated.length ? Math.round((rated.reduce((a, r) => a + r.stars!, 0) / rated.length) * 100) / 100 : null,
    },
  };
}

export const secText = (ms: number | null | undefined): string => (typeof ms === 'number' ? `${(ms / 1000).toFixed(1)} s` : '\u2013');
export const starNum = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

// ---- stars ----

/** The live tracker text: `cum.stars/cum.max`, for example `8/15`. */
export function starTracker(cum: { stars?: unknown; max?: unknown } | null | undefined): string {
  if (!cum || typeof cum.stars !== 'number' || typeof cum.max !== 'number') return '';
  return `${starNum(cum.stars)}/${cum.max}`;
}

export type Rating = 'Five-Star Crypt' | 'Respectable' | 'Spooky Service' | 'Cursed';
/** V1_1.md section 6. */
export function ratingFor(avg: number): Rating {
  return avg >= 4.5 ? 'Five-Star Crypt' : avg >= 3.5 ? 'Respectable' : avg >= 2.5 ? 'Spooky Service' : 'Cursed';
}
export const ratingTone = (r: string): 'gold' | 'good' | 'amber' | 'red' => (r === 'Five-Star Crypt' ? 'gold' : r === 'Respectable' ? 'good' : r === 'Spooky Service' ? 'amber' : 'red');

export interface StarPoint { order: string; stars: number; cumStars: number; cumMax: number }

export function starSeriesOf(raw: unknown): StarPoint[] {
  const list = Array.isArray(raw) ? raw : Array.isArray(rec(raw).series) ? (rec(raw).series as unknown[]) : [];
  const out: StarPoint[] = [];
  for (const x of list) {
    const r = rec(x);
    if (typeof r.cumStars !== 'number' || typeof r.cumMax !== 'number') continue;
    out.push({ order: str(r.order), stars: num(r.stars), cumStars: r.cumStars, cumMax: r.cumMax });
  }
  return out;
}

/** Series from review events of one lane. */
export function starSeriesFromEvents(events: readonly ArenaEvent[], lane: number): StarPoint[] {
  const out: StarPoint[] = [];
  for (const e of [...events].filter((x) => x.lane === lane && x.type === 'review').sort((a, b) => a.seq - b.seq)) {
    const d = rec(e.detail);
    const c = rec(d.cum);
    if (typeof c.stars === 'number' && typeof c.max === 'number') out.push({ order: str(e.order ?? d.order), stars: num(d.stars), cumStars: c.stars, cumMax: c.max });
  }
  return out;
}

/** Chart geometry: one bar per order, height = cumStars / cumMax (0..1), label `cumStars/cumMax`. */
export interface StarBar { order: string; ratio: number; label: string; tone: 'gold' | 'amber' | 'red' }
export function starBars(series: readonly StarPoint[]): StarBar[] {
  return series.map((p) => {
    const ratio = p.cumMax > 0 ? Math.max(0, Math.min(1, p.cumStars / p.cumMax)) : 0;
    const avg = ratio * 5;
    return { order: p.order, ratio, label: `${starNum(p.cumStars)}/${p.cumMax}`, tone: avg >= 4.5 ? 'gold' : avg >= 3 ? 'amber' : 'red' };
  });
}

// ---- wave end card v2 ----

export interface LaneCard {
  lane: number;
  title: string;
  rating: string;
  tone: 'gold' | 'good' | 'amber' | 'red';
  avgStars: number | null;
  stars: string;
  bestMs: number | null;
  slowestMs: number | null;
  avgMs: number | null;
  totalMs: number | null;
  retries: number;
  downtimeMs: number;
  orders: { done: number; cancelled: number; parked: number; quarantined: number };
  issues: { stage: string; count: number; heat: 0 | 1 | 2 | 3 }[];
  series: StarPoint[];
  score: number | null;
  /** Issues in the wave (V1_2 section 5 notes: `summary[lane].issues`), or null on an older server. */
  issuesTotal: number | null;
  /** False when the lane had no issue at all: the floor rule (P19) was broken. Null when the server does not say. */
  floorOk: boolean | null;
}

/** Heat of one stage chip: 0 none, 1 low, 2 medium, 3 hot (relative to the lane's worst stage). */
export function heatOf(count: number, max: number): 0 | 1 | 2 | 3 {
  if (count <= 0 || max <= 0) return 0;
  const f = count / max;
  return f > 0.66 ? 3 : f > 0.33 ? 2 : 1;
}

/** Build the per lane cards from `wave_end.detail.summary` (keyed by lane) plus star series fetched or derived. */
/** True when at least one lane finished, cancelled, parked or quarantined an order. An empty wave gets no end card. */
export function summaryHasOrders(summary: unknown): boolean {
  return Object.values(rec(summary)).some((v) => { const o = rec(rec(v).orders); return num(o.done) + num(o.cancelled) + num(o.parked) + num(o.quarantined) > 0; });
}

export function laneCards(
  summary: unknown, stageIds: readonly string[], series: ReadonlyMap<number, StarPoint[]>, titleOf: (lane: number) => string,
): LaneCard[] {
  const s = rec(summary);
  const cards: LaneCard[] = [];
  for (const key of Object.keys(s).sort((a, b) => Number(a) - Number(b))) {
    const lane = Number(key);
    if (!Number.isFinite(lane)) continue;
    const r = rec(s[key]);
    const st = rec(r.stars);
    const avg = typeof st.avg === 'number' ? st.avg : typeof st.sum === 'number' && num(st.count) > 0 ? st.sum / st.count : null;
    // A lane with no review has no rating: the server's placeholder ("Cursed") would read as a verdict.
    const rating = !(num(st.max) > 0) && avg === null ? '' : typeof r.rating === 'string' && r.rating ? r.rating : avg !== null ? ratingFor(avg) : '';
    const by = rec(r.issuesByStage);
    const ids = [...stageIds];
    for (const k of Object.keys(by)) if (!ids.includes(k)) ids.push(k);
    const maxIssue = Math.max(0, ...ids.map((id) => num(by[id])));
    const o = rec(r.orders);
    cards.push({
      lane, title: titleOf(lane) || str(r.tier) || `Lane ${lane}`, rating, tone: ratingTone(rating),
      avgStars: avg === null ? null : Math.round(avg * 100) / 100,
      stars: typeof st.sum === 'number' ? `${starNum(st.sum)}/${num(st.max)}` : '',
      bestMs: typeof r.bestMs === 'number' ? r.bestMs : null, slowestMs: typeof r.slowestMs === 'number' ? r.slowestMs : null,
      avgMs: typeof r.avgMs === 'number' ? r.avgMs : null, totalMs: typeof r.totalMs === 'number' ? r.totalMs : null,
      retries: num(r.retries), downtimeMs: num(r.downtimeMs),
      orders: { done: num(o.done), cancelled: num(o.cancelled), parked: num(o.parked), quarantined: num(o.quarantined) },
      issues: ids.map((id) => ({ stage: id, count: num(by[id]), heat: heatOf(num(by[id]), maxIssue) })),
      series: series.get(lane) ?? [], score: typeof r.score === 'number' ? r.score : null,
      issuesTotal: typeof r.issues === 'number' ? r.issues : null, floorOk: typeof r.floorOk === 'boolean' ? r.floorOk : null,
    });
  }
  return cards;
}

/** Issues per stage summed over lap rows (heat map of the report tab). */
export function issuesByStageOf(rows: readonly LapRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) for (const i of r.issueList) out[i.stage] = (out[i.stage] ?? 0) + i.count;
  return out;
}

export function ordersWord(o: LaneCard['orders']): string {
  const parts = [`${o.done} done`];
  if (o.cancelled) parts.push(`${o.cancelled} cancelled`);
  if (o.parked) parts.push(`${o.parked} parked`);
  if (o.quarantined) parts.push(`${o.quarantined} quarantined`);
  return parts.join(', ');
}

// ---- report tab "Laps & stars" ----

export interface LaneLaps { lane: number; tier: string; rows: LapRow[] }
export interface LaneRating { lane: number; rating: string; avg: number | null }

const lanesList = (raw: unknown): unknown[] => (Array.isArray(raw) ? raw : Array.isArray(rec(raw).lanes) ? (rec(raw).lanes as unknown[]) : []);

/** `GET /api/waves/:n/laps` (`{lanes}`) or the report JSON `laps` array: `[{lane, tier, laps:[{order, outcome, lap, review}]}]`. */
export function laneLapsOf(raw: unknown): LaneLaps[] {
  return lanesList(raw).map((x) => ({ lane: num(rec(x).lane), tier: str(rec(x).tier), rows: lapRowsOf(rec(x).laps) })).filter((l) => l.lane > 0);
}

/** `GET /api/waves/:n/stars` (`{lanes}`) or the report JSON `stars` array: `[{lane, series}]`. */
export function laneStarsOf(raw: unknown): Map<number, StarPoint[]> {
  const out = new Map<number, StarPoint[]>();
  for (const x of lanesList(raw)) { const lane = num(rec(x).lane); if (lane > 0) out.set(lane, starSeriesOf(rec(x).series)); }
  return out;
}

/** Ratings from the report JSON `ratings: [{lane, rating, avg}]`, else derived from the last point of each star series. */
export function ratingsOf(raw: unknown, stars: ReadonlyMap<number, StarPoint[]>): LaneRating[] {
  const given = Array.isArray(raw) ? raw : [];
  const out = new Map<number, LaneRating>();
  for (const x of given) {
    const lane = num(rec(x).lane);
    if (lane <= 0) continue;
    const avg = typeof rec(x).avg === 'number' ? (rec(x).avg as number) : null;
    out.set(lane, { lane, rating: str(rec(x).rating) || (avg !== null ? ratingFor(avg) : ''), avg });
  }
  for (const [lane, series] of stars) {
    if (out.has(lane) || series.length === 0) continue;
    const last = series[series.length - 1]!;
    const avg = last.cumMax > 0 ? Math.round((last.cumStars / (last.cumMax / 5)) * 100) / 100 : null;
    out.set(lane, { lane, rating: avg !== null ? ratingFor(avg) : '', avg });
  }
  return [...out.values()].sort((a, b) => a.lane - b.lane);
}

/** Mean of the lane averages, or null. Used by the compare view. */
export function waveAvgStars(r: readonly LaneRating[]): number | null {
  const v = r.filter((x) => x.avg !== null).map((x) => x.avg!);
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 : null;
}
