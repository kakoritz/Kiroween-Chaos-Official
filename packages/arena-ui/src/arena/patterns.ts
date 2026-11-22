// TV3-U11: patterns, fix specs and the improve loop (tournament-v3 spec section 8, contract V1_2 notes C11, C12, C13). Pure: no DOM, no clock.
// REST: GET /api/patterns, POST /api/specs, POST /api/improve, GET /api/improve. Event: `pattern {...}`, `spec_written {...}`.
// Bodies are read defensively: a missing or mistyped field is skipped, never thrown on (protocol rule 17).

export type PStatus = 'new' | 'suggested' | 'accepted' | 'applied' | 'verified' | 'rejected';
export const STATUSES: readonly PStatus[] = ['new', 'suggested', 'accepted', 'applied', 'verified', 'rejected'];

export interface PatternRow {
  id: string;
  signature: string;
  stage: string;
  fault: string;
  consequence: string;
  shapes: string[];
  count: number;
  lanes: number[];
  downtimeMs: number;
  lostOrders: number;
  repeats: number;
  points: number;
  status: PStatus;
  qualifies: boolean;
  /** How many pieces of evidence (event seqs, journal lines, reports) back it. */
  evidence: number;
  unknown: boolean;
  fingerprint: string;
  /** Server cost for sorting (downtime cost), or null. */
  cost: number | null;
  change: string;
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const words = (s: string): string => s.replace(/[_-]+/g, ' ').trim();
const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

export const isStatus = (v: unknown): v is PStatus => STATUSES.includes(v as PStatus);

function evidenceCount(v: unknown): number {
  if (!Array.isArray(v)) return 0;
  let n = 0;
  for (const e of v) { const r = rec(e); n += (Array.isArray(r.seq) ? r.seq.length : 0) + (Array.isArray(r.journal) ? r.journal.length : 0) + (str(r.report) ? 1 : 0); }
  return n || v.length;
}

/** One pattern from `GET /api/patterns` or from a `pattern` event (which has no evidence list). */
export function patternOf(x: unknown): PatternRow | null {
  const r = rec(x);
  const signature = str(r.signature);
  const id = str(r.id) || (signature ? `p-${signature}` : '');
  if (!id || !signature) return null;
  const parts = signature.split('+').map((s) => s.trim());
  return {
    id, signature, stage: str(r.stage, parts[0] ?? ''), fault: str(r.fault, parts[1] ?? ''), consequence: str(r.consequence, parts.slice(2).join(' + ')),
    shapes: Array.isArray(r.shapes) ? r.shapes.filter((s): s is string => typeof s === 'string') : [],
    count: num(r.count), lanes: Array.isArray(r.lanes) ? r.lanes.filter((n): n is number => typeof n === 'number') : [],
    downtimeMs: num(r.downtimeMsTotal ?? r.downtimeMs), lostOrders: num(r.lostOrders), repeats: num(r.repeats), points: num(r.points),
    status: isStatus(r.status) ? r.status : 'new', qualifies: r.qualifies === true, evidence: evidenceCount(r.evidence),
    unknown: r.unknown === true, fingerprint: str(r.fingerprint), cost: typeof r.cost === 'number' ? r.cost : null, change: str(r.change),
  };
}

export interface PatternsView { rows: PatternRow[]; qualifying: number; thresholds: string }

/** Most costly first: the server's cost when it sends one, else downtime, lost orders, repeats. */
export function sortByCost(rows: readonly PatternRow[]): PatternRow[] {
  return [...rows].sort((a, b) => (b.cost ?? b.downtimeMs) - (a.cost ?? a.downtimeMs) || b.lostOrders - a.lostOrders || b.repeats - a.repeats || b.count - a.count || a.id.localeCompare(b.id));
}

export function parsePatterns(raw: unknown): PatternsView {
  const r = rec(raw);
  const list = Array.isArray(raw) ? raw : Array.isArray(r.patterns) ? r.patterns : [];
  const rows = sortByCost(list.map(patternOf).filter((p): p is PatternRow => p !== null));
  const t = rec(r.thresholds);
  const thresholds = Object.keys(t).length ? `Qualifies at ${num(t.count, 3)} occurrences, any lost order, or over ${Math.round(num(t.downtimeMs, 30000) / 1000)} s of downtime` : '';
  return { rows, qualifying: typeof r.qualifying === 'number' ? r.qualifying : rows.filter((p) => p.qualifies).length, thresholds };
}

/** Fold a `pattern` event into the list (same id replaces; the order is the cost order). */
export function foldPattern(rows: readonly PatternRow[], detail: unknown): PatternRow[] {
  const p = patternOf(detail);
  if (!p) return [...rows];
  const old = rows.find((x) => x.id === p.id);
  const merged: PatternRow = old ? { ...p, evidence: p.evidence || old.evidence, stage: p.stage || old.stage, shapes: p.shapes.length ? p.shapes : old.shapes } : p;
  return sortByCost([...rows.filter((x) => x.id !== p.id), merged]);
}

export const STATUS_WORD: Record<PStatus, string> = {
  new: 'NEW', suggested: 'SUGGESTED', accepted: 'ACCEPTED', applied: 'APPLIED', verified: 'VERIFIED', rejected: 'REJECTED',
};
export const STATUS_TIP: Record<PStatus, string> = {
  new: 'Found, nothing done yet.', suggested: 'A fix spec was written for it.', accepted: 'A policy overlay was applied.',
  applied: 'Rerun with the change; it may still be there.', verified: 'The rerun shows it gone.', rejected: 'Turned down.',
};

/** Title for a row: "Payment: timeout, duplicate effect". */
export function patternTitle(p: Pick<PatternRow, 'stage' | 'fault' | 'consequence' | 'signature'>, stageLabel: (id: string) => string = (s) => cap(words(s))): string {
  if (!p.fault && !p.consequence) return words(p.signature) || 'Unnamed pattern';
  return `${p.stage ? stageLabel(p.stage) : 'Anywhere'}: ${[words(p.fault), words(p.consequence)].filter(Boolean).join(', ')}`;
}

/** The fix in plain words, from the shape of the trouble. */
export function plainFix(p: Pick<PatternRow, 'fault' | 'consequence' | 'shapes'>): string {
  const c = p.consequence;
  const f = p.fault;
  if (p.shapes.includes('curse') || /curse|swallow/.test(f)) return 'Never swallow the error: retry it or report it with context.';
  if (p.shapes.includes('hang') || f === 'hang') return 'Put a timeout on the call and park the order instead of waiting.';
  if (p.shapes.includes('retry_storm') || f === 'retry_storm') return 'Cap the attempts and add a circuit breaker so retries stop piling up.';
  if (p.shapes.includes('failure_rate') || f === 'failure_rate') return 'Add a breaker and a queue so a failing step stops hurting every order.';
  if (p.shapes.includes('outage') || f === 'outage') return 'Park the order for the outage window and resume when it ends.';
  if (c === 'duplicate_effect') return 'Send an idempotency key so a retried step cannot repeat the effect.';
  if (c === 'order_lost') return /crash/.test(f) ? 'Keep a journal and replay finished steps after a restart.' : 'Retry with backoff before giving up on the order.';
  if (c === 'order_parked' || c === 'order_quarantined') return 'Queue the order and replay it once the dependency is back.';
  if (c === 'lane_halted') return 'Restart the process from its journal instead of halting.';
  if (/crash/.test(f)) return 'Keep a journal and replay finished steps after a restart.';
  return 'Add the smallest guard for this step: a retry, a key or a breaker.';
}

/** "0.7 s", "12 s", "1 min 5 s". */
export function secText(ms: number): string {
  if (ms <= 0) return '0 s';
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
  const s = Math.round(ms / 1000);
  return s < 90 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

// ---- fix spec ----

export interface SpecResult { runId: string; path: string; patterns: string[]; refused: string[]; lintOk: boolean | null; issues: string[] }

/** `POST /api/specs` answer or a `spec_written` event detail. */
export function specResultOf(raw: unknown): SpecResult | null {
  const r = rec(raw);
  const path = str(r.path);
  if (!path && !str(r.runId)) return null;
  const lint = rec(r.lint);
  const refused = Array.isArray(r.refused) ? r.refused.map((x) => (typeof x === 'string' ? x : str(rec(x).signature ?? rec(x).id))).filter(Boolean) : [];
  return {
    runId: str(r.runId), path, patterns: Array.isArray(r.patterns) ? r.patterns.map((x) => (typeof x === 'string' ? x : str(rec(x).id))).filter(Boolean) : [], refused,
    lintOk: typeof lint.ok === 'boolean' ? lint.ok : null,
    issues: Array.isArray(lint.issues) ? lint.issues.map((i) => (typeof i === 'string' ? i : str(rec(i).message ?? rec(i).text))).filter(Boolean) : [],
  };
}

// ---- improve loop ----

export type Phase = 'before' | 'mining' | 'applying' | 'after' | 'comparing' | 'done' | 'error';
export const PHASES: readonly Phase[] = ['before', 'mining', 'applying', 'after', 'comparing', 'done'];
export const PHASE_LABEL: Record<Phase, string> = {
  before: 'Run', mining: 'Mine', applying: 'Apply', after: 'Rerun', comparing: 'Compare', done: 'Closed', error: 'Error',
};
export const PHASE_DOES: Record<Phase, string> = {
  before: 'Running the tournament and recording every edge case', mining: 'Mining the runs for recurring patterns',
  applying: 'Applying the cheap fixes as policy and writing a spec for the rest', after: 'Rerunning the same plan with the changes',
  comparing: 'Comparing the two runs', done: 'The loop is closed', error: 'The loop stopped',
};

/** Progress 0..1 for the strip: the phase reached, counting the running phase as half done. */
export function phaseProgress(phase: Phase): number {
  const i = PHASES.indexOf(phase);
  if (phase === 'done') return 1;
  return i < 0 ? 0 : (i + 0.5) / PHASES.length;
}

export interface Delta { before: number | string | null; after: number | string | null }
export interface ComparePattern { id: string; signature: string; handling: string; before: number; after: number; status: PStatus; closed: boolean }
export interface Overlay { lane: number; tier: string; signature: string; action: string; stage: string; fault: string; existing: boolean }
export interface CompareReport {
  closed: number;
  of: number;
  summary: string;
  grade: Delta;
  reliability: Delta;
  score: Delta;
  lost: Delta;
  repeats: Delta;
  patterns: ComparePattern[];
  overlays: Overlay[];
  spec: SpecResult | null;
  newPatterns: number;
  text: string;
}
export interface ImproveState { id: string; phase: Phase; startedAt: number; report: CompareReport | null; spec: SpecResult | null; error: string }

const isPhase = (v: unknown): v is Phase => v === 'error' || PHASES.includes(v as Phase);

function deltaOf(v: unknown): Delta {
  const r = rec(v);
  const pick = (x: unknown): number | string | null => (typeof x === 'number' || typeof x === 'string' ? x : null);
  return { before: pick(r.before), after: pick(r.after) };
}

export function reportOf(raw: unknown): CompareReport | null {
  const r = rec(raw);
  if (Object.keys(r).length === 0) return null;
  const patterns: ComparePattern[] = (Array.isArray(r.patterns) ? r.patterns : []).map((x) => {
    const p = rec(x);
    return { id: str(p.id), signature: str(p.signature), handling: str(p.handling, 'nothing'), before: num(p.before), after: num(p.after), status: isStatus(p.status) ? p.status : 'new', closed: p.closed === true };
  }).filter((p) => p.signature);
  const closed = typeof r.closed === 'number' ? r.closed : patterns.filter((p) => p.closed).length;
  const of = typeof r.of === 'number' ? r.of : patterns.length;
  return {
    closed, of, summary: str(r.summary, `closed ${closed} of ${of} patterns`), grade: deltaOf(r.grade), reliability: deltaOf(r.reliability), score: deltaOf(r.score),
    lost: deltaOf(r.lost), repeats: deltaOf(r.repeats), patterns,
    overlays: (Array.isArray(r.overlays) ? r.overlays : []).map((x) => { const o = rec(x); return { lane: num(o.lane), tier: str(o.tier), signature: str(o.signature), action: str(o.action), stage: str(o.stage), fault: str(o.fault), existing: o.existing === true }; }),
    spec: specResultOf(r.spec), newPatterns: Array.isArray(r.newPatterns) ? r.newPatterns.length : num(r.newPatterns), text: str(r.text),
  };
}

/** `GET /api/improve` or the `POST /api/improve` answer `{improve, phase}`. Null when nothing is running. */
export function parseImprove(raw: unknown): ImproveState | null {
  const r = rec(raw);
  const id = str(r.id ?? r.improve);
  if (!id || !isPhase(r.phase)) return null;
  return { id, phase: r.phase, startedAt: num(r.startedAt), report: reportOf(r.report), spec: specResultOf(r.spec), error: str(r.error) };
}

export const isRunning = (s: ImproveState | null): boolean => !!s && s.phase !== 'done' && s.phase !== 'error';

const GRADE_ORDER = ['F', 'D', 'C', 'B', 'A', 'S'];
/** Did the grade improve (+1), stay (0) or drop (-1)? Tolerates "A+" and "B-" style grades. */
export function gradeMove(d: Delta): -1 | 0 | 1 {
  const rank = (g: number | string | null): number => (typeof g === 'string' ? GRADE_ORDER.indexOf(g[0]!.toUpperCase()) * 3 + (g.endsWith('+') ? 1 : g.endsWith('-') ? -1 : 0) : typeof g === 'number' ? g : -99);
  const a = rank(d.before), b = rank(d.after);
  return b > a ? 1 : b < a ? -1 : 0;
}

/** "62%" for 0..1 reliability, plain numbers otherwise. */
export function metricText(kind: 'reliability' | 'score' | 'count', v: number | string | null): string {
  if (v === null) return '-';
  if (typeof v === 'string') return v;
  if (kind === 'reliability') return `${Math.round(v <= 1 ? v * 100 : v)}%`;
  return String(Math.round(v));
}

/** Is a lower number better for this metric? */
export const lowerIsBetter = (key: 'reliability' | 'score' | 'lost' | 'repeats'): boolean => key === 'lost' || key === 'repeats';

export function overlayText(o: Overlay, stageLabel: (id: string) => string = (s) => cap(words(s))): string {
  const at = o.stage ? ` at ${stageLabel(o.stage)}` : '';
  return `${cap(o.tier || `lane ${o.lane}`)}: ${words(o.action)}${at}${o.existing ? ' (already learned)' : ''}`;
}

export const HANDLING_WORD: Record<string, string> = { overlay: 'policy overlay', spec: 'fix spec', 'overlay+spec': 'overlay and spec', nothing: 'nothing yet' };
