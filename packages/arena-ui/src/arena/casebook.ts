// TV3-U9: lessons ledger and Casebook (tournament-v3 spec sections 3.4 and 4, contract V1_2 section 5).
// Pure: no DOM, no clock. Events: `lesson {lane, signature, mechanism, round, via}` and
// `case {signature, lane, round, order, outcome, mechanism?, costMs, costPoints, unknown?}`; lane may sit on the envelope or in `detail`.
// REST: GET /api/casebook and GET /api/lessons/:lane. Their bodies are read defensively (an entry per lane, or grouped by signature).

export type Outcome = 'solved' | 'partly' | 'lost';
export interface Lesson { lane: number; signature: string; mechanism: string; round: number; via: 'overcame' | 'suggested' }
export interface CaseEntry { signature: string; lane: number; round: number; order: string; outcome: Outcome; mechanism: string; costMs: number; costPoints: number; unknown: boolean }
export interface CaseRow {
  signature: string;
  stage: string;
  fault: string;
  consequence: string;
  unknown: boolean;
  entries: CaseEntry[];
  /** Lanes that met the case, in lane order. */
  lanes: number[];
  /** Lanes that solved it, with the mechanism that worked. */
  solvedBy: Array<{ lane: number; mechanism: string }>;
  /** Nobody solved it: it goes straight to the fix spec. */
  open: boolean;
  recommended: string;
  costMs: number;
  costPoints: number;
}

export interface CasebookVM {
  lessons: Record<number, Lesson[]>;
  entries: CaseEntry[];
  /** Server-given recommended fix per signature (GET /api/casebook), if any. */
  recommended: Record<string, string>;
  /** Client clock of the last lesson per lane, for the "learned" sparkle. */
  learnedAt: Record<number, { at: number; mechanism: string }>;
}

export const emptyCasebook = (): CasebookVM => ({ lessons: {}, entries: [], recommended: {}, learnedAt: {} });

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);

const OUTCOMES: readonly Outcome[] = ['solved', 'partly', 'lost'];

/** "payment + timeout + duplicate_charge" into its three parts. Missing parts come back empty. */
export function splitSignature(sig: string): { stage: string; fault: string; consequence: string } {
  const [stage = '', fault = '', ...rest] = sig.split('+').map((s) => s.trim());
  return { stage, fault, consequence: rest.join(' + ') };
}

const words = (s: string): string => s.replace(/[_-]+/g, ' ').trim();
const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** "Payment: timeout, duplicate charge" for a table cell. */
export function caseTitle(sig: string, stageLabel: (id: string) => string = (s) => cap(words(s))): string {
  const p = splitSignature(sig);
  if (!p.fault && !p.consequence) return words(sig) || 'Unnamed case';
  return `${p.stage ? stageLabel(p.stage) : 'Anywhere'}: ${[words(p.fault), words(p.consequence)].filter(Boolean).join(', ')}`;
}

const MECHANISM_WORD: Record<string, string> = {
  retry: 'retry with backoff', restart: 'restart', absorbed: 'absorbed', breaker_park: 'breaker and park', backoff: 'retry with backoff', retry_backoff: 'retry with backoff', idempotency: 'idempotency key', idempotency_key: 'idempotency key',
  breaker: 'circuit breaker', queue: 'queue and replay', offline_queue: 'queue and replay', reconcile: 'reconcile', compensate: 'compensate', journal: 'journal replay',
  hold_and_reroute: 'hold and reroute', timeout_fallback: 'timeout and fallback',
};
export const mechanismWord = (m: string): string => MECHANISM_WORD[m] ?? words(m);

/** Fold one event into the casebook. Returns the lane that just learned something (for the sparkle), or null. */
export function applyCasebookEvent(cb: CasebookVM, ev: { type: string; lane?: number; detail?: Record<string, unknown> }, now: number): number | null {
  const d = rec(ev.detail);
  const lane = num(ev.lane ?? d.lane);
  if (ev.type === 'reset') { Object.assign(cb, emptyCasebook()); return null; }
  if (lane <= 0) return null;
  if (ev.type === 'lesson') {
    const l = lessonOf(lane, d);
    if (!l) return null;
    const list = (cb.lessons[lane] ??= []);
    // The same signature and mechanism is one lesson; a later `overcame` upgrades a `suggested` one.
    const at = list.findIndex((x) => x.signature === l.signature && x.mechanism === l.mechanism);
    if (at >= 0) { if (list[at]!.via === 'suggested' && l.via === 'overcame') list[at] = l; return null; }
    list.push(l);
    cb.learnedAt[lane] = { at: now, mechanism: l.mechanism };
    return lane;
  }
  if (ev.type === 'case') {
    const e = entryOf(lane, d, ev as { order?: string });
    if (!e) return null;
    // One entry per lane, signature and order; a later outcome for the same order replaces the earlier one.
    const at = cb.entries.findIndex((x) => x.lane === e.lane && x.signature === e.signature && x.order === e.order && x.round === e.round);
    if (at >= 0) cb.entries[at] = e; else cb.entries.push(e);
    return null;
  }
  return null;
}

function lessonOf(lane: number, d: Record<string, unknown>): Lesson | null {
  const signature = str(d.signature);
  if (!signature) return null;
  return { lane, signature, mechanism: str(d.mechanism ?? d.action), round: num(d.round ?? d.learnedRound), via: d.via === 'suggested' ? 'suggested' : 'overcame' };
}

function entryOf(lane: number, d: Record<string, unknown>, ev: { order?: string }): CaseEntry | null {
  const signature = str(d.signature);
  if (!signature) return null;
  const outcome = OUTCOMES.includes(d.outcome as Outcome) ? (d.outcome as Outcome) : 'lost';
  return {
    signature, lane, round: num(d.round), order: str(d.order ?? ev.order), outcome, mechanism: str(d.mechanism),
    costMs: num(d.costMs), costPoints: num(d.costPoints), unknown: d.unknown === true || /^fz-|unknown/i.test(signature),
  };
}

/** Rows of the table: one per signature, open cases first, then the most widely met. */
export function caseRows(cb: Pick<CasebookVM, 'entries' | 'recommended'>): CaseRow[] {
  const by = new Map<string, CaseEntry[]>();
  for (const e of cb.entries) { const l = by.get(e.signature); if (l) l.push(e); else by.set(e.signature, [e]); }
  const rows: CaseRow[] = [];
  for (const [signature, entries] of by) {
    const p = splitSignature(signature);
    const lanes = [...new Set(entries.map((e) => e.lane))].sort((a, b) => a - b);
    const solvedBy: CaseRow['solvedBy'] = [];
    for (const e of entries) if (e.outcome === 'solved' && !solvedBy.some((s) => s.lane === e.lane)) solvedBy.push({ lane: e.lane, mechanism: e.mechanism });
    const open = solvedBy.length === 0;
    rows.push({
      signature, ...p, unknown: entries.some((e) => e.unknown), entries, lanes, solvedBy, open,
      recommended: cb.recommended[signature] || recommendFix(solvedBy, open),
      costMs: entries.reduce((a, e) => a + e.costMs, 0), costPoints: entries.reduce((a, e) => a + e.costPoints, 0),
    });
  }
  return rows.sort((a, b) => Number(b.open) - Number(a.open) || b.lanes.length - a.lanes.length || a.signature.localeCompare(b.signature));
}

/** The smallest fix that worked for the lanes that solved it; an open case is handed to the fix spec. */
export function recommendFix(solvedBy: ReadonlyArray<{ mechanism: string }>, open: boolean): string {
  if (open) return 'Nobody solved it: goes to the fix spec';
  const count = new Map<string, number>();
  for (const s of solvedBy) if (s.mechanism) count.set(s.mechanism, (count.get(s.mechanism) ?? 0) + 1);
  const best = [...count].sort((a, b) => b[1] - a[1])[0];
  return best ? cap(mechanismWord(best[0])) : 'Solved: mechanism not reported';
}

/** Per lane: how many distinct cases it solved (Battle-Tested counts this). */
export function solvedCounts(cb: Pick<CasebookVM, 'entries'>): Map<number, number> {
  const seen = new Map<number, Set<string>>();
  for (const e of cb.entries) if (e.outcome === 'solved') { const s = seen.get(e.lane) ?? new Set<string>(); s.add(e.signature); seen.set(e.lane, s); }
  return new Map([...seen].map(([lane, s]) => [lane, s.size] as const));
}

/** Words for an engine `recommendedFix {action?, part, rule?, mechanism?}`. */
function fixWord(f: Record<string, unknown>): string {
  const m = str(f.mechanism ?? f.action);
  const part = str(f.part);
  const base = m ? cap(mechanismWord(m)) : cap(words(part));
  return part && part !== 'none' && m ? `${base} (${words(part)} part)` : base;
}

/** `GET /api/casebook`: an array or `{cases | entries | casebook}` of per-lane entries, or of groups `{signature, entries | lanes, recommended}`. */
export function loadCasebook(cb: CasebookVM, raw: unknown): void {
  const r = rec(raw);
  const list = Array.isArray(raw) ? raw : Array.isArray(r.cases) && r.cases.length > 0 ? r.cases : Array.isArray(r.open) && Array.isArray(r.cases) ? r.cases : Array.isArray(r.entries) ? r.entries : Array.isArray(r.casebook) ? r.casebook : [];
  const entries: CaseEntry[] = [];
  const recommended: Record<string, string> = {};
  for (const x of list) {
    const g = rec(x);
    const signature = str(g.signature);
    const fixObj = rec(g.recommendedFix);
    const fixText = str(g.recommended ?? g.fix) || (Object.keys(fixObj).length ? fixWord(fixObj) : str(g.recommendedFix));
    if (signature && fixText) recommended[signature] = fixText;
    // Engine row (C10): lanes[] are numbers, solvedBy[] says who solved it, cost is {downtimeMs, points}.
    if (signature && Array.isArray(g.lanes) && g.lanes.every((n) => typeof n === 'number')) {
      const solved = Array.isArray(g.solvedBy) ? g.solvedBy.map(rec) : [];
      const cost = rec(g.cost);
      const first = rec(g.firstSeen);
      (g.lanes as number[]).forEach((lane, i) => {
        const s = solved.find((x) => num(x.lane) === lane);
        entries.push({
          signature, lane, round: num(s?.round ?? first.round), order: str(first.order), outcome: s ? 'solved' : 'lost', mechanism: str(s?.mechanism),
          costMs: i === 0 ? num(cost.downtimeMs) : 0, costPoints: i === 0 ? num(cost.points) : 0, unknown: g.unknown === true,
        });
      });
      continue;
    }
    const nested = Array.isArray(g.entries) ? g.entries : Array.isArray(g.lanes) ? g.lanes : null;
    if (nested) {
      for (const n of nested) {
        const nr = rec(n);
        const e = entryOf(num(nr.lane), { signature, unknown: g.unknown, ...nr }, {});
        if (e && e.lane > 0) entries.push(e);
      }
    } else {
      const e = entryOf(num(g.lane), g, {});
      if (e && e.lane > 0) entries.push(e);
    }
  }
  if (entries.length > 0 || Object.keys(recommended).length > 0) { cb.entries = entries; cb.recommended = { ...cb.recommended, ...recommended }; }
}

/** `GET /api/lessons/:lane`: `[{signature, mechanism, learnedRound | round, via?}]` or `{lessons: [...]}`. */
export function loadLessons(cb: CasebookVM, lane: number, raw: unknown): void {
  const r = rec(raw);
  const list = Array.isArray(raw) ? raw : Array.isArray(r.lessons) ? r.lessons : [];
  const out: Lesson[] = [];
  for (const x of list) { const l = lessonOf(lane, rec(x)); if (l && !out.some((o) => o.signature === l.signature && o.mechanism === l.mechanism)) out.push(l); }
  if (out.length > 0) cb.lessons[lane] = out;
}

export const lessonCount = (cb: Pick<CasebookVM, 'lessons'>, lane: number): number => cb.lessons[lane]?.length ?? 0;

/** Tooltip for the scroll icon on a lane card. */
export function lessonsTip(list: readonly Lesson[], stageLabel: (id: string) => string = cap): string {
  if (list.length === 0) return 'No lessons yet.';
  const lines = list.slice(-5).map((l) => `${caseTitle(l.signature, stageLabel)}: ${mechanismWord(l.mechanism) || 'learned'}${l.via === 'suggested' ? ' (from the loss)' : ''}`);
  return `${list.length} ${list.length === 1 ? 'lesson' : 'lessons'} learned.\n${lines.join('\n')}${list.length > 5 ? `\n+ ${list.length - 5} more` : ''}`;
}
