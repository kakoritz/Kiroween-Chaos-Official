// TV3-C5: random outage timer (spec 5.1 and 5.4, V1_2 section 5).
import { describe, expect, it } from 'vitest';
import { DEFAULT_LEVEL, INTENSITY_TABLE, OUTAGE_FAULTS, RunnerEngine, drawOutageMs, intensityRow } from '../src/runner';
import type { FaultSpec } from '../../core/src/provider';
import type { HauntEvent as SEvent } from '../src/score/score';
import type { HauntEvent } from '@haunt/shared';
import { validateEvents } from '../src/contract/validate';

const settings = { orders: 4, seed: 7, tiers: 'race' as const, lanes: 2, speed: 1, pace: 'show' as const, app: 'orders' };

function boot(seed = 7, speed = 1) {
  const events: SEvent[] = [];
  const posted: FaultSpec[] = [];
  const engine = new RunnerEngine({ laneInfo: () => ({ state: 'working', stage: 'payment' }), post: async (b) => { posted.push(b); } });
  engine.startWave(1, { ...settings, seed, speed }, (e) => events.push(e));
  return { engine, events, posted };
}

describe('outage ranges by level (spec 5.1)', () => {
  it('1 to 5 s at level 1 up to 1 to 30 s at level 10, default level 3', () => {
    expect(INTENSITY_TABLE.map((r) => r.outageMaxMs / 1000)).toEqual([5, 8, 10, 12, 15, 18, 22, 25, 28, 30, 30]);
    expect(DEFAULT_LEVEL).toBe(3);
    expect(intensityRow(1).outageMaxMs).toBe(5000);
    expect(intensityRow(10).outageMaxMs).toBe(30000);
  });

  it('draws uniformly inside the range, seeded', () => {
    for (const level of [1, 3, 7, 10]) {
      const max = intensityRow(level).outageMaxMs;
      const draws = Array.from({ length: 400 }, (_, i) => drawOutageMs(7, '1', `c1-${i}`, level));
      expect(Math.min(...draws)).toBeGreaterThanOrEqual(1000);
      expect(Math.max(...draws)).toBeLessThanOrEqual(max);
      const mean = draws.reduce((a, b) => a + b, 0) / draws.length;
      expect(Math.abs(mean - (1000 + max) / 2)).toBeLessThan((max - 1000) * 0.1);
      expect(draws).toEqual(Array.from({ length: 400 }, (_, i) => drawOutageMs(7, '1', `c1-${i}`, level)));
    }
    expect(drawOutageMs(7, '1', 'c1-1', 5)).not.toBe(drawOutageMs(8, '1', 'c1-1', 5));
  });
});

describe('engine: outage event on endpoint_down and service-down presses', () => {
  it('emits outage {lane, stage, outageMs, seed} after the chaos event and posts that window to the provider', () => {
    const { engine, events, posted } = boot();
    engine.chaos({ lane: 1, fault: 'endpoint_down' });
    const [chaos, outage] = events;
    expect(chaos!.type).toBe('chaos');
    expect(outage).toMatchObject({ type: 'outage', lane: '1', stage: 'payment', detail: { seed: 7, fault: 'endpoint_down', level: 3 } });
    const ms = (outage!.detail as { outageMs: number }).outageMs;
    expect(ms).toBeGreaterThanOrEqual(1000);
    expect(ms).toBeLessThanOrEqual(10000);
    expect(posted[0]!.forMs).toBe(ms);
  });

  it('same seed gives the same lengths; another seed does not', () => {
    const run = (seed: number) => { const b = boot(seed); for (const f of ['endpoint_down', 'sms_down', 'endpoint_down']) b.engine.chaos({ lane: 1, fault: f }); return b.events.filter((e) => e.type === 'outage').map((e) => (e.detail as { outageMs: number }).outageMs); };
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(9));
  });

  it('follows the dial level and divides the real window by speed', () => {
    const lo = boot(7, 4); lo.engine.level = 1;
    const hi = boot(7, 4); hi.engine.level = 10;
    const msLo: number[] = []; const msHi: number[] = [];
    for (let i = 0; i < 6; i++) {
      for (const [b, out] of [[lo, msLo], [hi, msHi]] as const) {
        b.engine.chaos({ lane: 1 + (i % 2), fault: 'endpoint_down' });
        out.push((b.events.filter((e) => e.type === 'outage').at(-1)!.detail as { outageMs: number }).outageMs);
        b.engine.director.orderEnd(String(1 + (i % 2)));
      }
    }
    expect(Math.max(...msLo)).toBeLessThanOrEqual(5000);
    expect(Math.max(...msHi)).toBeGreaterThan(5000);
    expect(lo.posted[0]!.forMs).toBe(Math.max(50, Math.round(msLo[0]! / 4)));
  });

  it('a fixed window (the plan sets recoverMs) is not drawn and has no outage event', () => {
    const { engine, events, posted } = boot();
    engine.chaos({ lane: 1, fault: 'endpoint_down', forMs: 12000 });
    expect(events.some((e) => e.type === 'outage')).toBe(false);
    expect(posted[0]!.forMs).toBe(12000);
  });

  it('other faults draw nothing', () => {
    const { engine, events } = boot();
    engine.chaos({ lane: 1, fault: 'http_500' });
    expect(events.some((e) => e.type === 'outage')).toBe(false);
    expect([...OUTAGE_FAULTS].sort()).toEqual(['app_down', 'endpoint_down', 'sms_down', 'updates_down']);
  });
});

describe('contract: the outage event validates', () => {
  it('schema accepts outage and rejects one without outageMs', () => {
    const base = (detail: object): HauntEvent[] => [
      { seq: 1, ts: 1, type: 'hello', contractVersion: 1, mode: 'mock', app: 'orders' } as never,
      { seq: 2, ts: 2, type: 'wave_start', wave: 1, detail: { orders: 1, seed: 7, tiers: 'race', lanes: 1, speed: 1, app: 'orders', pace: 'show' } },
      { seq: 3, ts: 3, type: 'lane_ready', wave: 1, lane: 1, detail: { tier: 'rookie', label: 'Rookie', parts: [] } },
      { seq: 4, ts: 4, type: 'outage', wave: 1, lane: 1, stage: 'payment', detail } as never,
    ];
    expect(validateEvents(base({ outageMs: 4200, seed: 7 })).filter((v) => v.rule === 'schema')).toEqual([]);
    expect(validateEvents(base({ seed: 7 })).some((v) => v.rule === 'schema')).toBe(true);
  });
});

describe('mock planner: a drawn outage replaces the fixed window', () => {
  it('adds an outage event and the window decides the outcome', async () => {
    const { planLane } = await import('../../core/src/sim/plan');
    const run = (outageMs: number | undefined) => planLane({ lane: 1, tier: 'retrier', app: 'orders', seed: 7, orders: 1, pace: 1 },
      [{ id: 'x', fault: 'endpoint_down', source: 'random', outageMs, when: { order: 1, stage: 'payment', delay: 5 } }]);
    const short = run(700);
    const ev = short.events.find((e) => e.type === 'outage')!;
    expect(ev.detail).toMatchObject({ outageMs: 700, seed: 7, fault: 'endpoint_down' });
    expect(ev.stage).toBe('payment');
    expect(run(undefined).events.some((e) => e.type === 'outage')).toBe(false);
    // 0.7 s is shorter than a Retrier's retries; the fixed 10 s window is not.
    expect(short.events.some((e) => e.type === 'order_done')).toBe(true);
    expect(run(undefined).events.some((e) => e.type === 'order_done')).toBe(false);
  });
});
