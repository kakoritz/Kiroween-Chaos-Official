// The tournament state machine (spec 3, V1_2 sections 2 and 3). Pure: `finishRound` takes the wave's events and returns the events
// to publish (`round_end`, `lane_eliminated`, `corpse`, `awaiting_next` or `tournament_end`). The live server and the mock fixtures
// both drive it, so they cannot drift apart.
import { TIERS, type TierId } from '../shared/catalog';
import { addRound, causeOf, diedAt, epitaph, laneRound, newCum, pickEliminated, standingOrder, wallOf, avgStars, type Cum, type Ev, type LaneRound } from './rp';
import { DEFAULT_ROUNDS, parseRounds, tierOfLane, type RoundCfg } from './rounds';
import { buildCasebook, computeAwards, type Award, type Casebook } from './casebook';
import type { Case } from './signature';

export interface Corpse { lane: number; stage: string; kind: 'eliminated' | 'wall'; round: number; epitaph: string; cause?: string }
export interface Fallen { round: number; stage: string; cause: string }

export interface Standing {
  lane: number;
  tier: TierId;
  rp: number;
  cumRp: number;
  rank: number;
  ok: number;
  lost: number;
  repeats: number;
  abandoned: number;
  downtimeMs: number;
  avgStars: number;
  issues: number;
  lessonsBonus: number;
  halted?: boolean;
  eliminated?: boolean;
}

export interface RoundResult {
  round: number;
  total: number;
  wave?: number;
  intensity: number;
  orders: number;
  lanes: number[];
  standings: Standing[];
  eliminated: number[];
  walls: Corpse[];
  /** The rule shown on the standings card. */
  rule: string;
}

export interface RoundStart { round: number; total: number; lanes: number[]; orders: number; intensity: number; seed: string | number }

export type Phase = 'idle' | 'running' | 'awaiting_next' | 'done';

export const TIE_RULE = 'Lowest cumulative RP drops. Ties: more lost orders, more repeats, lower average stars, higher downtime, lower lane number. A halted lane drops at once.';

export interface FinishExtras {
  /** +25 per new case overcome, by lane (capped at +200 here). */
  lessonsBonus?: Record<number, number>;
  /** Pass-through data for `round_end` (lessons learned, cases met, awards so far, the casebook). */
  lessons?: unknown[];
  cases?: unknown[];
  awards?: unknown;
  casebook?: unknown;
  /** "What each lane returned when the API lied" for the round (TV3-C9). */
  curseTable?: unknown[];
  wave?: number;
}

export class Tournament {
  readonly rounds: RoundCfg[];
  readonly seed: string | number;
  phase: Phase = 'idle';
  /** 1-based number of the round running or about to run; 0 before the first. */
  round = 0;
  alive: number[];
  readonly cum = new Map<number, Cum>();
  readonly history: RoundResult[] = [];
  readonly corpses: Corpse[] = [];
  readonly fallen = new Map<number, Fallen>();
  /** Lane that went down first (Wooden Spoon). */
  firstOut?: number;
  firstOutRound?: number;
  /** Every case met so far, and recovery times by lane, for the Casebook and the awards. */
  readonly cases: Case[] = [];
  private readonly recov = new Map<number, number[]>();
  champion?: number;

  constructor(o: { seed: string | number; rounds?: RoundCfg[] | unknown; lanes?: number }) {
    this.seed = o.seed;
    this.rounds = parseRounds(o.rounds);
    const n = Math.min(5, Math.max(2, o.lanes ?? this.rounds[0]?.lanes ?? 5));
    this.alive = Array.from({ length: n }, (_, i) => i + 1);
    for (const l of this.alive) this.cum.set(l, newCum(l, tierOfLane(l)));
  }

  get total(): number { return this.rounds.length; }

  cfgOf(round: number): RoundCfg { return this.rounds[round - 1] ?? DEFAULT_ROUNDS.at(-1)!; }

  /** Start the next round: the live lanes are the survivors. */
  beginRound(): RoundStart {
    if (this.phase === 'running') throw new Error('a round is running');
    if (this.phase === 'done') throw new Error('the tournament is over');
    this.round++;
    this.phase = 'running';
    const cfg = this.cfgOf(this.round);
    return { round: this.round, total: this.total, lanes: [...this.alive], orders: cfg.orders, intensity: cfg.intensity, seed: this.seed };
  }

  /** Close the running round. Returns the events to publish, in order. */
  finishRound(events: readonly Ev[], extras: FinishExtras = {}): Ev[] {
    if (this.phase !== 'running') throw new Error('no round is running');
    const cfg = this.cfgOf(this.round);
    const rounds: LaneRound[] = this.alive.map((l) => laneRound(events, l, tierOfLane(l), cfg.orders, extras.lessonsBonus?.[l] ?? 0));
    for (const r of rounds) { addRound(this.cum.get(r.lane)!, r); this.recov.set(r.lane, [...(this.recov.get(r.lane) ?? []), ...r.recoveryMs]); }
    this.cases.push(...((extras.cases ?? []) as Case[]));
    const order = standingOrder(this.alive.map((l) => this.cum.get(l)!));
    const halted = new Set(rounds.filter((r) => r.halted).map((r) => r.lane));
    const last = this.round >= this.total;
    const out = pickEliminated(order, halted);
    // The final round (or the last two lanes) names the champion: the lane that stays.
    const eliminated = this.alive.length <= 1 ? [] : out;
    const byLane = new Map(rounds.map((r) => [r.lane, r]));

    const standings: Standing[] = order.map((c, i) => {
      const r = byLane.get(c.lane)!;
      return {
        lane: c.lane, tier: c.tier, rp: r.rp, cumRp: c.rp, rank: i + 1, ok: r.ok, lost: r.lost, repeats: r.repeats, abandoned: r.abandoned,
        downtimeMs: r.downtimeMs, avgStars: Math.round(avgStars(c) * 100) / 100, issues: r.issues, lessonsBonus: r.lessonsBonus,
        ...(r.halted ? { halted: true } : {}), ...(eliminated.includes(c.lane) ? { eliminated: true } : {}),
      };
    });

    const walls: Corpse[] = [];
    for (const r of rounds) {
      const w = wallOf(r);
      if (w) walls.push({ lane: r.lane, stage: w, kind: 'wall', round: this.round, epitaph: epitaph(r, w, this.round, causeOf(r), 'wall'), cause: causeOf(r) });
    }
    const out_: Ev[] = [];
    const result: RoundResult = { round: this.round, total: this.total, ...(extras.wave !== undefined ? { wave: extras.wave } : {}), intensity: cfg.intensity, orders: cfg.orders, lanes: [...this.alive], standings, eliminated, walls, rule: TIE_RULE };
    this.history.push(result);

    const roundEnd: Ev = {
      type: 'round_end',
      detail: {
        round: this.round, total: this.total, standings: standings.map((s) => ({ ...s })),
        ...(eliminated.length ? { eliminated: eliminated[0], eliminatedLanes: eliminated } : {}),
        rule: TIE_RULE, lessons: extras.lessons ?? [], cases: extras.cases ?? [], curseTable: extras.curseTable ?? [],
      },
    };
    out_.push(roundEnd);
    for (const w of walls) { this.corpses.push(w); out_.push({ type: 'corpse', lane: w.lane, stage: w.stage, detail: { lane: w.lane, stage: w.stage, kind: 'wall', round: w.round, epitaph: w.epitaph } }); }
    for (const l of eliminated) {
      const r = byLane.get(l)!;
      const stage = diedAt(r, events);
      const cause = causeOf(r);
      const ep = epitaph(r, stage, this.round, cause);
      this.fallen.set(l, { round: this.round, stage, cause });
      if (this.firstOut === undefined) { this.firstOut = l; this.firstOutRound = this.round; }
      const c: Corpse = { lane: l, stage, kind: 'eliminated', round: this.round, epitaph: ep, cause };
      this.corpses.push(c);
      out_.push({ type: 'lane_eliminated', lane: l, stage, detail: { lane: l, round: this.round, stage, cause, epitaph: ep } });
      out_.push({ type: 'corpse', lane: l, stage, detail: { lane: l, stage, kind: 'eliminated', round: this.round, epitaph: ep } });
    }
    this.alive = this.alive.filter((l) => !eliminated.includes(l));

    if (this.alive.length <= 1 || last) {
      // The best of the lanes still standing wins.
      const best = standingOrder(this.alive.map((l) => this.cum.get(l)!))[0]!;
      this.champion = best.lane;
      this.phase = 'done';
    } else {
      this.phase = 'awaiting_next';
    }
    // The Casebook is always produced, also when the champion had no issues; awards are as of this round (Champion once there is one).
    roundEnd.detail!.casebook = this.casebook();
    roundEnd.detail!.awards = this.awards();
    if (this.phase === 'awaiting_next') out_.push({ type: 'awaiting_next', detail: { round: this.round, next: this.round + 1 } });
    return out_;
  }

  casebook(): Casebook { return buildCasebook(this.cases, this.history.length); }

  awards(): Award[] {
    return computeAwards({
      ...(this.champion !== undefined ? { champion: this.champion } : {}), cases: this.cases,
      repeats: new Map([...this.cum].map(([l, c]) => [l, c.repeats])), rp: new Map([...this.cum].map(([l, c]) => [l, c.rp])), recoveries: this.recov,
      ...(this.firstOut !== undefined ? { firstOut: this.firstOut, firstOutRound: this.firstOutRound } : {}),
    });
  }

  /** The closing event once the champion is known. */
  endEvent(extra: Record<string, unknown> = {}): Ev {
    return { type: 'tournament_end', detail: { champion: this.champion, tier: this.champion ? TIERS[tierOfLane(this.champion)].label : undefined, rounds: this.history.length, awards: this.awards(), casebook: this.casebook(), casebookRef: '/api/casebook', ...extra } };
  }

  /** `GET /api/tournament`. */
  view(): Record<string, unknown> {
    return {
      seed: this.seed, phase: this.phase, round: this.round, total: this.total, rounds: this.rounds, alive: [...this.alive],
      standings: this.history.at(-1)?.standings ?? [], history: this.history, corpses: [...this.corpses],
      fallen: Object.fromEntries(this.fallen), ...(this.champion !== undefined ? { champion: this.champion } : {}),
      awards: this.awards(), casebook: this.casebook(),
      cumulative: [...this.cum.values()].map((c) => ({ ...c, avgStars: Math.round(avgStars(c) * 100) / 100 })),
    };
  }
}
