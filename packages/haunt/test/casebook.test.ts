// TV3-C10: Casebook and awards (spec 3.4, V1_2 section 5).
import { describe, expect, it } from 'vitest';
import { buildCasebook, caseEvents, computeAwards } from '../src/tournament/casebook';
import type { Case } from '../src/tournament/signature';
import { Tournament } from '../src/tournament';
import type { Ev } from '../src/tournament/rp';
import { validateEvents } from '../src/contract/validate';
import { mockTournament } from '../../core/src/sim/tournament-fixtures';

const c = (o: Partial<Case>): Case => ({ signature: 'payment + endpoint_down + recovered', stage: 'payment', fault: 'endpoint_down', consequence: 'recovered', lane: 5, round: 1, order: 'ord-0001', outcome: 'solved', mechanism: 'retry_backoff', costMs: 1000, costPoints: 0, ...o });
const LOST = { signature: 'payment + endpoint_down + order_lost', consequence: 'order_lost' as const, outcome: 'lost' as const, mechanism: 'none' as const };

describe('Casebook', () => {
  it('one row per signature: lanes that met it, who solved it and how, cost, status and the recommended fix', () => {
    const book = buildCasebook([
      c({ lane: 3, round: 1, order: 'ord-0002', costMs: 800 }), c({ lane: 5, round: 2, costMs: 200, mechanism: 'retry' }), c({ lane: 2, ...LOST, costPoints: 300 }),
      c({ ...LOST, lane: 1, round: 2, order: 'ord-0005', costPoints: 300 }),
    ], 2);
    expect(book.rounds).toBe(2);
    const solved = book.cases.find((r) => r.signature === 'payment + endpoint_down + recovered')!;
    expect(solved).toMatchObject({ status: 'solved', lanes: [{ lane: 3, outcome: 'solved', mechanism: 'retry_backoff' }, { lane: 5, outcome: 'solved', mechanism: 'retry' }], met: 2, firstSeen: { round: 1, order: 'ord-0002', lane: 3 }, cost: { downtimeMs: 1000, points: 0 } });
    expect(solved.solvedBy.map((s) => [s.lane, s.tier, s.mechanism])).toEqual([[3, 'journaler', 'retry_backoff'], [5, 'phoenix', 'retry']]);
    expect(solved.recommendedFix).toMatchObject({ part: 'retry', action: 'retry_backoff' });
    const open = book.cases.find((r) => r.signature === LOST.signature)!;
    expect(open).toMatchObject({ status: 'open', lanes: [{ lane: 1, outcome: 'lost' }, { lane: 2, outcome: 'lost' }], outcomes: { solved: 0, partly: 0, lost: 2 }, cost: { points: 600 } });
    expect(open.recommendedFix).toEqual({ action: 'retry_backoff', part: 'retry', rule: 'R2' });
    expect(book.open).toEqual([LOST.signature]);
    // Open cases come first: they go straight to the fix spec.
    expect(book.cases[0]!.status).toBe('open');
  });

  it('is produced even when nothing went wrong', () => {
    const book = buildCasebook([], 4);
    expect(book).toMatchObject({ rounds: 4, cases: [], open: [] });
    expect(book.note).toMatch(/No edge cases this time/);
  });

  it('marks an unknown fault with its fingerprint; a case only absorbed is absorbed, not solved, and needs no part', () => {
    const book = buildCasebook([c({ unknown: true, fingerprint: 'fz-0000beef' }), c({ signature: 'ship + slow_link + absorbed', consequence: 'absorbed', mechanism: 'absorbed', stage: 'ship', fault: 'slow_link' })], 1);
    expect(book.cases.find((r) => r.fingerprint)).toMatchObject({ unknown: true, fingerprint: 'fz-0000beef' });
    const absorbed = book.cases.find((r) => r.signature.includes('absorbed'))!;
    expect(absorbed.status).toBe('absorbed');
    expect(absorbed.lanes).toEqual([{ lane: 5, outcome: 'absorbed', mechanism: 'absorbed' }]);
    expect(absorbed.solvedBy).toEqual([]);
    expect(book.open).toEqual([]);
    expect(absorbed.recommendedFix).toEqual({ part: 'none', mechanism: 'absorbed' });
  });

  it('per-lane outcomes: lanes that met a case and did not solve it are not all lost', () => {
    const sig = { signature: 'payment + endpoint_down + mixed' };
    const book = buildCasebook([
      c({ ...sig, lane: 2, outcome: 'partly', mechanism: 'none', consequence: 'order_lost' }), c({ ...sig, lane: 3, ...{ outcome: 'lost', mechanism: 'none' } }),
      c({ ...sig, lane: 4, outcome: 'solved', mechanism: 'retry_backoff' }), c({ ...sig, lane: 4, outcome: 'lost', mechanism: 'none', order: 'ord-0009' }),
      c({ ...sig, lane: 5, outcome: 'solved', mechanism: 'absorbed' }),
    ], 1);
    expect(book.cases[0]!.lanes).toEqual([
      { lane: 2, outcome: 'partly' }, { lane: 3, outcome: 'lost' }, { lane: 4, outcome: 'partly', mechanism: 'retry_backoff' }, { lane: 5, outcome: 'absorbed', mechanism: 'absorbed' },
    ]);
    // The absorbed lane is not a solver.
    expect(book.cases[0]!.solvedBy.map((x) => x.lane)).toEqual([4]);
  });

  it('case events: one per lane and signature per round, with a count', () => {
    const evs = caseEvents([c({}), c({ order: 'ord-0002' }), c({ lane: 3 }), c({ ...LOST })]);
    expect(evs).toHaveLength(3);
    expect(evs[0]).toMatchObject({ type: 'case', lane: 5, stage: 'payment', detail: { signature: 'payment + endpoint_down + recovered', count: 2, outcome: 'solved', mechanism: 'retry_backoff', costMs: 1000 } });
    expect(evs.find((e) => e.detail.outcome === 'lost')!.detail.mechanism).toBeUndefined();
  });
});

describe('awards', () => {
  const base = { rp: new Map([[1, 100], [2, 300], [3, 200]]), repeats: new Map([[1, 4], [2, 1], [3, 1]]), recoveries: new Map<number, number[]>([[1, [900, 800]], [2, [300, 500, 100]], [3, [250]]]) };

  it('Champion, Battle-Tested, Iron Skeleton, Fastest Recovery and Wooden Spoon', () => {
    const cases = [c({ lane: 3 }), c({ lane: 3, signature: 'a + b + recovered' }), c({ lane: 2 }), c({ lane: 1, ...LOST })];
    const a = computeAwards({ ...base, champion: 2, cases, firstOut: 1, firstOutRound: 1 });
    const by = Object.fromEntries(a.map((x) => [x.id, x]));
    expect(by.champion).toMatchObject({ lane: 2, tier: 'retrier' });
    expect(by.battle_tested).toMatchObject({ lane: 3, value: 2 });
    expect(by.iron_skeleton).toMatchObject({ lane: 2, value: 1 }); // lane 2 and 3 tie on repeats, lane 2 has the higher RP
    expect(by.fastest_recovery).toMatchObject({ lane: 3, value: 250 }); // p50 of lane 2 is 300
    expect(by.wooden_spoon).toMatchObject({ lane: 1 });
    expect(by.wooden_spoon!.text).toMatch(/round 1/);
  });

  it('Battle-Tested ignores absorbed cases and Fastest Recovery ignores lanes with 0 ms or no recovery', () => {
    const a = computeAwards({ rp: new Map([[1, 10], [2, 20], [3, 30]]), repeats: new Map([[1, 0], [2, 0], [3, 0]]), recoveries: new Map<number, number[]>([[1, [0, 0]], [2, []], [3, [700, 900]]]),
      cases: [c({ lane: 1, mechanism: 'absorbed' }), c({ lane: 3, signature: 'x + y + recovered' })] });
    const by = Object.fromEntries(a.map((x) => [x.id, x]));
    expect(by.battle_tested).toMatchObject({ lane: 3, value: 1 });
    expect(by.fastest_recovery).toMatchObject({ lane: 3, value: 800 });
    expect(computeAwards({ rp: new Map([[1, 10]]), repeats: new Map([[1, 0]]), recoveries: new Map([[1, [0]]]), cases: [] }).some((x) => x.id === 'fastest_recovery')).toBe(false);
  });

  it('no Champion until there is one, and awards that need data are left out without it', () => {
    const a = computeAwards({ rp: new Map([[1, 0]]), repeats: new Map([[1, 0]]), recoveries: new Map(), cases: [] });
    expect(a.map((x) => x.id)).toEqual(['iron_skeleton']);
  });
});

describe('Tournament carries the Casebook and the awards', () => {
  const evs = (lane: number, ok: number): Ev[] => Array.from({ length: ok }, (_, i) => ({ type: 'order_done', lane, order: `ord-${i + 1}`, detail: {} }));

  it('round_end includes the Casebook and the awards so far; tournament_end the final ones; the Casebook exists with no cases at all', () => {
    const t = new Tournament({ seed: 7, rounds: [{ lanes: 5, orders: 4, intensity: 3 }, { lanes: 4, orders: 4, intensity: 3 }] });
    let rs = t.beginRound();
    const out1 = t.finishRound(rs.lanes.flatMap((l) => evs(l, l)), { cases: [c({ lane: 5 }), c({ lane: 1, ...LOST })] });
    const re1 = out1[0]!.detail!;
    expect(re1.casebook.cases).toHaveLength(2);
    expect(re1.awards.map((a: { id: string }) => a.id)).toEqual(expect.arrayContaining(['battle_tested', 'iron_skeleton', 'wooden_spoon']));
    expect(re1.awards.some((a: { id: string }) => a.id === 'champion')).toBe(false);
    rs = t.beginRound();
    const out2 = t.finishRound(rs.lanes.flatMap((l) => evs(l, l)), {});
    expect(out2[0]!.detail!.casebook.cases).toHaveLength(2);
    const end = t.endEvent().detail!;
    expect(end.champion).toBe(5);
    expect(end.awards.find((a: { id: string }) => a.id === 'champion')).toMatchObject({ lane: 5 });
    expect(end.casebook.rounds).toBe(2);
    expect(t.view()).toMatchObject({ casebook: { rounds: 2 }, awards: expect.any(Array) });

    const quiet = new Tournament({ seed: 7, rounds: [{ lanes: 3, orders: 2, intensity: 1 }] });
    quiet.beginRound();
    quiet.finishRound([1, 2, 3].flatMap((l) => evs(l, 2 + l)), {});
    expect(quiet.endEvent().detail!.casebook).toMatchObject({ cases: [], open: [] });
    expect(quiet.endEvent().detail!.casebook.note).toMatch(/Casebook is still kept/);
  });
});

describe('mock stream and validator', () => {
  const ev = mockTournament();

  it('has case events, a Casebook in every round_end and awards at the end, and validates', () => {
    expect(validateEvents(ev)).toEqual([]);
    expect(ev.filter((e) => e.type === 'case').length).toBeGreaterThan(10);
    for (const r of ev.filter((e) => e.type === 'round_end')) expect((r.detail!.casebook as { cases: unknown[] }).cases.length).toBeGreaterThan(0);
    const end = ev.find((e) => e.type === 'tournament_end')!;
    expect((end.detail!.awards as { id: string }[]).map((a) => a.id)).toEqual(['champion', 'battle_tested', 'iron_skeleton', 'fastest_recovery', 'wooden_spoon']);
    expect(end.detail!.casebookRef).toBe('/api/casebook');
  });

  it('the validator rejects a case with a bad outcome or signature (rule 63)', () => {
    const run = (mut: (l: typeof ev) => void) => { const copy = ev.map((x) => ({ ...x, detail: x.detail ? { ...x.detail } : x.detail })); mut(copy); return validateEvents(copy as never).map((v) => v.rule); };
    expect(run((l) => { l.find((x) => x.type === 'case')!.detail!.outcome = 'meh'; })).toContain('R63');
    expect(run((l) => { l.find((x) => x.type === 'case')!.detail!.signature = 'payment'; })).toContain('R63');
  });
});
