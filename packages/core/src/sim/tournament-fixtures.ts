// Mock tournaments (TV3-C7): rounds planned by the lane planner, scored and eliminated by the same `Tournament` the live server uses.
// Fixtures: tournament-r1-r4, elimination-corpse, wall-corpse, awaiting-next.
import { TIER_ORDER, type HauntEvent } from '@haunt/shared';
import { Tournament } from '../../../haunt/src/tournament/tournament';
import { roundPlan, tierOfLane, type RoundCfg } from '../../../haunt/src/tournament/rounds';
import { emptyLessons, lessonEvent, learnRound, type LaneLessons } from '../../../haunt/src/tournament/lessons';
import { laneCases } from '../../../haunt/src/tournament/signature';
import type { ArmSpec } from './plan';
import { assembleWave, assignSeq, BASE_TS, planWave } from './wave';

const SEED = 7;
const GAP_MS = 4000;

/** The seeded storm of a round as planner arms, the same list for every live lane. */
export function stormArms(seed: number, round: number, cfg: RoundCfg): ArmSpec[] {
  return roundPlan(seed, round, cfg).map((p, i) => ({
    id: `r${round}-${i + 1}`, fault: p.fault, source: p.fuzz ? 'fuzz' : 'random', when: { order: p.order, stage: p.stage, attempt: 1, delay: 250 },
    ...(p.point ? { point: p.point } : {}), ...(p.outageMs !== undefined ? { outageMs: p.outageMs } : {}),
    ...(p.fuzz ? { extra: { unknown: true, fingerprint: p.fuzz.fingerprint, fuzz: { fault: p.fuzz.fault, ...(p.fuzz.status !== undefined ? { status: p.fuzz.status } : {}) } } } : {}),
  }));
}

export interface MockRound { events: HauntEvent[]; segment: HauntEvent[] }

export interface MockTournamentOpts {
  rounds?: RoundCfg[];
  /** Arms added on top of the storm, by lane number (a wall for one lane, for example). */
  extraArms?: (round: number, lane: number) => ArmSpec[];
  /** Stop after this many rounds (the stream then ends at `awaiting_next`). */
  upTo?: number;
}

/**
 * One continuous stream: hello once, then per round `wave_start .. wave_end`, `round_end`, `lane_eliminated`/`corpse`, `awaiting_next`.
 * Wave n is round n. Lanes keep their numbers: lane n is tier n.
 */
export function mockTournament(o: MockTournamentOpts = {}): HauntEvent[] {
  const t = new Tournament({ seed: SEED, rounds: o.rounds });
  const out: HauntEvent[] = [];
  const known = new Map<number, LaneLessons>();
  let ts0 = BASE_TS;
  const limit = o.upTo ?? t.total;
  while (t.phase !== 'done' && t.round < limit) {
    const rs = t.beginRound();
    const cfg = t.cfgOf(rs.round);
    const live = rs.lanes;
    const storm = stormArms(SEED, rs.round, cfg);
    const arms: Record<number, ArmSpec[]> = {};
    live.forEach((lane, i) => { arms[i + 1] = [...storm.map((a) => ({ ...a, id: `${a.id}-l${lane}` })), ...(o.extraArms?.(rs.round, lane) ?? [])]; });
    const pw = planWave({ app: 'orders', tiers: live.map((l) => tierOfLane(l)), seed: SEED, orders: cfg.orders, pace: 2, waveNo: rs.round, floor: true }, arms);
    const wave = assembleWave(pw, ts0, rs.round === 1).map((e) => {
      if (typeof e.lane === 'number') e.lane = live[e.lane - 1]!;
      if (e.type === 'wave_end') {
        const summary: Record<string, unknown> = {};
        for (const [k, v] of Object.entries((e.detail as { summary: Record<string, unknown> }).summary)) summary[String(live[Number(k) - 1]!)] = v;
        (e.detail as { summary: unknown }).summary = summary;
      }
      return e;
    });
    // round_start sits right after the last lane_ready.
    const lastReady = wave.map((e) => e.type).lastIndexOf('lane_ready');
    const start = wave[lastReady]!.ts + 1;
    wave.splice(lastReady + 1, 0, { seq: 0, ts: start, type: 'round_start', wave: rs.round, detail: { round: rs.round, total: rs.total, lanes: live, orders: cfg.orders, intensity: cfg.intensity, seed: SEED } } as HauntEvent);
    const dial = { seq: 0, ts: start, type: 'intensity', wave: rs.round, detail: { level: cfg.intensity, source: 'plan', autoRamp: false } } as HauntEvent;
    wave.splice(lastReady + 1, 0, dial);
    out.push(...wave);
    const endTs = wave[wave.length - 1]!.ts;
    const evs = wave.filter((e) => e.lane !== undefined || e.type === 'wave_end');
    // Learn from the round exactly as the live server does: lessons, the first-time bonus, then `lesson` events after round_end.
    const lessonsBonus: Record<number, number> = {};
    const lessons: unknown[] = [];
    const learned: { lane: number; lesson: ReturnType<typeof learnRound>['newLessons'][number] }[] = [];
    for (const lane of live) {
      const r = learnRound(known.get(lane) ?? emptyLessons(lane, tierOfLane(lane)), laneCases(evs as never, lane, rs.round), rs.round);
      known.set(lane, r.next);
      lessonsBonus[lane] = 25 * r.firstOvercome.length;
      for (const l of r.newLessons) { lessons.push({ lane, ...l }); learned.push({ lane, lesson: l }); }
      for (const g of r.newSuggestions) lessons.push({ lane, suggestion: true, ...g });
    }
    const fin = t.finishRound(evs as never, { wave: rs.round, lessonsBonus, lessons });
    const withLessons: unknown[] = [];
    fin.forEach((e, i) => { withLessons.push(e); if (i === 0) for (const l of learned) withLessons.push(lessonEvent(l.lane, l.lesson)); });
    withLessons.forEach((e, i) => out.push({ seq: 0, ts: endTs + 100 + i * 20, wave: rs.round, ...(e as object) } as HauntEvent));
    if ((t.phase as string) === 'done') out.push({ seq: 0, ts: endTs + 100 + withLessons.length * 20 + 20, wave: rs.round, ...(t.endEvent() as object) } as HauntEvent);
    ts0 = endTs + GAP_MS;
  }
  return assignSeq(out);
}

/** Lane 2 (Retrier) stumbles at Payment on every order in round 1 and recovers each time: a wall corpse on a lane that survives. */
const wallArms = (round: number, lane: number): ArmSpec[] =>
  round === 1 && lane === 2
    ? Array.from({ length: 6 }, (_, k) => ({ id: `wall-${k + 1}`, fault: 'http_500', source: 'random' as const, when: { order: k + 1, stage: 'payment', attempt: 1, delay: 50 } }))
    : [];

export const TOURNAMENT_FIXTURES: Record<string, () => HauntEvent[]> = {
  'tournament-r1-r4': () => mockTournament(),
  'elimination-corpse': () => mockTournament({ upTo: 2 }),
  'wall-corpse': () => mockTournament({ upTo: 1, extraArms: wallArms }),
  'awaiting-next': () => mockTournament({ upTo: 1 }),
};

void TIER_ORDER;
