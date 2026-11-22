// TV3-C3: never a perfect run (spec 5.3): gremlin floor rule, issues per lane in the wave summary, property P19, review cap.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { GREMLIN_VARIANTS, IssueFloor, RunnerEngine, WaveClock, gremlinVariant, isIssueEvent, laneIssues } from '../src/runner';
import { review } from '../src/score/review';
import { validateEvents } from '../src/contract/validate';
import { TIER_ORDER } from '@haunt/shared';
import type { FaultSpec } from '../../core/src/provider';
import type { HauntEvent as SEvent } from '../src/score/score';
import { LapTracker } from '../../core/src/live/lap-tracker';
import { assembleWave, assignSeq, BASE_TS, planWave } from '../../core/src/sim/wave';

const settings = (lanes: number, seed = 7, orders = 4) => ({ orders, seed, tiers: 'race' as const, lanes, speed: 1, pace: 'show' as const, app: 'orders' });

function boot(opts: { lanes?: number; seed?: number; orders?: number; stage?: string | null } = {}) {
  const events: SEvent[] = [];
  const posted: FaultSpec[] = [];
  const stage = opts.stage === undefined ? 'payment' : opts.stage;
  const engine = new RunnerEngine({ laneInfo: () => ({ state: 'working', stage }), post: async (b) => { posted.push(b); } });
  const record = (e: SEvent) => { events.push(e); engine.observe(e); };
  engine.startWave(1, settings(opts.lanes ?? 3, opts.seed ?? 7, opts.orders ?? 4), record);
  const clock = (extra: object = {}) => new WaveClock({ engine, record, wave: 1, orders: opts.orders ?? 4, seed: opts.seed ?? 7, frequency: 0.3, laneInfo: () => ({ state: 'working', stage }), ...extra });
  return { engine, events, posted, record, clock };
}

describe('the gremlin', () => {
  it('is a labelled mild fault: fault gremlin, creature gremlin, source gremlin, a known variant with a count of one', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const { engine, events, posted } = boot({ seed, lanes: 1 });
      const variant = engine.gremlin('1');
      seen.add(variant);
      expect(GREMLIN_VARIANTS).toContain(variant as never);
      expect(events[0]).toMatchObject({ type: 'chaos', lane: '1', detail: { fault: 'gremlin', creature: 'gremlin', source: 'gremlin', variant } });
      if (variant !== 'duplicate_request') expect(posted[0]).toMatchObject({ count: 1 });
      if (variant !== 'duplicate_request') expect(posted[0]!.forMs).toBeUndefined();
      expect(engine.floor.count('1')).toBe(1);
    }
    expect([...seen].sort()).toEqual([...GREMLIN_VARIANTS].sort());
  });

  it('is seeded: the same wave, lane and seed give the same variant', () => {
    expect(gremlinVariant(7, '2', 1)).toBe(gremlinVariant(7, '2', 1));
    expect(new Set(Array.from({ length: 30 }, (_, i) => gremlinVariant(7, String(i), 1))).size).toBe(3);
  });

  it('counts as an issue, like the failures the lap tracker counts', () => {
    expect(isIssueEvent({ type: 'chaos', detail: { source: 'gremlin' } })).toBe(true);
    expect(isIssueEvent({ type: 'chaos', detail: { source: 'user' } })).toBe(false);
    expect(['stage_fail', 'process_dead', 'repeat', 'order_parked', 'lane_halted'].every((type) => isIssueEvent({ type }))).toBe(true);
    expect(isIssueEvent({ type: 'breaker', detail: { state: 'open' } })).toBe(true);
    expect(isIssueEvent({ type: 'breaker', detail: { state: 'closed' } })).toBe(false);
    expect(laneIssues([{ type: 'stage_fail', lane: 1 }, { type: 'stage_fail', lane: 2 }, { type: 'effect', lane: 1 }], 1)).toBe(1);
  });
});

describe('floor rule in the wave clock', () => {
  it('injects one gremlin per lane with no issue, only after the middle of the round, in every chaos mode', () => {
    for (const mode of ['off', 'manual'] as const) {
      const b = boot({ lanes: 3 });
      b.engine.setChaosMode({ mode, frequency: 0, seed: 7 });
      const clock = b.clock();
      const half = clock.boss.expectedMs / 2;
      clock.step(half - 1);
      expect(b.events.filter((e) => e.type === 'chaos')).toEqual([]);
      clock.step(half + 5000);
      clock.step(half * 4);
      const g = b.events.filter((e) => e.type === 'chaos');
      expect(g.map((e) => [e.lane, e.detail?.source])).toEqual([['1', 'gremlin'], ['2', 'gremlin'], ['3', 'gremlin']]);
    }
  });

  it('leaves a lane alone that already had an issue, and the floor can be switched off', () => {
    const b = boot({ lanes: 2 });
    b.record({ type: 'stage_fail', lane: '1', order: 'ord-0001', stage: 'payment', detail: { error: 'x' } } as SEvent);
    const clock = b.clock();
    clock.step(clock.boss.expectedMs);
    expect(b.events.filter((e) => e.type === 'chaos').map((e) => e.lane)).toEqual(['2']);
    const off = boot({ lanes: 2 });
    const c2 = off.clock({ floor: false });
    c2.step(c2.boss.expectedMs * 2);
    expect(off.events.filter((e) => e.type === 'chaos')).toEqual([]);
  });

  it('waits for a lane that is between orders and tries again', () => {
    let stage: string | null = null;
    const events: SEvent[] = [];
    const engine = new RunnerEngine({ laneInfo: () => ({ state: 'working', stage }) });
    const record = (e: SEvent) => { events.push(e); engine.observe(e); };
    engine.startWave(1, settings(1), record);
    const clock = new WaveClock({ engine, record, wave: 1, orders: 4, seed: 7, frequency: 0, laneInfo: () => ({ state: 'working', stage }) });
    clock.step(clock.boss.expectedMs);
    expect(events.filter((e) => e.type === 'chaos')).toEqual([]);
    stage = 'confirmation';
    clock.step(clock.boss.expectedMs + 2000);
    expect(events.filter((e) => e.type === 'chaos')).toHaveLength(1);
  });
});

describe('P19: no lane ends a wave with zero issues', () => {
  it('live engine and clock: every intensity level 1 to 11, every lane count, many seeds', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 11 }), fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 12 }), fc.constantFrom<'off' | 'manual' | 'random'>('off', 'manual', 'random'),
      (level, lanes, orders, mode) => {
        const seed = level * 131 + lanes * 17 + orders;
        const b = boot({ lanes, seed, orders });
        b.engine.setChaosMode({ mode, frequency: 0.3, seed });
        b.engine.setIntensity(level);
        const clock = b.clock({ seed });
        // Play the whole expected round second by second; the stack is cleared so depth never hides a press.
        for (let s = 0; s * 1000 <= clock.boss.expectedMs + 2000; s++) {
          clock.step(s * 1000);
          for (const l of b.engine.lanes) b.engine.director.orderEnd(l);
        }
        expect(b.engine.assertFloor()).toEqual([]);
        for (const l of b.engine.lanes) expect(b.engine.floor.count(l)).toBeGreaterThanOrEqual(1);
      },
    ), { numRuns: 300 });
  });

  it('intensity 1 on its own, five lanes, 40 seeds', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const b = boot({ lanes: 5, seed, orders: 6 });
      b.engine.setIntensity(1);
      b.engine.setChaosMode({ mode: 'random', frequency: 0.3, seed });
      const clock = b.clock({ seed });
      for (let s = 0; s * 1000 <= clock.boss.expectedMs + 1000; s++) { clock.step(s * 1000); for (const l of b.engine.lanes) b.engine.director.orderEnd(l); }
      expect(b.engine.assertFloor()).toEqual([]);
    }
  });

  it('mock planner: all five tiers, many seeds and wave sizes, the summary carries issues >= 1 per lane and the stream is valid', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 5000 }), fc.integer({ min: 1, max: 4 }), fc.constantFrom<1 | 2>(1, 2), (seed, orders, pace) => {
      const pw = planWave({ app: 'orders', tiers: TIER_ORDER, seed, orders, pace, floor: true });
      const ev = assignSeq(assembleWave(pw, BASE_TS));
      const end = ev.find((e) => e.type === 'wave_end')!;
      const summary = end.detail!.summary as Record<string, { issues: number }>;
      expect(Object.keys(summary)).toHaveLength(5);
      for (const row of Object.values(summary)) expect(row.issues).toBeGreaterThanOrEqual(1);
      for (let lane = 1; lane <= 5; lane++) expect(laneIssues(ev.filter((e) => e.lane === lane))).toBe(summary[String(lane)]!.issues);
      expect(validateEvents(ev)).toEqual([]);
    }), { numRuns: 60 });
  });

  it('a gremlin in the plan reads fault gremlin, source gremlin and keeps the cost small', () => {
    const pw = planWave({ app: 'orders', tiers: TIER_ORDER, seed: 7, orders: 3, pace: 2, floor: true });
    const ev = assembleWave(pw, BASE_TS);
    const g = ev.filter((e) => e.type === 'chaos');
    expect(g).toHaveLength(5);
    for (const e of g) expect(e.detail).toMatchObject({ fault: 'gremlin', creature: 'gremlin', source: 'gremlin' });
    expect(GREMLIN_VARIANTS as readonly string[]).toEqual(expect.arrayContaining(g.map((e) => e.detail!.variant as string)));
    // Without the floor a clean wave stays clean (the calm fixture).
    expect(assembleWave(planWave({ app: 'orders', tiers: TIER_ORDER, seed: 7, orders: 3, pace: 2 }), BASE_TS).some((e) => e.type === 'chaos')).toBe(false);
  });
});

describe('lap tracker: issues in the wave summary', () => {
  const ev = (type: string, ts: number, order?: string, stage?: string, detail: Record<string, unknown> = {}): SEvent =>
    ({ type, ts, lane: '1', ...(order ? { order } : {}), ...(stage ? { stage } : {}), detail } as SEvent);

  it('a gremlin counts as an issue of its order and of the lane summary, and lowers the issues sub-score', () => {
    const t = new LapTracker({ app: 'orders', pace: 1, speed: 1 });
    const T = 1_000_000;
    const out = [
      ev('order_start', T, 'ord-0001', undefined, { grabMs: 0 }),
      ev('stage_start', T + 100, 'ord-0001', 'account'),
      ev('chaos', T + 200, undefined, undefined, { creature: 'gremlin', fault: 'gremlin', source: 'gremlin', variant: 'http_500' }),
      ev('stage_done', T + 3900, 'ord-0001', 'account', { walkMs: 0 }),
      ev('order_done', T + 4000, 'ord-0001', undefined, {}),
    ].flatMap((e) => t.process(e));
    const done = out.find((e) => e.type === 'order_done')!;
    expect((done.detail as any).lap.issues).toEqual([{ stage: 'account', count: 1 }]);
    expect(t.summary('1').issues).toBe(1);
    expect((out.find((e) => e.type === 'review')!.detail as any).sub.issues).toBe(4);
    const clean = new LapTracker({ app: 'orders', pace: 1, speed: 1 });
    expect(clean.summary('1').issues).toBe(0);
  });
});

describe('review rule: a gremlin plus a slow recovery cannot give 5.0', () => {
  const base = { extra: {}, degraded: false, cancelled: false, baselineMs: 4000 };
  const lap = (downtimeMs: number, issues = 1) => ({ ms: 4000, downtimeMs, issues: issues ? [{ stage: 'payment', count: issues }] : [] });

  it('keeps 5.0 for a fast clean recovery', () => {
    expect(review({ ...base, lap: lap(0), gremlin: true }).stars).toBe(5);
    expect(review({ ...base, lap: lap(900), gremlin: true }).stars).toBeLessThan(5);
  });

  it('caps at 4.5 with a gremlin and a slow recovery, whatever else the formula says', () => {
    for (const downtimeMs of [1100, 2500, 6000]) {
      const r = review({ ...base, lap: lap(downtimeMs), gremlin: true });
      expect(r.stars).toBeLessThanOrEqual(4.5);
    }
    // The cap is its own rule: it holds even if the other sub-scores would round up to 5.0.
    const edge = review({ ...base, lap: { ms: 4000, downtimeMs: 1500, issues: [] }, gremlin: true });
    expect(edge.stars).toBeLessThanOrEqual(4.5);
  });

  it('does not touch an order without a gremlin', () => {
    expect(review({ ...base, lap: lap(0, 0) }).stars).toBe(5);
  });
});

describe('IssueFloor', () => {
  it('counts per lane and reports lanes with none', () => {
    const f = new IssueFloor();
    f.reset(['1', '2']);
    f.observe({ type: 'stage_fail', lane: 1 });
    f.observe({ type: 'effect', lane: 2 });
    expect(f.violations()).toEqual(['2']);
    expect(f.snapshot()).toEqual({ '1': 1, '2': 0 });
  });
});
