// covers: lively-lanes-ui/R1
import { describe, expect, it } from 'vitest';
import { RunnerEngine, WaveClock } from '../../haunt/src/runner';
import { ORDER_MS, SHOW_PACE } from '../../haunt/src/runner/schedule';
import { SHOW_MAX_GAP_MS } from '../../haunt/src/runner/intensity';
import { APP_STAGES } from '../src/live/catalog';

const STAGES = APP_STAGES.orders.map((s) => s.id);
const LANES = 5;
const SPAN_MS = 40_000;
const FIRST_MS = 8_000;
const MAX_GAP_MS = 8_000;

/** A plain wave at the default dial: per-lane creature times in real ms. No bots, so no fault ever fires (the worst case for the lane stack). */
function creatureTimes(seed: number, level?: number): Map<number, number[]> {
  const times = new Map<number, number[]>();
  let now = 0;
  const engine = new RunnerEngine({ post: async () => {} });
  engine.setChaosMode({ mode: 'random', frequency: 0.3, seed });
  const record = (e: { type: string; lane?: unknown; detail?: Record<string, unknown> }): void => {
    engine.observe(e as never);
    if (e.type !== 'chaos' || e.detail?.source === 'boss') return;
    const lane = Number(e.lane);
    times.set(lane, [...(times.get(lane) ?? []), now]);
  };
  engine.startWave(1, { orders: 12, seed, tiers: 'race', lanes: LANES, speed: 1, pace: 'show', app: 'orders' } as never, record as never);
  if (level !== undefined) engine.setIntensity(level);
  const per = (ORDER_MS * SHOW_PACE) / STAGES.length;
  const step = (lane: number): number => Math.floor((now + lane * 90) / per);
  const lastStep = new Map<string, number>();
  const clock = new WaveClock({ engine, record: record as never, wave: 1, orders: 12, seed, frequency: 0.3, show: true, laneInfo: (l) => ({ state: 'working', stage: STAGES[step(Number(l)) % STAGES.length]! }) });
  for (now = 0; now <= SPAN_MS; now += 250) {
    for (const lane of engine.lanes) {
      const k = step(Number(lane));
      const prev = lastStep.get(lane);
      if (prev === undefined || prev !== k) {
        if (prev !== undefined && Math.floor(prev / STAGES.length) !== Math.floor(k / STAGES.length)) engine.director.orderEnd(lane);
        engine.director.stageComplete(lane);
        engine.director.onStageStart(lane, STAGES[k % STAGES.length]!);
        lastStep.set(lane, k);
      }
    }
    clock.step(now);
  }
  return times;
}

describe('lively lanes: plain wave at the default dial', () => {
  for (const seed of [7, 11, 23, 2024]) {
    it(`seed ${seed}: every lane has a creature within ${FIRST_MS} ms and never waits more than ${MAX_GAP_MS} ms`, () => {
      const times = creatureTimes(seed);
      for (let lane = 1; lane <= LANES; lane++) {
        const t = times.get(lane) ?? [];
        expect(t.length, `lane ${lane} has creatures`).toBeGreaterThan(0);
        expect(t[0]!, `lane ${lane} first creature`).toBeLessThanOrEqual(FIRST_MS);
        const marks = [0, ...t, SPAN_MS];
        const gaps = marks.slice(1).map((x, i) => x - marks[i]!);
        expect(Math.max(...gaps), `lane ${lane} max gap ${gaps.join(',')}`).toBeLessThanOrEqual(MAX_GAP_MS);
      }
    });
  }

  it('the floor is under the 8 s requirement and the plan is deterministic', () => {
    expect(SHOW_MAX_GAP_MS).toBeLessThan(MAX_GAP_MS);
    expect([...creatureTimes(7)]).toEqual([...creatureTimes(7)]);
  });

  it('a higher dial level never gives fewer creatures', () => {
    const count = (level: number): number => [...creatureTimes(7, level).values()].reduce((n, t) => n + t.length, 0);
    expect(count(9)).toBeGreaterThanOrEqual(count(3));
    expect(count(3)).toBeGreaterThanOrEqual(count(1));
  });
});
