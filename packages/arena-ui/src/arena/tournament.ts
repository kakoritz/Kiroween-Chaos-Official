// TV3-U8: tournament view model (tournament-v3 spec section 3, contract V1_2 sections 2 and 3). Pure: no DOM, no clock.
// Events: round_start, round_end, awaiting_next, lane_eliminated, corpse, tournament_end. State: `corpses[]` and `lanes[].fallen`.
// Shapes are read defensively: a field that is missing or of another type is skipped, never thrown on (protocol rule 17).

export interface Standing { lane: number; rp: number; rank: number; eliminated: boolean; issues: number | null }
export interface Corpse { lane: number; stage: string; kind: 'eliminated' | 'wall'; round: number; epitaph: string; cause: string }
export interface Fallen { round: number; stage: string; cause: string; epitaph: string }
export interface Award { id: string; label: string; lane: number | null; detail: string; /** Numeric value behind the award (median recovery ms, repeats, cases...) when the engine sends one. */ value?: number }

export interface RoundResult {
  round: number;
  standings: Standing[];
  /** Lanes that drop at the end of this round, with the reason from `lane_eliminated`. */
  eliminated: Array<{ lane: number; stage: string; cause: string; epitaph: string }>;
  awards: Award[];
  lessons: unknown[];
  cases: unknown[];
}

export interface TournamentVM {
  active: boolean;
  round: number;
  total: number;
  /** Lanes that fight in the current round. */
  live: number[];
  /** Every lane that ever took part, so fallen lanes stay on the board. */
  roster: number[];
  orders: number;
  intensity: number;
  /** running: orders are being served. review: round_end seen, waiting for Next. ended: tournament_end. */
  phase: 'idle' | 'running' | 'review' | 'ended';
  awaitingNext: boolean;
  corpses: Corpse[];
  fallen: Record<number, Fallen>;
  results: RoundResult[];
  /** The engine's tie-break rule text from the last round_end, if it sent one. */
  rule: string;
  champion: number | null;
  awards: Award[];
  casebookRef: string;
}

export const emptyTournament = (): TournamentVM => ({
  active: false, round: 0, total: 0, live: [], roster: [], orders: 0, intensity: 0, phase: 'idle', awaitingNext: false,
  corpses: [], fallen: {}, results: [], rule: '', champion: null, awards: [], casebookRef: '',
});

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);

/** Lane numbers from `[1, 2]` or `[{lane: 1}, ...]`. */
export function laneList(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  for (const x of v) {
    const n = typeof x === 'number' ? x : num(rec(x).lane, NaN);
    if (Number.isFinite(n) && n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
}

export function standingsOf(v: unknown): Standing[] {
  if (!Array.isArray(v)) return [];
  return v.map((x, i) => {
    const r = rec(x);
    return { lane: num(r.lane), rp: num(r.rp ?? r.points ?? r.score), rank: num(r.rank, i + 1), eliminated: r.eliminated === true, issues: typeof r.issues === 'number' ? r.issues : null };
  }).filter((s) => s.lane > 0).sort((a, b) => a.rank - b.rank);
}

export function awardsOf(v: unknown): Award[] {
  const out: Award[] = [];
  const add = (id: string, x: unknown) => {
    const r = rec(x);
    const lane = typeof x === 'number' ? x : typeof r.lane === 'number' ? r.lane : null;
    out.push({ id: str(r.id, id), label: str(r.label, AWARD_LABEL[id] ?? id), lane, detail: str(r.text ?? r.detail ?? r.why), ...(typeof r.value === 'number' ? { value: r.value } : {}) });
  };
  if (Array.isArray(v)) v.forEach((x) => add(str(rec(x).id ?? rec(x).award ?? rec(x).kind, 'award'), x));
  else for (const [k, x] of Object.entries(rec(v))) add(k, x);
  return out.filter((a) => a.lane !== null || a.detail);
}

export const AWARD_LABEL: Record<string, string> = {
  champion: 'Champion', battle_tested: 'Battle-Tested', battleTested: 'Battle-Tested', iron_skeleton: 'Iron Skeleton', ironSkeleton: 'Iron Skeleton',
  fastest_recovery: 'Fastest Recovery', fastestRecovery: 'Fastest Recovery', wooden_spoon: 'Wooden Spoon', woodenSpoon: 'Wooden Spoon',
};

function eliminatedOf(v: unknown, known: TournamentVM): RoundResult['eliminated'] {
  const lanes = laneList(Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
  const reason = rec(v);
  return lanes.map((lane) => {
    const f = known.fallen[lane];
    return { lane, stage: f?.stage ?? str(reason.stage), cause: f?.cause ?? str(reason.cause ?? reason.reason), epitaph: f?.epitaph ?? str(reason.epitaph) };
  }).filter((e) => e.lane > 0);
}

const addRoster = (t: TournamentVM, lanes: number[]): void => {
  for (const n of lanes) if (!t.roster.includes(n)) t.roster.push(n);
  t.roster.sort((a, b) => a - b);
};

/** Mark a lane fallen and add its corpse (once). */
function fall(t: TournamentVM, lane: number, round: number, stage: string, cause: string, epitaph: string): void {
  t.fallen[lane] = { round, stage, cause, epitaph };
  addCorpse(t, { lane, stage, kind: 'eliminated', round, epitaph, cause });
  addRoster(t, [lane]);
}

function addCorpse(t: TournamentVM, c: Corpse): void {
  // One corpse per lane and kind: an eliminated lane's marker never duplicates, a wall marker moves to the newest stage.
  const i = t.corpses.findIndex((x) => x.lane === c.lane && x.kind === c.kind && (c.kind === 'eliminated' || x.stage === c.stage));
  if (i >= 0) t.corpses[i] = c; else t.corpses.push(c);
}

/** Apply one tournament event. Returns true when the event was one of ours. */
export function applyTournamentEvent(t: TournamentVM, ev: { type: string; lane?: number; stage?: string; detail?: Record<string, unknown> }): boolean {
  const d = rec(ev.detail);
  switch (ev.type) {
    case 'round_start': {
      t.active = true; t.phase = 'running'; t.awaitingNext = false;
      t.round = num(d.round, t.round + 1);
      t.total = num(d.total, t.total);
      t.live = laneList(d.lanes);
      t.orders = num(d.orders, t.orders); t.intensity = num(d.intensity, t.intensity);
      addRoster(t, t.live);
      // Wall corpses belong to one round (spec 3.3); eliminated ones stay for the whole tournament.
      t.corpses = t.corpses.filter((c) => c.kind === 'eliminated');
      return true;
    }
    case 'lane_eliminated': {
      const lane = num(ev.lane ?? d.lane);
      if (lane <= 0) return true;
      t.active = true;
      fall(t, lane, num(d.round, t.round), str(d.stage ?? ev.stage), str(d.cause), str(d.epitaph));
      t.live = t.live.filter((n) => n !== lane);
      return true;
    }
    case 'corpse': {
      const lane = num(ev.lane ?? d.lane);
      if (lane <= 0) return true;
      t.active = true;
      const kind = d.kind === 'wall' ? 'wall' : 'eliminated';
      const stage = str(d.stage ?? ev.stage);
      const round = num(d.round, t.round);
      const epitaph = str(d.epitaph);
      if (kind === 'eliminated') fall(t, lane, round, stage, t.fallen[lane]?.cause ?? '', epitaph);
      else { addCorpse(t, { lane, stage, kind, round, epitaph, cause: str(d.cause) }); addRoster(t, [lane]); }
      return true;
    }
    case 'round_end': {
      t.active = true; t.phase = 'review';
      const round = num(d.round, t.round);
      const standings = standingsOf(d.standings);
      for (const s of standings) if (s.eliminated && !t.fallen[s.lane]) fall(t, s.lane, round, '', '', '');
      const eliminated = eliminatedOf(d.eliminated, t);
      for (const e of standings.filter((s) => s.eliminated)) if (!eliminated.some((x) => x.lane === e.lane)) eliminated.push(...eliminatedOf(e.lane, t));
      const result: RoundResult = { round, standings, eliminated, awards: awardsOf(d.awards), lessons: Array.isArray(d.lessons) ? d.lessons : [], cases: Array.isArray(d.cases) ? d.cases : [] };
      if (typeof d.rule === 'string' && d.rule) t.rule = d.rule;
      const at = t.results.findIndex((r) => r.round === round);
      if (at >= 0) t.results[at] = result; else t.results.push(result);
      return true;
    }
    case 'awaiting_next': t.active = true; t.awaitingNext = true; if (t.phase !== 'ended') t.phase = 'review'; return true;
    case 'tournament_end': {
      t.active = true; t.phase = 'ended'; t.awaitingNext = false;
      const champ = laneList([d.champion])[0];
      t.champion = champ ?? (typeof d.champion === 'number' ? d.champion : null);
      t.awards = awardsOf(d.awards);
      t.casebookRef = str(d.casebookRef);
      return true;
    }
    case 'wave_start': if (t.active && t.phase === 'review') { t.phase = 'running'; t.awaitingNext = false; } return false;
    case 'reset': Object.assign(t, emptyTournament()); return true;
    default: return false;
  }
}

/** Late joiner (page load or reload): corpses from `state.corpses`, fallen from `state.lanes[].fallen`, rounds from `state.tournament` or `GET /api/tournament`. */
export function loadTournament(t: TournamentVM, s: { corpses?: unknown; lanes?: unknown; tournament?: unknown; awaitingNext?: unknown }, extra?: unknown): void {
  const fresh = emptyTournament();
  const lanes = Array.isArray(s.lanes) ? s.lanes : [];
  for (const x of lanes) {
    const r = rec(x);
    const f = rec(r.fallen);
    if (typeof r.lane === 'number') addRoster(fresh, [r.lane]);
    if (typeof r.lane === 'number' && Object.keys(f).length > 0) fall(fresh, r.lane, num(f.round), str(f.stage), str(f.cause), str(f.epitaph));
  }
  const corpses = Array.isArray(s.corpses) ? s.corpses : [];
  for (const x of corpses) {
    const r = rec(x);
    const lane = num(r.lane);
    if (lane <= 0) continue;
    const kind = r.kind === 'wall' ? 'wall' : 'eliminated';
    addCorpse(fresh, { lane, stage: str(r.stage), kind, round: num(r.round), epitaph: str(r.epitaph), cause: str(r.cause ?? fresh.fallen[lane]?.cause) });
    if (kind === 'eliminated' && !fresh.fallen[lane]) fresh.fallen[lane] = { round: num(r.round), stage: str(r.stage), cause: str(r.cause), epitaph: str(r.epitaph) };
    addRoster(fresh, [lane]);
  }
  const info = { ...rec(s.tournament), ...rec(extra) };
  const rounds = Array.isArray(info.history) ? info.history : Array.isArray(info.rounds) ? info.rounds.filter((x) => 'round' in rec(x)) : [];
  fresh.round = num(info.round, rounds.length > 0 ? num(rec(rounds[rounds.length - 1]).round, rounds.length) : 0);
  fresh.total = num(info.total, 0);
  if (typeof info.rule === 'string') fresh.rule = info.rule;
  fresh.orders = num(info.orders, 0);
  fresh.intensity = num(info.intensity, 0);
  fresh.live = laneList(info.alive ?? info.lanes ?? info.live);
  for (const x of rounds) {
    const r = rec(x);
    const round = num(r.round);
    if (round <= 0) continue;
    fresh.results.push({
      round, standings: standingsOf(r.standings), eliminated: eliminatedOf(r.eliminated, fresh), awards: awardsOf(r.awards),
      lessons: Array.isArray(r.lessons) ? r.lessons : [], cases: Array.isArray(r.cases) ? r.cases : [],
    });
  }
  if (info.awaitingNext === true || s.awaitingNext === true || info.phase === 'review' || info.phase === 'awaiting_next') { fresh.phase = 'review'; fresh.awaitingNext = true; }
  else if (info.phase === 'ended' || info.phase === 'done' || info.phase === 'over' || info.champion !== undefined) fresh.phase = 'ended';
  else if (fresh.round > 0) fresh.phase = 'running';
  if (info.champion !== undefined) { fresh.champion = laneList([info.champion])[0] ?? null; fresh.awards = awardsOf(info.awards); }
  fresh.active = fresh.round > 0 || fresh.corpses.length > 0 || Object.keys(fresh.fallen).length > 0 || info.active === true;
  Object.assign(t, fresh);
}

/** "Round 2 of 4, 4 lanes". Empty when no tournament is on. */
export function roundLabel(t: Pick<TournamentVM, 'active' | 'round' | 'total' | 'live' | 'phase'>): string {
  if (!t.active || t.round <= 0) return '';
  const lanes = t.live.length;
  const of = t.total > 0 ? ` of ${t.total}` : '';
  const ln = lanes > 0 ? `, ${lanes} ${lanes === 1 ? 'lane' : 'lanes'}` : '';
  return `Round ${t.round}${of}${ln}`;
}

/** Tie-break rule shown on the standings card (spec 3.2). */
export const TIE_BREAK_RULE = 'Lowest total resilience points drops. A tie goes to more lost orders, then more repeats, then lower average stars, then higher downtime, then the higher lane number.';

/** Why a lane dropped, in one line: the cause from the engine, else the points gap, else the tie-break rule. */
export function dropReason(r: RoundResult, lane: number, titleOf: (lane: number) => string = (n) => `Lane ${n}`): string {
  const e = r.eliminated.find((x) => x.lane === lane);
  const own = r.standings.find((s) => s.lane === lane);
  const others = r.standings.filter((s) => s.lane !== lane && !s.eliminated);
  const next = others.length ? others.reduce((a, b) => (a.rp <= b.rp ? a : b)) : null;
  const bits: string[] = [];
  if (e?.cause) bits.push(e.cause);
  if (own && next) {
    bits.push(own.rp === next.rp ? `tied on ${own.rp} points with ${titleOf(next.lane)}, decided by the tie-break` : `${own.rp} points, ${next.rp - own.rp} behind ${titleOf(next.lane)}`);
  }
  if (e?.stage) bits.push(`died at ${e.stage}`);
  return bits.length ? bits.join('; ') : 'lowest ranked lane';
}

/** Podium order for the final screen: champion first, then lanes by the round they fell (later is better). */
export function podiumOf(t: Pick<TournamentVM, 'champion' | 'fallen' | 'roster' | 'results'>): number[] {
  const out: number[] = [];
  if (t.champion !== null) out.push(t.champion);
  const last = t.results[t.results.length - 1];
  const rest = Object.entries(t.fallen).map(([lane, f]) => ({ lane: Number(lane), round: f.round, rp: last?.standings.find((s) => s.lane === Number(lane))?.rp ?? 0 }))
    .sort((a, b) => b.round - a.round || b.rp - a.rp || a.lane - b.lane);
  for (const f of rest) if (!out.includes(f.lane)) out.push(f.lane);
  // A champion that is not reported: the best live lane in the last standings.
  if (out.length === 0 && last) for (const s of last.standings) out.push(s.lane);
  return out;
}

/** Epitaph shown in the tooltip: the engine's text, else "Tier, died at Stage, round n: cause". */
export function epitaphOf(c: Corpse, title: string, stageLabel: string): string {
  if (c.epitaph) return c.epitaph;
  if (c.kind === 'wall') return `${title}: every order failed at ${stageLabel} in round ${c.round}. A wall.`;
  return `${title}, died at ${stageLabel}, round ${c.round}${c.cause ? `. Cause: ${c.cause}` : ''}.`;
}
