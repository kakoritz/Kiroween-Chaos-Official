import { describe, expect, it } from 'vitest';
import type { HauntEvent } from '../src/score/score';
import { RunnerEngine, WaveClock, ledgerCallback } from '../src/runner';

function setup(mode: 'off' | 'manual' | 'random', frequency = 1) {
  const events: HauntEvent[] = [];
  const engine = new RunnerEngine();
  engine.setChaosMode({ mode, frequency, seed: 7 });
  engine.startWave(1, { orders: 4, seed: 7, tiers: 'mixed' as never, lanes: 2, speed: 1, pace: 'normal', app: 'a' }, (e) => events.push(e));
  const record = (e: HauntEvent) => events.push(e);
  const clock = new WaveClock({ engine, record, wave: 1, orders: 4, seed: 7, frequency, laneInfo: () => ({ state: 'working', stage: 'ship' }) });
  return { events, engine, clock };
}

describe('WaveClock', () => {
  it('fires nothing while mode is manual', () => {
    const { events, clock } = setup('manual');
    clock.step(14000);
    expect(events).toHaveLength(0);
    // Only the never-perfect floor (spec 5.3) acts in manual mode: one gremlin per lane, after the middle of the round.
    clock.step(60000);
    expect(events.map((e) => [e.type, e.detail?.source])).toEqual([['chaos', 'gremlin'], ['chaos', 'gremlin']]);
  });

  it('fires random chaos tagged source random', () => {
    const { events, clock } = setup('random');
    clock.step(10000);
    const chaos = events.filter((e) => e.type === 'chaos');
    expect(chaos.length).toBeGreaterThan(0);
    expect(chaos.every((e) => e.detail?.source === 'random')).toBe(true);
  });

  it('is deterministic for a seed', () => {
    const a = setup('random'); a.clock.step(30000);
    const b = setup('random'); b.clock.step(30000);
    expect(a.events.map((e) => `${e.lane}:${e.detail?.fault}`)).toEqual(b.events.map((e) => `${e.lane}:${e.detail?.fault}`));
  });

  it('runs the boss schedule: warning, start with one chaos per lane, end', () => {
    const { events, clock } = setup('random', 0);
    const b = clock.boss;
    clock.step(b.warnAtMs - 1);
    expect(events.some((e) => e.type === 'boss_warning')).toBe(false);
    clock.step(b.warnAtMs);
    const w = events.find((e) => e.type === 'boss_warning')!;
    expect(w.detail).toMatchObject({ boss: 'boss_power_outage', startsInMs: 8000 });
    expect(w.lane).toBeUndefined();
    clock.step(b.startAtMs);
    expect(events.some((e) => e.type === 'boss_start')).toBe(true);
    expect(events.filter((e) => e.type === 'chaos' && e.detail?.source === 'boss').map((e) => e.lane).sort()).toEqual(['1', '2']);
    clock.step(b.startAtMs + 20000);
    expect(events.filter((e) => e.type === 'boss_end')).toHaveLength(1);
    clock.step(b.startAtMs + 90000);
    expect(events.filter((e) => e.type === 'boss_warning')).toHaveLength(1);
  });

  it('start/stop drive step from an injected interval', () => {
    const { clock } = setup('manual');
    let cb: (() => void) | undefined;
    let t = 0;
    clock.start(() => t, ((f: () => void) => { cb = f; return 1 as never; }) as never);
    t = 5000; cb!();
    expect(clock.elapsedMs).toBe(5000);
    clock.stop((() => {}) as never);
  });
});

describe('ledgerCallback', () => {
  it('emits a repeat event on the second row of an effect', () => {
    const events: HauntEvent[] = [];
    const cb = ledgerCallback((e) => events.push(e));
    const row = { id: 'x', lane: '1', kind: 'charge', order: 'o1', key: 'k', amount: 5, index: null, ts: 1 } as never;
    cb(row);
    expect(events).toHaveLength(0);
    cb(row);
    cb(row);
    expect(events.map((e) => e.detail?.count)).toEqual([2, 3]);
    expect(events[0]).toMatchObject({ type: 'repeat', lane: '1', order: 'o1', detail: { kind: 'charge', key: 'o1:charge' } });
  });
});
