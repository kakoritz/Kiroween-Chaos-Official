// TV3-C7: tournament engine (spec 3, V1_2 sections 2 and 3).
import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUNDS, RP, Tournament, avgStars, laneRound, parseRounds, pickEliminated, roundPlan, standingOrder, tierOfLane, wallOf, newCum, type Cum, type Ev } from '../src/tournament';
import { validateEvents } from '../src/contract/validate';
import { mockTournament } from '../../core/src/sim/tournament-fixtures';

const ev = (type: string, lane: number, detail: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Ev => ({ type, lane, detail, ...extra });

/** A lane's round: `ok` orders done, plus whatever else is given. */
function laneEvents(lane: number, o: { ok?: number; lost?: number; repeats?: number; abandoned?: number; downtime?: number; reviews?: number[]; halted?: boolean; failStage?: string } = {}): Ev[] {
  const out: Ev[] = [];
  for (let i = 0; i < (o.ok ?? 0); i++) out.push(ev('order_done', lane, { lap: { downtimeMs: 0 } }, { order: `ord-${i + 1}` }));
  for (let i = 0; i < (o.lost ?? 0); i++) out.push(ev('order_failed', lane, { stage: o.failStage ?? 'payment' }, { order: `ord-f${i}`, stage: o.failStage ?? 'payment' }));
  for (let i = 0; i < (o.repeats ?? 0); i++) out.push(ev('repeat', lane, { kind: 'charge' }));
  for (let i = 0; i < (o.abandoned ?? 0); i++) out.push(ev('order_abandoned', lane));
  if (o.downtime) out.push(ev('score', lane, { delta: -o.downtime, reason: 'downtime' }));
  for (const s of o.reviews ?? []) { out.push(ev('review', lane, { stars: s })); out.push(ev('score', lane, { delta: (s - 3) * 40, reason: 'review' })); }
  if (o.halted) out.push(ev('lane_halted', lane, { reason: 'x' }));
  return out;
}

describe('RP formula (spec 3.2)', () => {
  it('ok x 100 - lost x 300 - repeats x 150 - abandoned x 150 - downtime + reviews + lessons', () => {
    const r = laneRound(laneEvents(1, { ok: 5, lost: 1, repeats: 2, abandoned: 1, downtime: 120, reviews: [5, 4, 2] }), 1, 'rookie', 7, 50);
    expect(r).toMatchObject({ ok: 5, lost: 1, repeats: 2, abandoned: 1, downtimePenalty: 120, reviewPoints: 80 + 40 - 40, lessonsBonus: 50 });
    expect(r.rp).toBe(500 - 300 - 300 - 150 - 120 + 80 + 50);
    expect(RP).toMatchObject({ ok: 100, lost: 300, repeat: 150, abandoned: 150 });
  });

  it('the lessons bonus is capped at +200 per round and never negative', () => {
    expect(laneRound([], 1, 'rookie', 3, 900).lessonsBonus).toBe(200);
    expect(laneRound([], 1, 'rookie', 3, -5).lessonsBonus).toBe(0);
  });

  it('a lane that failed every order is halted, one that finished at least one is not', () => {
    expect(laneRound(laneEvents(1, { lost: 4 }), 1, 'rookie', 4).halted).toBe(true);
    expect(laneRound(laneEvents(1, { ok: 1, lost: 3 }), 1, 'rookie', 4).halted).toBe(false);
    expect(laneRound(laneEvents(1, { ok: 3, halted: true }), 1, 'rookie', 4).halted).toBe(true);
  });

  it('only counts the lane asked for', () => {
    const evs = [...laneEvents(1, { ok: 2 }), ...laneEvents(2, { ok: 4 })];
    expect(laneRound(evs, 2, 'retrier', 4).ok).toBe(4);
  });
});

describe('standing, tie-breaks and elimination', () => {
  const cum = (lane: number, o: Partial<Cum>): Cum => ({ ...newCum(lane, tierOfLane(lane)), ...o });

  it('lowest cumulative RP drops', () => {
    const order = standingOrder([cum(1, { rp: 300 }), cum(2, { rp: 100 }), cum(3, { rp: 500 })]);
    expect(order.map((c) => c.lane)).toEqual([3, 1, 2]);
    expect(pickEliminated(order, new Set())).toEqual([2]);
  });

  it('ties: more lost, then more repeats, then lower stars, then higher downtime, then lower lane number is worse', () => {
    const worst = (cs: Cum[]) => standingOrder(cs).at(-1)!.lane;
    expect(worst([cum(1, { rp: 100, lost: 1 }), cum(2, { rp: 100, lost: 2 })])).toBe(2);
    expect(worst([cum(1, { rp: 100, lost: 1, repeats: 1 }), cum(2, { rp: 100, lost: 1, repeats: 3 })])).toBe(2);
    expect(worst([cum(1, { rp: 100, starsSum: 8, reviews: 2 }), cum(2, { rp: 100, starsSum: 6, reviews: 2 })])).toBe(2);
    expect(avgStars(cum(1, { starsSum: 9, reviews: 3 }))).toBe(3);
    expect(worst([cum(1, { rp: 100, downtimeMs: 500 }), cum(2, { rp: 100, downtimeMs: 900 })])).toBe(2);
    expect(worst([cum(3, { rp: 100 }), cum(2, { rp: 100 })])).toBe(2);
  });

  it('a halted lane drops at once even if not lowest; never the whole field', () => {
    const order = standingOrder([cum(1, { rp: 900 }), cum(2, { rp: 100 }), cum(3, { rp: 500 })]);
    expect(pickEliminated(order, new Set([1]))).toEqual([1]);
    expect(pickEliminated(order, new Set([1, 2, 3])).length).toBe(2);
    expect(pickEliminated(standingOrder([cum(5, { rp: 1 })]), new Set())).toEqual([]);
  });

  it('a wall is every order failing an attempt at one stage', () => {
    const evs = [1, 2, 3].flatMap((n) => [ev('stage_fail', 2, { error: 'x' }, { order: `ord-${n}`, stage: 'payment' }), ev('stage_fail', 2, { error: 'x' }, { order: `ord-${n}`, stage: 'payment' })]);
    expect(wallOf(laneRound([...evs, ...laneEvents(2, { ok: 3 })], 2, 'retrier', 3))).toBe('payment');
    expect(wallOf(laneRound(evs.slice(0, 4), 2, 'retrier', 3))).toBeNull();
    expect(wallOf(laneRound([ev('stage_fail', 2, {}, { order: 'ord-1', stage: 'payment' })], 2, 'retrier', 1))).toBeNull();
  });
});

describe('Tournament state machine', () => {
  const play = (t: Tournament, ok: (lane: number, round: number) => number, orders?: number) => {
    const rs = t.beginRound();
    const evs = rs.lanes.flatMap((l) => laneEvents(l, { ok: ok(l, rs.round) }));
    void orders;
    return t.finishRound(evs, { wave: rs.round });
  };

  it('default rounds are 5, 4, 3, 2 lanes, 6, 8, 10, 12 orders, intensity 3, 5, 7, 9', () => {
    expect(DEFAULT_ROUNDS.map((r) => [r.lanes, r.orders, r.intensity])).toEqual([[5, 6, 3], [4, 8, 5], [3, 10, 7], [2, 12, 9]]);
    expect(parseRounds(undefined)).toEqual([...DEFAULT_ROUNDS]);
    expect(() => parseRounds([{ lanes: 9 }])).toThrow(/lanes/);
    expect(() => parseRounds([{ intensity: 12 }])).toThrow(/intensity/);
    expect(() => parseRounds([])).toThrow();
  });

  it('one lane drops per round down to a champion; the best lane wins', () => {
    const t = new Tournament({ seed: 7 });
    const dropped: number[] = [];
    for (let r = 1; r <= 4; r++) {
      const out = play(t, (l) => l * 2);
      const end = out.find((e) => e.type === 'round_end')!;
      dropped.push(end.detail!.eliminated);
      expect(out.some((e) => e.type === 'lane_eliminated')).toBe(true);
      expect(out.at(-1)!.type).toBe(r < 4 ? 'awaiting_next' : 'corpse');
    }
    expect(dropped).toEqual([1, 2, 3, 4]);
    expect(t.phase).toBe('done');
    expect(t.champion).toBe(5);
    expect(t.alive).toEqual([5]);
    expect(t.endEvent().detail).toMatchObject({ champion: 5, rounds: 4 });
    expect(t.firstOut).toBe(1);
    expect(t.corpses.map((c) => c.lane)).toEqual([1, 2, 3, 4]);
  });

  it('round_end carries standings (rank, rp, cumulative), the rule and the eliminated lane; lanes that fell are not live next round', () => {
    const t = new Tournament({ seed: 7 });
    const out = play(t, (l) => l);
    const d = out[0]!.detail!;
    expect(d.standings.map((s: { lane: number }) => s.lane)).toEqual([5, 4, 3, 2, 1]);
    expect(d.standings.map((s: { rank: number }) => s.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(d.standings[4]).toMatchObject({ lane: 1, rp: 100, cumRp: 100, eliminated: true });
    expect(d.rule).toMatch(/Lowest cumulative RP/);
    expect(t.beginRound().lanes).toEqual([2, 3, 4, 5]);
  });

  it('cumulative RP decides, not the last round alone', () => {
    const t = new Tournament({ seed: 7 });
    play(t, (l) => (l === 5 ? 6 : l === 1 ? 0 : 3)); // lane 1 drops
    play(t, (l) => (l === 2 ? 8 : 1)); // lane 2 had 300 after round 1 and now 800: lane 3 (300 + 100) drops
    expect(t.alive).toEqual([2, 4, 5]);
  });

  it('a halted lane drops at once, with the wall and halt reasons in the corpse', () => {
    const t = new Tournament({ seed: 7 });
    const rs = t.beginRound();
    const evs = [...laneEvents(1, { ok: 6 }), ...laneEvents(2, { ok: 6 }), ...laneEvents(3, { lost: 6, failStage: 'payment' }), ...laneEvents(4, { ok: 6 }), ...laneEvents(5, { ok: 6 })];
    const out = t.finishRound(evs, { wave: 1 });
    expect(out.find((e) => e.type === 'lane_eliminated')!.detail).toMatchObject({ lane: 3, round: 1, stage: 'payment' });
    expect(out.find((e) => e.type === 'lane_eliminated')!.detail!.epitaph).toMatch(/^Journaler, died at Payment, round 1: 6 cancelled orders\. Cause: /);
    expect(rs.lanes).toHaveLength(5);
  });

  it('stops asking: cannot begin while running or after the end, and finishRound needs a running round', () => {
    const t = new Tournament({ seed: 7 });
    expect(() => t.finishRound([])).toThrow();
    t.beginRound();
    expect(() => t.beginRound()).toThrow(/running/);
  });

  it('fewer rounds than lanes: the best lane standing wins after the last round', () => {
    const t = new Tournament({ seed: 7, rounds: [{ lanes: 5, orders: 4, intensity: 3 }, { lanes: 4, orders: 4, intensity: 3 }] });
    play(t, (l) => l); play(t, (l) => l);
    expect(t.phase).toBe('done');
    expect(t.champion).toBe(5);
    expect(t.alive.length).toBe(3);
  });
});

describe('the seeded storm', () => {
  it('is the same for the same seed and round, differs by seed and round, and follows the level', () => {
    const cfg = { lanes: 5, orders: 12, intensity: 7 };
    expect(roundPlan(7, 2, cfg)).toEqual(roundPlan(7, 2, cfg));
    expect(roundPlan(7, 2, cfg)).not.toEqual(roundPlan(8, 2, cfg));
    expect(roundPlan(7, 2, cfg)).not.toEqual(roundPlan(7, 3, cfg));
    const n = (level: number) => roundPlan(7, 1, { lanes: 5, orders: 40, intensity: level }).length;
    expect(n(1)).toBeLessThan(n(5));
    expect(n(5)).toBeLessThan(n(10));
    for (const p of roundPlan(7, 1, cfg)) { expect(p.order).toBeGreaterThanOrEqual(1); expect(p.order).toBeLessThanOrEqual(12); }
  });

  it('windows are drawn once per press, so every lane gets the same length', () => {
    const plan = roundPlan(7, 1, { lanes: 5, orders: 40, intensity: 10 });
    const outages = plan.filter((p) => p.outageMs !== undefined);
    expect(outages.length).toBeGreaterThan(0);
    expect(outages.every((p) => p.outageMs! >= 80 && p.outageMs! <= 30000)).toBe(true);
  });
});

describe('mock tournament stream', () => {
  const ev4 = mockTournament();

  it('is a valid contract stream with round_start, round_end, lane_eliminated, corpse, awaiting_next and tournament_end', () => {
    expect(validateEvents(ev4)).toEqual([]);
    const types = ev4.map((e) => e.type);
    expect(types.filter((x) => x === 'round_start')).toHaveLength(4);
    expect(types.filter((x) => x === 'awaiting_next')).toHaveLength(3);
    expect(types.filter((x) => x === 'tournament_end')).toHaveLength(1);
    expect(ev4.filter((e) => e.type === 'lane_eliminated').map((e) => e.lane)).toEqual([1, 2, 3, 4]);
  });

  it('eliminated lanes emit nothing in later rounds (rule 50) and nothing starts between awaiting_next and the next round_start (rule 49)', () => {
    let waiting = false;
    const fallen = new Set<number>();
    for (const e of ev4) {
      if (e.type === 'awaiting_next') waiting = true;
      if (e.type === 'wave_start') waiting = false;
      if (e.type === 'lane_eliminated') fallen.add(e.lane as number);
      if (waiting) expect(['order_start', 'stage_start']).not.toContain(e.type);
      if (e.lane !== undefined && fallen.has(e.lane as number) && e.type !== 'lane_eliminated' && e.type !== 'corpse') expect.fail(`fallen lane ${e.lane} emitted ${e.type}`);
    }
  });

  it('the validator rejects a champion that fell, a round_end for the wrong round and orders while waiting', () => {
    const bad = (mut: (list: typeof ev4) => void) => { const list = ev4.map((e) => ({ ...e, detail: e.detail ? { ...e.detail } : e.detail })); mut(list); return validateEvents(list as never).map((v) => v.rule); };
    expect(bad((l) => { l.find((e) => e.type === 'tournament_end')!.detail!.champion = 1; })).toContain('R61');
    expect(bad((l) => { l.find((e) => e.type === 'round_end')!.detail!.round = 3; })).toContain('R57');
    expect(bad((l) => { const i = l.findIndex((e) => e.type === 'awaiting_next'); l.splice(i + 1, 0, { ...l.find((e) => e.type === 'order_start')!, seq: 0 }); })).toContain('R60');
    expect(bad((l) => { l.find((e) => e.type === 'lane_eliminated')!.lane = 4; l.find((e) => e.type === 'lane_eliminated')!.detail!.lane = 4; })).toContain('R59');
  });
});
