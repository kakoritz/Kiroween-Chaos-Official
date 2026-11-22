// The Casebook and the awards (spec 3.4). Pure: built from the cases of every round so far.
import { TIERS, type TierId } from '../shared/catalog';
import { suggestionFor } from './lessons';
import type { Case, Mechanism, Outcome } from './signature';
import { tierOfLane } from './rounds';

export type LaneOutcome = 'solved' | 'partly' | 'lost' | 'absorbed';

/** What one lane's cases of a signature add up to. Absorbed is not solved: nothing was recovered, the fault just did not matter. */
export function laneOutcome(list: readonly Case[]): { outcome: LaneOutcome; mechanism?: Mechanism } {
  const real = list.find((c) => c.outcome === 'solved' && c.mechanism !== 'none' && c.mechanism !== 'absorbed');
  const absorbed = list.every((c) => c.outcome === 'solved' && c.mechanism === 'absorbed');
  if (absorbed) return { outcome: 'absorbed', mechanism: 'absorbed' };
  const allSolved = list.every((c) => c.outcome === 'solved' && c.mechanism !== 'none');
  if (allSolved && real) return { outcome: 'solved', mechanism: real.mechanism };
  const allLost = list.every((c) => c.outcome === 'lost' || (c.outcome === 'solved' && c.mechanism === 'none'));
  if (allLost) return { outcome: 'lost' };
  return { outcome: 'partly', ...(real ? { mechanism: real.mechanism } : {}) };
}

export interface CaseRow {
  signature: string;
  stage: string;
  fault: string;
  consequence: string;
  firstSeen: { round: number; order: string; lane: number };
  /** Every lane that met it, in lane order, with what became of it there: solved (a real mechanism), absorbed (no recovery was needed), partly, or lost. */
  lanes: { lane: number; outcome: LaneOutcome; mechanism?: Mechanism }[];
  /** Who solved it and how. */
  solvedBy: { lane: number; tier: TierId; mechanism: Mechanism; round: number }[];
  outcomes: Record<Outcome, number>;
  /** How many times it was met, over all lanes and rounds. */
  met: number;
  cost: { downtimeMs: number; points: number };
  /** `solved` if any lane really solved it; `absorbed` if the only lanes that met it needed no recovery (not a solve); `open` otherwise (it goes straight to the fix spec). */
  status: 'solved' | 'open' | 'absorbed';
  /** The minimal part or policy: what the solvers used, or what the reviewer rule proposes for an open case. */
  recommendedFix: { action?: string; part: string; rule?: string; mechanism?: string } | null;
  unknown?: boolean;
  fingerprint?: string;
}

export interface Casebook {
  /** Rounds covered. */
  rounds: number;
  cases: CaseRow[];
  open: string[];
  /** The Casebook is always produced, also when nothing went wrong. */
  note: string;
}

const MECH_PART: Partial<Record<Mechanism, { part: string; action?: string }>> = {
  retry: { part: 'retry', action: 'retry_backoff' }, retry_backoff: { part: 'retry', action: 'retry_backoff' }, journal_replay: { part: 'journal', action: 'journal_replay' },
  idempotency_key: { part: 'idempotency', action: 'idempotency_key' }, reconcile: { part: 'idempotency', action: 'idempotency_key' }, breaker: { part: 'breaker', action: 'breaker_park' },
  queue: { part: 'offline_queue', action: 'breaker_park' }, restart: { part: 'journal' }, compensate: { part: 'idempotency' },
};

export function buildCasebook(cases: readonly Case[], rounds: number): Casebook {
  const by = new Map<string, Case[]>();
  for (const c of cases) by.set(c.signature, [...(by.get(c.signature) ?? []), c]);
  const rows: CaseRow[] = [];
  for (const [signature, list] of by) {
    const first = list.reduce((a, b) => (b.round < a.round || (b.round === a.round && b.order < a.order) ? b : a));
    const laneNums = [...new Set(list.map((c) => c.lane))].sort((a, b) => a - b);
    const lanes: CaseRow['lanes'] = laneNums.map((lane) => ({ lane, ...laneOutcome(list.filter((c) => c.lane === lane)) }));
    const solved = list.filter((c) => c.outcome === 'solved' && c.mechanism !== 'none' && c.mechanism !== 'absorbed');
    const absorbedOnly = solved.length === 0 && list.some((c) => c.outcome === 'solved' && c.mechanism === 'absorbed') && !list.some((c) => c.outcome === 'lost');
    const solvedBy: CaseRow['solvedBy'] = [];
    for (const c of solved) if (!solvedBy.some((s) => s.lane === c.lane)) solvedBy.push({ lane: c.lane, tier: tierOfLane(c.lane), mechanism: c.mechanism, round: c.round });
    const outcomes: Record<Outcome, number> = { solved: 0, partly: 0, lost: 0 };
    for (const c of list) outcomes[c.outcome]++;
    const status: CaseRow['status'] = solved.length > 0 ? 'solved' : absorbedOnly ? 'absorbed' : 'open';
    let fix: CaseRow['recommendedFix'] = null;
    if (status === 'solved') {
      const m = solvedBy.find((s) => MECH_PART[s.mechanism])?.mechanism;
      fix = m ? { ...MECH_PART[m]!, mechanism: m } : { part: 'none', mechanism: solvedBy[0]?.mechanism ?? 'none' };
    } else if (status === 'absorbed') {
      fix = { part: 'none', mechanism: 'absorbed' };
    } else {
      const s = suggestionFor(first);
      fix = s ? { action: s.action, part: s.part, rule: s.rule } : null;
    }
    const unknown = list.find((c) => c.unknown);
    rows.push({
      signature, stage: first.stage, fault: first.fault, consequence: first.consequence, firstSeen: { round: first.round, order: first.order, lane: first.lane }, lanes, solvedBy,
      outcomes, met: list.length, cost: { downtimeMs: list.reduce((a, c) => a + c.costMs, 0), points: list.reduce((a, c) => a + c.costPoints, 0) }, status, recommendedFix: fix,
      ...(unknown ? { unknown: true, fingerprint: unknown.fingerprint } : {}),
    });
  }
  // Open cases first (they need a fix), then by how many lanes met them.
  const rank = (r: CaseRow) => (r.status === 'open' ? 0 : r.status === 'solved' ? 1 : 2);
  rows.sort((a, b) => rank(a) - rank(b) || b.lanes.length - a.lanes.length || b.met - a.met || a.signature.localeCompare(b.signature));
  return {
    rounds, cases: rows, open: rows.filter((r) => r.status === 'open').map((r) => r.signature),
    note: rows.length ? `${rows.length} edge ${rows.length === 1 ? 'case' : 'cases'}, ${rows.filter((r) => r.status === 'open').length} open.` : 'No edge cases this time: everything held. The Casebook is still kept.',
  };
}

// ------------------------------------------------------------------------------------------------------------------ awards

export interface Award { id: 'champion' | 'battle_tested' | 'iron_skeleton' | 'fastest_recovery' | 'wooden_spoon'; label: string; lane: number; tier: TierId; value?: number; text: string }

export interface AwardInput {
  champion?: number;
  cases: readonly Case[];
  /** Cumulative repeats and rp by lane. */
  repeats: ReadonlyMap<number, number>;
  rp: ReadonlyMap<number, number>;
  /** Recovery times (ms) by lane. */
  recoveries: ReadonlyMap<number, readonly number[]>;
  firstOut?: number;
  firstOutRound?: number;
}

const median = (xs: readonly number[]): number => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const label = (lane: number): string => TIERS[tierOfLane(lane)].label;

/** Champion (last standing), Battle-Tested (most distinct cases solved), Iron Skeleton (fewest repeats), Fastest Recovery (best p50), Wooden Spoon (first out, said kindly). */
export function computeAwards(i: AwardInput): Award[] {
  const out: Award[] = [];
  const lanes = [...i.rp.keys()].sort((a, b) => a - b);
  if (i.champion !== undefined) out.push({ id: 'champion', label: 'Champion', lane: i.champion, tier: tierOfLane(i.champion), text: `${label(i.champion)} was the last one standing.` });

  const solvedBy = new Map<number, Set<string>>();
  for (const c of i.cases) if (c.outcome === 'solved' && c.mechanism !== 'none' && c.mechanism !== 'absorbed') (solvedBy.get(c.lane) ?? solvedBy.set(c.lane, new Set()).get(c.lane)!).add(c.signature);
  const bt = lanes.map((l) => ({ l, n: solvedBy.get(l)?.size ?? 0 })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n || (i.rp.get(b.l) ?? 0) - (i.rp.get(a.l) ?? 0) || a.l - b.l)[0];
  if (bt) out.push({ id: 'battle_tested', label: 'Battle-Tested', lane: bt.l, tier: tierOfLane(bt.l), value: bt.n, text: `${label(bt.l)} solved ${bt.n} distinct edge ${bt.n === 1 ? 'case' : 'cases'}.` });

  const iron = lanes.map((l) => ({ l, r: i.repeats.get(l) ?? 0 })).sort((a, b) => a.r - b.r || (i.rp.get(b.l) ?? 0) - (i.rp.get(a.l) ?? 0) || a.l - b.l)[0];
  if (iron) out.push({ id: 'iron_skeleton', label: 'Iron Skeleton', lane: iron.l, tier: tierOfLane(iron.l), value: iron.r, text: `${label(iron.l)} repeated ${iron.r === 0 ? 'nothing' : `${iron.r} ${iron.r === 1 ? 'effect' : 'effects'}`}.` });

  // A recovery of 0 ms is no recovery (nothing was bounced back from); a lane with none does not compete.
  const real = (l: number) => (i.recoveries.get(l) ?? []).filter((ms) => ms > 0);
  const fast = lanes.filter((l) => real(l).length > 0).map((l) => ({ l, p50: median(real(l)) })).sort((a, b) => a.p50 - b.p50 || a.l - b.l)[0];
  if (fast) out.push({ id: 'fastest_recovery', label: 'Fastest Recovery', lane: fast.l, tier: tierOfLane(fast.l), value: Math.round(fast.p50), text: `${label(fast.l)} bounced back in ${Math.round(fast.p50)} ms at the median.` });

  if (i.firstOut !== undefined) out.push({ id: 'wooden_spoon', label: 'Wooden Spoon', lane: i.firstOut, tier: tierOfLane(i.firstOut), text: `${label(i.firstOut)} went first${i.firstOutRound ? `, in round ${i.firstOutRound}` : ''}, and gave the others something to learn from.` });
  return out;
}

/**
 * The `case` events of a round (V1_2 section 5): one per (lane, signature), the first time the lane met it that round, with a `count`.
 * Stage rides on the envelope.
 */
export function caseEvents(cases: readonly Case[]): { type: 'case'; lane: number; stage: string; detail: Record<string, unknown> }[] {
  const seen = new Map<string, { first: Case; count: number }>();
  for (const c of cases) {
    const k = `${c.lane}|${c.signature}`;
    const e = seen.get(k);
    if (e) e.count++; else seen.set(k, { first: c, count: 1 });
  }
  return [...seen.values()].map(({ first: c, count }) => ({
    type: 'case' as const, lane: c.lane, stage: c.stage,
    detail: {
      signature: c.signature, lane: c.lane, round: c.round, order: c.order, outcome: c.outcome, ...(c.mechanism !== 'none' ? { mechanism: c.mechanism } : {}),
      costMs: c.costMs, costPoints: c.costPoints, count, ...(c.unknown ? { unknown: true, fingerprint: c.fingerprint } : {}),
    },
  }));
}
