// TV3-U11: curses (tournament-v3 spec section 5.2, contract V1_2 section 5).
// `curse_start {lane, id, kind, endpoint, rate?}`, `curse_end {lane, id}`, `curse_response {lane, order, stage, curse, class}`.
// A curse is a lane trait for as long as it lasts: a purple chip on its stage, a tag on the lane card, a pop for every answer.
// Pure: no DOM, no clock; `now` is passed in.

export type CurseKind = '404' | 'slow' | 'flaky500' | 'clock_skew' | 'rate_limit';
export type CurseClass = 'handled' | 'reported' | 'swallowed' | 'crashed';
export const CLASSES: readonly CurseClass[] = ['handled', 'reported', 'swallowed', 'crashed'];

export interface CurseVM { id: string; kind: string; endpoint: string; stage: string; rate: number | null; startedAt: number }
export interface CursePop { stage: string; cls: CurseClass; curse: string; at: number }
export interface CurseHost { curses?: CurseVM[]; cursepops?: CursePop[] }

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);

export const CURSE_WORD: Record<string, string> = {
  '404': 'Cursed 404', slow: 'Slow Hand', flaky500: 'Flaky 500', clock_skew: 'Skewed Clock', rate_limit: 'Rate Limited',
};
/** Short label for a chip or a tag (always readable at 13 px). */
export const CURSE_SHORT: Record<string, string> = { '404': '404', slow: 'SLOW', flaky500: '500', clock_skew: 'SKEW', rate_limit: '429' };
export const CURSE_DOES: Record<string, string> = {
  '404': 'A share of calls to this endpoint return 404. Do not treat it as final: check, retry, or park and report.',
  slow: 'Every call to this endpoint is slow. Time out and fall back; do not stack calls.',
  flaky500: 'A share of calls return 500. Retry with backoff.',
  clock_skew: 'Timestamps jump. Do not rely on local time for idempotency.',
  rate_limit: 'Bursts of 429. Honour Retry-After.',
};
export const curseShort = (kind: string): string => CURSE_SHORT[kind] ?? kind.toUpperCase().slice(0, 5);
export const curseWord = (kind: string): string => CURSE_WORD[kind] ?? kind.replace(/_/g, ' ');

export const CLASS_WORD: Record<CurseClass, string> = { handled: 'HANDLED', reported: 'REPORTED', swallowed: 'SWALLOWED', crashed: 'CRASHED' };
export const CLASS_ICON: Record<CurseClass, string> = { handled: '✓', reported: '⚑', swallowed: '☠', crashed: '✕' };
export const CLASS_TIP: Record<CurseClass, string> = {
  handled: 'Recovered with a retry or a fallback.', reported: 'Surfaced with context; the order was parked or marked.',
  swallowed: 'The error vanished and the step was skipped. The worst answer.', crashed: 'The bot fell over.',
};
export const isClass = (v: unknown): v is CurseClass => CLASSES.includes(v as CurseClass);

/** The stage an endpoint belongs to: the stage id contained in the endpoint text ("/api/payment" gives "payment"), else ''. */
export function stageOfEndpoint(endpoint: string, stageIds: readonly string[]): string {
  const e = endpoint.toLowerCase();
  let best = '';
  for (const id of stageIds) if (e.includes(id.toLowerCase()) && id.length > best.length) best = id;
  return best;
}

const POP_LIFE_MS = 1800;
export const POP_MS = POP_LIFE_MS;

/** Fold one lane event. Returns the answer class for a `curse_response` (so the caller can count it), else null. */
export function applyCurseEvent(l: CurseHost, ev: { type: string; stage?: string; detail?: Record<string, unknown> }, now: number, stageIds: readonly string[], speed = 1): CurseClass | null {
  const d = rec(ev.detail);
  switch (ev.type) {
    case 'curse_start': {
      const id = str(d.id);
      if (!id) return null;
      const endpoint = str(d.endpoint);
      const c: CurseVM = { id, kind: str(d.kind), endpoint, stage: ev.stage || stageOfEndpoint(endpoint, stageIds), rate: typeof d.rate === 'number' ? d.rate : null, startedAt: now };
      l.curses = [...(l.curses ?? []).filter((x) => x.id !== id), c];
      return null;
    }
    case 'curse_end': {
      const id = str(d.id);
      l.curses = (l.curses ?? []).filter((x) => x.id !== id);
      return null;
    }
    case 'curse_response': {
      const cls = d.class;
      if (!isClass(cls)) return null;
      const stage = str(d.stage) || ev.stage || '';
      const keep = (l.cursepops ?? []).filter((p) => now - p.at < (POP_LIFE_MS * 2) / Math.max(0.1, speed));
      l.cursepops = [...keep, { stage, cls, curse: str(d.curse), at: now }].slice(-6);
      return cls;
    }
    default: return null;
  }
}

// ---- the curse table for the wave and round summary ----

export type CurseLedger = Record<number, Record<CurseClass, number>>;
export const emptyCurseLedger = (): CurseLedger => ({});

export function countAnswer(ledger: CurseLedger, lane: number, cls: CurseClass): void {
  const row = (ledger[lane] ??= { handled: 0, reported: 0, swallowed: 0, crashed: 0 });
  row[cls] += 1;
}

export interface CurseRow { lane: number; handled: number; reported: number; swallowed: number; crashed: number; total: number }

/** One row per lane that answered a cursed call, worst first (crashed and swallowed count most). */
export function curseTable(ledger: CurseLedger): CurseRow[] {
  return Object.entries(ledger).map(([lane, c]) => ({ lane: Number(lane), ...c, total: c.handled + c.reported + c.swallowed + c.crashed }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.crashed + b.swallowed - (a.crashed + a.swallowed) || b.total - a.total || a.lane - b.lane);
}
