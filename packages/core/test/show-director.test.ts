// The default plain wave is a haunted house: the intensity dial drives a seeded director that sends several creature kinds to every lane.
import { describe, expect, it } from 'vitest';
import { RunnerEngine, WaveClock } from '../../haunt/src/runner';
import { ORDER_MS, SHOW_PACE } from '../../haunt/src/runner/schedule';
import { MAX_DEPTH } from '../../haunt/src/chaos/catalog';
import type { HauntEvent } from '../../haunt/src/score/score';
import { APP_STAGES } from '../src/live/catalog';
import { applyEvent, emptyVM, stationX } from '../../arena-ui/src/arena/model';
import { creatureSlots, shown, TRACK_X0, CREATURE_X1 } from '../../arena-ui/src/arena/creatures';

const STAGES = APP_STAGES.orders.map((s) => s.id);
const ORDERS = 12;
const LANES = 5;

/** One plain wave (no demo, no script): the live runtime's clock with `show` on, lanes walking the 11 stages order after order. */
function plainWave(level: number, seed: number, orders = ORDERS) {
  const events: HauntEvent[] = [];
  let now = 0;
  const stageAt = (lane: number, t: number): { idx: number; order: number } => {
    const per = (ORDER_MS * SHOW_PACE) / STAGES.length;
    const k = Math.floor((t + lane * 90) / per);
    return { idx: k % STAGES.length, order: Math.floor(k / STAGES.length) };
  };
  const engine = new RunnerEngine({ post: async () => {} });
  engine.setChaosMode({ mode: 'random', frequency: 0.3, seed });
  const record = (e: HauntEvent): void => { events.push(e); engine.observe(e); };
  engine.startWave(1, { orders, seed, tiers: 'race', lanes: LANES, speed: 1, pace: 'show', app: 'orders' }, record);
  engine.setIntensity(level);
  const lastStage = new Map<string, string>();
  const lastOrder = new Map<string, number>();
  const clock = new WaveClock({
    engine, record, wave: 1, orders, seed, frequency: 0.3, show: true,
    laneInfo: (lane) => ({ state: 'working', stage: STAGES[stageAt(Number(lane), now).idx]! }),
  });
  const end = orders * ORDER_MS * SHOW_PACE + 20_000;
  for (now = 0; now <= end; now += 250) {
    for (const lane of engine.lanes) {
      const { idx, order } = stageAt(Number(lane), now);
      const stage = STAGES[idx]!;
      if (lastOrder.get(lane) !== undefined && lastOrder.get(lane) !== order) engine.director.orderEnd(lane);
      lastOrder.set(lane, order);
      if (lastStage.get(lane) !== stage) {
        engine.director.stageComplete(lane);
        engine.director.onStageStart(lane, stage);
        if (stage === 'create') engine.director.onInputRead(lane, `ord-${order}`);
        lastStage.set(lane, stage);
      }
    }
    clock.step(now);
  }
  return events;
}

const chaosOf = (events: HauntEvent[]) => events.filter((e) => e.type === 'chaos' && e.detail?.source !== 'boss');
const kindsOnLane = (events: HauntEvent[], lane: number) => new Set(chaosOf(events).filter((e) => Number(e.lane) === lane).map((e) => e.detail?.creature as string));

describe('default plain wave (random mode, dial-driven, show director)', () => {
  const byLevel = new Map<number, HauntEvent[]>();
  for (const level of [1, 5, 9, 11]) byLevel.set(level, plainWave(level, 7));

  for (const level of [1, 5, 9, 11]) {
    for (const seed of [7, 11, 2024]) {
      it(`intensity ${level}, seed ${seed}: every lane meets more than 2 distinct creature kinds over the wave`, () => {
        const events = seed === 7 ? byLevel.get(level)! : plainWave(level, seed);
        for (let lane = 1; lane <= LANES; lane++) {
          const kinds = kindsOnLane(events, lane);
          expect(kinds.size, `lane ${lane}: ${[...kinds].join(',')}`).toBeGreaterThan(2);
        }
      });
    }
  }

  it('the number of creatures rises with the dial', () => {
    const n = [1, 5, 9, 11].map((l) => chaosOf(byLevel.get(l)!).length);
    expect(n[0]).toBeGreaterThan(LANES * 3);
    expect(n[1]).toBeGreaterThan(n[0]!);
    expect(n[2]).toBeGreaterThan(n[1]!);
    expect(n[3]).toBeGreaterThan(n[2]!);
  });

  it('the chaos depth limit still holds', () => {
    for (const events of byLevel.values()) {
      for (const e of events) if (e.type === 'chaos') expect(Number(e.detail?.depth)).toBeLessThanOrEqual(MAX_DEPTH);
    }
  });

  it('never perfect: a lane with no issue is given a gremlin by mid-wave', () => {
    const events = plainWave(1, 3, 4);
    for (let lane = 1; lane <= LANES; lane++) {
      expect(events.some((e) => e.type === 'chaos' && Number(e.lane) === lane), `lane ${lane}`).toBe(true);
    }
  });

  it('same seed gives the identical event sequence, another seed does not', () => {
    const a = JSON.stringify(plainWave(5, 7));
    expect(JSON.stringify(plainWave(5, 7))).toBe(a);
    expect(JSON.stringify(plainWave(5, 8))).not.toBe(a);
  });

  it('a boss night brings its boss: warning, start on every lane, end', () => {
    for (const level of [1, 9]) {
      const events = byLevel.get(level)!;
      const types = events.map((e) => e.type);
      expect(types).toContain('boss_warning');
      expect(types).toContain('boss_start');
      expect(types).toContain('boss_end');
      expect(types.indexOf('boss_warning')).toBeLessThan(types.indexOf('boss_start'));
      const bossHits = new Set(events.filter((e) => e.type === 'chaos' && e.detail?.source === 'boss').map((e) => Number(e.lane)));
      expect(bossHits.size).toBeGreaterThanOrEqual(LANES - 1);
    }
  });

  it('manual mode sends nothing by itself (explicit presses only)', () => {
    const events: HauntEvent[] = [];
    const engine = new RunnerEngine({ post: async () => {} });
    engine.setChaosMode({ mode: 'manual', frequency: 0.3, seed: 7 });
    engine.startWave(1, { orders: 4, seed: 7, tiers: 'race', lanes: LANES, speed: 1, pace: 'show', app: 'orders' }, (e) => { events.push(e); engine.observe(e); });
    const clock = new WaveClock({ engine, record: (e) => events.push(e), wave: 1, orders: 4, seed: 7, frequency: 0.3, show: true, floor: false });
    for (let t = 0; t < 60_000; t += 250) clock.step(t);
    expect(events.filter((e) => e.type === 'chaos' || e.type.startsWith('boss'))).toEqual([]);
    expect(() => engine.chaos({ lane: 1, fault: 'http_404' })).not.toThrow();
  });

  it('creatures drawn for the events stay on the lane at every station', () => {
    for (const level of [1, 9, 11]) {
      const vm = emptyVM();
      vm.stages = APP_STAGES.orders.map((s) => ({ id: s.id, label: s.id, icon: 'x', workAnimation: 'read_mail' }));
      applyEvent(vm, { seq: 0, ts: 0, type: 'wave_start', wave: 1, detail: { lanes: LANES } } as never, 0);
      let t = 10;
      for (const e of byLevel.get(level)!) {
        if (e.type !== 'chaos' || e.detail?.source === 'boss') continue;
        const stage = String(e.detail?.stage ?? STAGES[0]);
        applyEvent(vm, { seq: t, ts: t, type: 'chaos', wave: 1, lane: Number(e.lane), stage, detail: { ...e.detail, scope: 'outer', depth: 1 } } as never, t);
        const l = vm.lanes.find((x) => x.lane === Number(e.lane))!;
        const list = shown(l, t + 1);
        const skelX = stationX(Math.max(0, STAGES.indexOf(stage)), STAGES.length);
        const { xs } = creatureSlots(list.length, skelX);
        for (const x of xs) { expect(x).toBeGreaterThanOrEqual(TRACK_X0 + 40); expect(x).toBeLessThanOrEqual(CREATURE_X1); }
        t += 10;
      }
    }
  });
});
