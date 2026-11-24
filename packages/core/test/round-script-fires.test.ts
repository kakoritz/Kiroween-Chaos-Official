// Regression: a tournament round plan must fire every press it lists, not only the first one per lane.
// A press waited for every earlier unfired press of its lane, so one that could never match (a second press at an
// earlier stage of the same order) froze the rest of the lane's storm and later rounds showed almost no creatures.
import { describe, expect, it } from 'vitest';
import { DemoPlayer } from '../src/live';
import { roundScript } from '../src/live/tournament-script';
import { RunnerEngine } from '../../haunt/src/runner/engine';
import { DEFAULT_ROUNDS, roundPlan } from '../../haunt/src/tournament/rounds';
import { STAGES } from '../../haunt/src/pipeline/pipeline';
import type { HauntEvent } from '../../haunt/src/score/score';

const settings = { orders: 12, seed: 7, tiers: 'race' as const, lanes: 5, speed: 1, pace: 'show' as const, app: 'orders' };

function play(seed: number, round: number, lanes: number[]) {
  const cfg = DEFAULT_ROUNDS[round - 1]!;
  const engine = new RunnerEngine();
  const events: HauntEvent[] = [];
  engine.startWave(1, { ...settings, orders: cfg.orders }, (e) => events.push(e));
  const p = new DemoPlayer(engine, (e) => events.push(e), roundScript(seed, round, cfg, lanes, 1));
  let t = 0;
  for (let o = 1; o <= cfg.orders; o++) {
    for (const s of STAGES) {
      for (const lane of lanes) p.observe({ type: 'stage_start', lane: String(lane), order: `ord-${String(o).padStart(4, '0')}`, stage: s.id, detail: { attempt: 1 } });
      t += 400;
      p.step(t);
    }
    for (const lane of lanes) engine.director.orderEnd(String(lane));
  }
  p.step(t + 5000);
  return { cfg, chaos: events.filter((e) => e.type === 'chaos') };
}

describe('tournament round script fires the whole plan', () => {
  for (const seed of [7, 11, 2024]) {
    for (const round of [1, 2, 3, 4]) {
      it(`seed ${seed} round ${round}: every lane meets every planned press`, () => {
        const lanes = [1, 2, 3, 4, 5].slice(0, DEFAULT_ROUNDS[round - 1]!.lanes);
        const want = roundPlan(seed, round, DEFAULT_ROUNDS[round - 1]!).length;
        const { chaos } = play(seed, round, lanes);
        for (const lane of lanes) {
          const got = chaos.filter((e) => String(e.lane) === String(lane)).length;
          expect(got, `lane ${lane}`).toBe(want);
        }
      });
    }
  }

  it('the round-4 storm at intensity 9 brings several creature kinds to every lane', () => {
    const { chaos } = play(7, 4, [1, 2]);
    for (const lane of [1, 2]) {
      const kinds = new Set(chaos.filter((e) => String(e.lane) === String(lane)).map((e) => (e.detail as { creature: string }).creature));
      expect(kinds.size).toBeGreaterThan(2);
    }
  });
});
