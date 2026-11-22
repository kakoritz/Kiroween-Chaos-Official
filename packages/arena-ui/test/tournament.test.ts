import { describe, expect, it } from 'vitest';
import { applyTournamentEvent, dropReason, emptyTournament, epitaphOf, laneList, loadTournament, podiumOf, roundLabel, standingsOf } from '../src/arena/tournament';
import { applyEvent, emptyVM, loadSnapshot, stationX } from '../src/arena/model';
import { chipTipAt } from '../src/arena/chiptip';
import { drawTombstone, drawWallCorpse, drawWisp, tombHeight } from '../src/arena/corpse';
import { ArenaScene, laneBoxes } from '../src/arena/scene';

const STAGES = ['account', 'create', 'submit', 'payment', 'confirmation', 'receive', 'process', 'updates', 'ship', 'transit', 'handoff'];
const lane = (n: number, extra: Record<string, unknown> = {}) => ({ lane: n, tier: ['rookie', 'retrier', 'journaler', 'reconciler', 'phoenix'][n - 1], label: ['Rookie', 'Retrier', 'Journaler', 'Reconciler', 'Phoenix'][n - 1], state: 'idle', order: null, stage: null, stageIndex: 0, orderIndex: 0, ordersTotal: 6, score: 0, counts: { completed: 0, failed: 0, parked: 0, quarantined: 0, repeats: 0 }, depth: 0, parts: [], ...extra });
const snapshot = (extra: Record<string, unknown> = {}, lanes = [1, 2, 3, 4, 5].map((n) => lane(n))) => ({ app: 'orders', stages: STAGES.map((id) => ({ id, label: id[0]!.toUpperCase() + id.slice(1), icon: '', workAnimation: 'think' })), lanes, wave: { n: 1, running: true, speed: 1, seed: 1, orders: 6, tiers: 'race', startedAt: 0 }, ...extra }) as never;
const ev = (type: string, detail: Record<string, unknown> = {}, o: Record<string, unknown> = {}) => ({ seq: 1, ts: 1, type, detail, ...o });

class FakePath { constructor(public d?: string) {} addPath(): void {} ellipse(): void {} roundRect(): void {} rect(): void {} moveTo(): void {} lineTo(): void {} arc(): void {} closePath(): void {} quadraticCurveTo(): void {} bezierCurveTo(): void {} }
(globalThis as Record<string, unknown>).Path2D = FakePath;

const chain = (): CanvasRenderingContext2D => {
  const fn: unknown = new Proxy(function () {}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 40 }) : fn), set: () => true, apply: () => fn });
  return fn as CanvasRenderingContext2D;
};

describe('tournament model (TV3-U8)', () => {
  it('reads round_start into the header label', () => {
    const t = emptyTournament();
    expect(roundLabel(t)).toBe('');
    applyTournamentEvent(t, ev('round_start', { round: 2, total: 4, lanes: [1, 2, 4, 5], orders: 8, intensity: 5, seed: 3 }));
    expect(t).toMatchObject({ active: true, phase: 'running', round: 2, total: 4, orders: 8, intensity: 5 });
    expect(roundLabel(t)).toBe('Round 2 of 4, 4 lanes');
    applyTournamentEvent(t, ev('round_start', { round: 4, total: 4, lanes: [{ lane: 1 }, { lane: 5 }] }));
    expect(roundLabel(t)).toBe('Round 4 of 4, 2 lanes');
    expect(laneList([1, { lane: 2 }, 'x', 1])).toEqual([1, 2]);
  });
  it('round_end keeps standings, who drops and why; awaiting_next waits for Next', () => {
    const t = emptyTournament();
    applyTournamentEvent(t, ev('round_start', { round: 1, total: 4, lanes: [1, 2, 3, 4, 5] }));
    applyTournamentEvent(t, ev('lane_eliminated', { round: 1, stage: 'payment', cause: '3 repeated charges', epitaph: 'Here lies Rookie.' }, { lane: 1 }));
    applyTournamentEvent(t, ev('round_end', { round: 1, standings: [{ lane: 5, rp: 900, rank: 1 }, { lane: 2, rp: 500, rank: 2 }, { lane: 1, rp: -120, rank: 3, eliminated: true }], eliminated: 1, lessons: [{}], cases: [{}, {}] }));
    expect(t.phase).toBe('review');
    const r = t.results[0]!;
    expect(r.standings.map((s) => s.lane)).toEqual([5, 2, 1]);
    expect(r.eliminated).toEqual([{ lane: 1, stage: 'payment', cause: '3 repeated charges', epitaph: 'Here lies Rookie.' }]);
    expect(r.lessons).toHaveLength(1);
    expect(dropReason(r, 1, (n) => `L${n}`)).toBe('3 repeated charges; -120 points, 620 behind L2; died at payment');
    applyTournamentEvent(t, ev('awaiting_next', { round: 1 }));
    expect(t.awaitingNext).toBe(true);
    applyTournamentEvent(t, ev('round_start', { round: 2, total: 4, lanes: [2, 3, 4, 5] }));
    expect(t.awaitingNext).toBe(false);
    expect(t.live).toEqual([2, 3, 4, 5]);
    expect(t.roster).toEqual([1, 2, 3, 4, 5]);
  });
  it('a tie on points says so', () => {
    const t = emptyTournament();
    applyTournamentEvent(t, ev('round_end', { round: 1, standings: [{ lane: 2, rp: 100, rank: 1 }, { lane: 3, rp: 100, rank: 2, eliminated: true }] }));
    expect(dropReason(t.results[0]!, 3)).toContain('tied on 100 points with Lane 2, decided by the tie-break');
  });
  it('corpses: eliminated stays for the tournament, wall for one round, one per lane', () => {
    const t = emptyTournament();
    applyTournamentEvent(t, ev('round_start', { round: 1, total: 4, lanes: [1, 2, 3] }));
    applyTournamentEvent(t, ev('corpse', { kind: 'wall', stage: 'payment', round: 1, epitaph: 'Every order failed.' }, { lane: 2 }));
    applyTournamentEvent(t, ev('corpse', { kind: 'eliminated', stage: 'ship', round: 1, epitaph: 'Gone.' }, { lane: 1 }));
    applyTournamentEvent(t, ev('lane_eliminated', { round: 1, stage: 'ship', cause: 'crash', epitaph: 'Gone.' }, { lane: 1 }));
    expect(t.corpses.map((c) => [c.lane, c.kind])).toEqual([[2, 'wall'], [1, 'eliminated']]);
    expect(t.fallen[1]).toMatchObject({ round: 1, stage: 'ship', cause: 'crash' });
    applyTournamentEvent(t, ev('round_start', { round: 2, total: 4, lanes: [2, 3] }));
    expect(t.corpses.map((c) => c.kind)).toEqual(['eliminated']);
  });
  it('tournament_end names the champion and the podium order', () => {
    const t = emptyTournament();
    applyTournamentEvent(t, ev('lane_eliminated', { round: 1, stage: 'payment' }, { lane: 1 }));
    applyTournamentEvent(t, ev('lane_eliminated', { round: 2, stage: 'ship' }, { lane: 3 }));
    applyTournamentEvent(t, ev('lane_eliminated', { round: 3, stage: 'transit' }, { lane: 2 }));
    applyTournamentEvent(t, ev('tournament_end', { champion: 5, awards: [{ id: 'battle_tested', lane: 2 }, { id: 'wooden_spoon', lane: 1 }], casebookRef: '/api/casebook' }));
    expect(t.phase).toBe('ended');
    expect(t.champion).toBe(5);
    expect(t.awards.map((a) => [a.label, a.lane])).toEqual([['Battle-Tested', 2], ['Wooden Spoon', 1]]);
    expect(podiumOf(t)).toEqual([5, 2, 3, 1]);
  });
  it('late joiner: state.corpses and lanes[].fallen rebuild the board, also after a reload', () => {
    const t = emptyTournament();
    loadTournament(t, { lanes: [lane(1, { fallen: { round: 2, stage: 'payment', cause: 'crash loop' } }), lane(2)], corpses: [{ lane: 1, stage: 'payment', kind: 'eliminated', round: 2, epitaph: 'R.I.P.' }, { lane: 2, stage: 'ship', kind: 'wall', round: 3 }] },
      { round: 3, total: 4, lanes: [2], rounds: [{ round: 1, standings: [{ lane: 1, rp: 5, rank: 1 }] }], awaitingNext: true });
    expect(t).toMatchObject({ active: true, round: 3, total: 4, phase: 'review', awaitingNext: true });
    expect(t.fallen[1]).toMatchObject({ round: 2, stage: 'payment', cause: 'crash loop' });
    expect(t.corpses).toHaveLength(2);
    expect(t.results).toHaveLength(1);
    const vm = emptyVM();
    loadSnapshot(vm, snapshot({ corpses: [{ lane: 3, stage: 'payment', kind: 'eliminated', round: 1, epitaph: 'Gone.' }] }, [1, 2, 3].map((n) => lane(n, n === 3 ? { fallen: { round: 1, stage: 'payment', cause: 'x' } } : {}))), 0);
    expect(vm.lanes.find((l) => l.lane === 3)).toMatchObject({ mode: 'halted', fallen: { round: 1, stage: 'payment' } });
    expect(vm.tournament.corpses[0]).toMatchObject({ lane: 3, kind: 'eliminated' });
    loadSnapshot(vm, snapshot(), 0);
    expect(vm.tournament.active).toBe(false);
  });
  it('epitaphs: the engine text wins, else one is composed', () => {
    expect(epitaphOf({ lane: 1, stage: 'payment', kind: 'eliminated', round: 2, epitaph: 'Own words.', cause: '' }, 'Rookie', 'Payment')).toBe('Own words.');
    expect(epitaphOf({ lane: 1, stage: 'payment', kind: 'eliminated', round: 2, epitaph: '', cause: 'crash after charge' }, 'Rookie', 'Payment')).toBe('Rookie, died at Payment, round 2. Cause: crash after charge.');
    expect(epitaphOf({ lane: 1, stage: 'payment', kind: 'wall', round: 2, epitaph: '', cause: '' }, 'Rookie', 'Payment')).toContain('every order failed at Payment');
    expect(standingsOf([{ lane: 2, rp: 3, rank: 2 }, { lane: 1, rp: 9, rank: 1 }, { lane: 0 }]).map((s) => s.lane)).toEqual([1, 2]);
  });
});

describe('tournament in the arena view model', () => {
  it('round_start adds rows for the roster; lane_eliminated greys the lane and keeps the corpse', () => {
    const vm = emptyVM();
    loadSnapshot(vm, snapshot({}, []), 0);
    applyEvent(vm, ev('wave_start', { lanes: 5, speed: 1 }, { wave: 1 }) as never, 0);
    applyEvent(vm, ev('round_start', { round: 1, total: 4, lanes: [1, 2, 3, 4, 5] }) as never, 0);
    expect(vm.lanes.map((l) => l.lane)).toEqual([1, 2, 3, 4, 5]);
    applyEvent(vm, ev('lane_eliminated', { round: 1, stage: 'payment', cause: 'crash', epitaph: 'R.I.P.' }, { lane: 1 }) as never, 10);
    expect(vm.lanes[0]).toMatchObject({ mode: 'halted', fallen: { round: 1, stage: 'payment' } });
    // round 2: wave_start again; the fallen lane keeps its row, the live ones start fresh
    applyEvent(vm, ev('round_start', { round: 2, total: 4, lanes: [2, 3, 4, 5] }) as never, 20);
    applyEvent(vm, ev('wave_start', { lanes: 4, speed: 1 }, { wave: 2 }) as never, 30);
    expect(vm.lanes.map((l) => l.lane)).toEqual([1, 2, 3, 4, 5]);
    expect(vm.lanes[0]!.fallen).toBeTruthy();
    expect(vm.lanes[1]!.fallen).toBeFalsy();
    expect(vm.tournament.corpses.filter((c) => c.kind === 'eliminated')).toHaveLength(1);
    applyEvent(vm, ev('reset') as never, 40);
    expect(vm.tournament.active).toBe(false);
  });
  it('the corpse hover text is the epitaph (drawn into scene.hot)', () => {
    const vm = emptyVM();
    loadSnapshot(vm, snapshot({}, [1, 2, 3, 4, 5].map((n) => lane(n))), 0);
    applyEvent(vm, ev('round_start', { round: 2, total: 4, lanes: [2, 3, 4, 5] }) as never, 0);
    applyEvent(vm, ev('lane_eliminated', { round: 2, stage: 'payment', cause: 'crash after charge', epitaph: 'Rookie, died at Payment, round 2: 3 repeated charges.' }, { lane: 1 }) as never, 1);
    const scene = new ArenaScene(chain());
    // The static crypt layer needs a DOM canvas; the lane itself is what carries the corpse.
    (scene as unknown as { drawLane(c: CanvasRenderingContext2D, v: typeof vm, l: (typeof vm.lanes)[0], b: { top: number; h: number }, n: number): void }).drawLane(chain(), vm, vm.lanes[0]!, laneBoxes(5)[0]!, 1000);
    expect(scene.hot.some((h) => h.tip.startsWith('Rookie, died at Payment, round 2'))).toBe(true);
    const box = scene.hot.find((h) => h.tip.startsWith('Rookie'))!;
    expect(box.x).toBeLessThan(stationX(3, STAGES.length) + 20);
    expect(box.x + box.w).toBeGreaterThan(stationX(3, STAGES.length));
    const top = laneBoxes(5)[0]!.top;
    expect(box.y).toBeGreaterThan(top - 10);
    expect(chipTipAt(vm, stationX(3, STAGES.length), top + 20, 0, 0)).toContain('Payment');
  });
});

describe('corpse art', () => {
  it('draws the tombstone, the wisp and the wall without throwing, in every motion mode', () => {
    const ctx = chain();
    for (const lh of [100, 148, 192]) {
      const h = tombHeight(lh);
      expect(h).toBeGreaterThanOrEqual(46);
      expect(h).toBeLessThanOrEqual(78);
      expect(drawTombstone(ctx, 500, 400, h, 2).w).toBeGreaterThan(0);
      expect(drawWallCorpse(ctx, 500, 400, h).h).toBeGreaterThan(h);
      for (const reduced of [false, true]) for (const now of [0, 500, 1e6]) drawWisp(ctx, 500, 400, h, now, reduced, 3);
    }
  });
});
