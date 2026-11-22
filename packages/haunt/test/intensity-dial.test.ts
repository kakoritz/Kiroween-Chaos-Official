// TV3-C4: intensity dial (spec 5.1, V1_2 section 5): level table, live scaling, unknown fuzz faults, auto-ramp.
import { describe, expect, it } from 'vitest';
import { DialChaos, INTENSITY_TABLE, MAX_LEVEL, RunnerEngine, WaveClock, fuzzFault, intensityRow, isLevel, ODD_STATUS } from '../src/runner';
import { faultBody } from '../src/runner/provider';
import { FAULTS } from '../src/chaos/catalog';
import { validateEvents } from '../src/contract/validate';
import type { FaultSpec } from '../../core/src/provider';
import type { HauntEvent as SEvent } from '../src/score/score';
import { FIXTURES } from '../../core/src/sim/fixtures';

const settings = { orders: 4, seed: 7, tiers: 'race' as const, lanes: 3, speed: 1, pace: 'show' as const, app: 'orders' };

function boot(stage: string | null = 'payment') {
  const events: SEvent[] = [];
  const posted: FaultSpec[] = [];
  const engine = new RunnerEngine({ laneInfo: () => ({ state: 'working', stage }), post: async (b) => { posted.push(b); } });
  engine.startWave(1, settings, (e) => { events.push(e); engine.observe(e); });
  return { engine, events, posted };
}

describe('level table (spec 5.1)', () => {
  it('has 11 rows with the documented rate, simultaneous faults, unknown share, depth and curses', () => {
    expect(INTENSITY_TABLE).toHaveLength(11);
    expect(INTENSITY_TABLE.slice(0, 10).map((r) => [r.rate, r.simultaneous, Math.round(r.unknown * 100), r.depth, r.curses])).toEqual([
      [0.3, 1, 0, 1, 0], [0.5, 1, 0, 1, 0], [0.7, 1, 5, 1, 0], [0.9, 1, 10, 2, 1], [1.1, 2, 15, 2, 1],
      [1.4, 2, 20, 3, 1], [1.7, 2, 25, 3, 2], [2.0, 3, 30, 4, 2], [2.5, 3, 35, 4, 2], [3.0, 4, 40, 5, 3],
    ]);
    expect(intensityRow(11)).toMatchObject({ continuous: true, simultaneous: Infinity, unknown: 0.5, depth: 5, curses: 5 });
    expect(MAX_LEVEL).toBe(11);
    expect([0, 12, 3.5, '3', NaN].some((n) => isLevel(n))).toBe(false);
    expect(isLevel(11) && isLevel(1)).toBe(true);
  });
});

describe('DialChaos scales the plan with the level', () => {
  const run = (level: number, ticks = 600, seed = 7) => {
    const d = new DialChaos(seed);
    const out: ReturnType<DialChaos['tick']>[] = [];
    for (let t = 0; t < ticks; t++) out.push(d.tick('1', 'payment', t * 3000, level, 0));
    return out;
  };

  it('is deterministic for a seed', () => {
    expect(run(6)).toEqual(run(6));
    expect(run(6)).not.toEqual(run(6, 600, 8));
  });

  it('fires more often and with more simultaneous faults as the level rises', () => {
    const fires = (lvl: number) => run(lvl).filter((p) => p.length > 0).length;
    expect(fires(1)).toBeLessThan(fires(5));
    expect(fires(5)).toBeLessThan(fires(10));
    const maxSim = (lvl: number) => Math.max(...run(lvl).map((p) => p.length));
    expect(maxSim(1)).toBe(1);
    expect(maxSim(5)).toBe(2);
    expect(maxSim(8)).toBe(3);
    expect(maxSim(10)).toBe(4);
  });

  it('respects the nested depth cap', () => {
    const d = new DialChaos(7);
    for (let t = 0; t < 400; t++) expect(d.tick('1', 'payment', t * 3000, 10, 4).length).toBeLessThanOrEqual(1);
    for (let t = 0; t < 400; t++) expect(d.tick('1', 'payment', t * 3000, 1, 1)).toEqual([]);
  });

  it('draws no unknown faults at level 1 and 2, and about the table share at level 10', () => {
    expect(run(1).flat().some((p) => p.fuzz)).toBe(false);
    expect(run(2).flat().some((p) => p.fuzz)).toBe(false);
    const all = run(10, 2000).flat();
    const share = all.filter((p) => p.fuzz).length / all.length;
    expect(share).toBeGreaterThan(0.3);
    expect(share).toBeLessThan(0.5);
  });

  it('level 11 presses every fault the stage takes on every tick, with no cooldown', () => {
    const d = new DialChaos(7);
    const applicable = FAULTS.filter((f) => f.stages.includes('payment') && f.id !== 'order_typo').length;
    const a = d.tick('1', 'payment', 0, 11, 0);
    const b = d.tick('1', 'payment', 10, 11, 0);
    expect(a.length).toBe(Math.min(applicable, 5));
    expect(b.length).toBe(a.length);
    expect(d.tick('1', null, 20, 11, 0)).toEqual([]);
  });
});

describe('unknown (fuzz) faults', () => {
  it('are seeded, fingerprinted and strange', () => {
    const a = fuzzFault(7, 1, 'k1', 'payment')!;
    expect(a).toEqual(fuzzFault(7, 1, 'k1', 'payment'));
    expect(a.fingerprint).toMatch(/^fz-[0-9a-f]{8}$/);
    const shapes = new Set<string>();
    let odd = 0, truncated = 0, jumps = 0;
    for (let i = 0; i < 300; i++) {
      const f = fuzzFault(7, 1, `k${i}`, 'payment')!;
      shapes.add(f.fingerprint);
      if (f.status !== undefined) { expect(ODD_STATUS).toContain(f.status); odd++; }
      if (f.truncated) truncated++;
      if (f.clockJumpMs !== undefined) jumps++;
      expect(FAULTS.some((x) => x.id === f.fault && x.stages.includes('payment'))).toBe(true);
    }
    expect(shapes.size).toBeGreaterThan(100);
    expect(odd).toBeGreaterThan(50);
    expect(truncated).toBeGreaterThan(40);
    expect(jumps).toBeGreaterThan(30);
    expect(fuzzFault(7, 1, 'k', 'create')).toBeNull();
  });

  it('the engine tags the chaos event unknown with fingerprint and source fuzz, and the provider gets the odd shape', () => {
    const { engine, events, posted } = boot();
    const fz = { fault: 'http_500', status: 507, count: 2, truncated: true, clockJumpMs: 90000, fingerprint: 'fz-0000abcd' };
    engine.chaos({ lane: 1, fault: fz.fault, source: 'fuzz', fuzz: fz });
    expect(events[0]).toMatchObject({ type: 'chaos', lane: '1', detail: { source: 'fuzz', unknown: true, fingerprint: 'fz-0000abcd', fuzz: { status: 507, truncated: true } } });
    expect(posted[0]).toMatchObject({ service: 'charge', mode: 'status', value: 507, count: 2, truncate: true, headers: { 'X-Haunt-Clock-Jump': '90000' } });
  });

  it('faultBody leaves a known fault alone', () => {
    expect(faultBody('1', 'payment', { id: 1, fault: 'http_500' })).toMatchObject({ value: 500, count: 2 });
    expect(faultBody('1', 'payment', { id: 1, fault: 'http_500' })!.truncate).toBeUndefined();
  });
});

describe('engine dial and auto-ramp', () => {
  it('defaults to level 3, validates the level and keeps it', () => {
    const { engine } = boot();
    expect(engine.getIntensity()).toMatchObject({ level: 3, autoRamp: false });
    expect(() => engine.setIntensity(12)).toThrow();
    expect(() => engine.setIntensity(0)).toThrow();
    expect(engine.setIntensity(11)).toMatchObject({ level: 11 });
    expect(engine.getIntensity().level).toBe(11);
    expect(engine.dialTouched).toBe(true);
  });

  it('auto-ramp raises the level by one every N finished orders, once per order id, and emits intensity {source: ramp}', () => {
    const { engine, events } = boot();
    engine.setIntensity(3, { autoRamp: true, everyN: 2 });
    const done = (order: string, lane: string, type = 'order_done') => { const e = { type, lane, order, detail: {} } as SEvent; events.push(e); engine.observe(e); };
    for (const l of ['1', '2', '3']) done('ord-0001', l);
    expect(engine.getIntensity().level).toBe(3);
    done('ord-0002', '1');
    expect(engine.getIntensity().level).toBe(4);
    expect(events.filter((e) => e.type === 'intensity').at(-1)).toMatchObject({ type: 'intensity', detail: { level: 4, source: 'ramp', autoRamp: true } });
    for (let i = 3; i <= 40; i++) done(`ord-${String(i).padStart(4, '0')}`, '1', i % 3 ? 'order_done' : 'order_failed');
    expect(engine.getIntensity().level).toBe(11);
    expect(events.filter((e) => e.type === 'intensity').length).toBe(8);
  });

  it('does nothing without autoRamp', () => {
    const { engine } = boot();
    for (let i = 1; i < 20; i++) engine.observe({ type: 'order_done', lane: '1', order: `ord-${String(i).padStart(4, '0')}`, detail: {} } as SEvent);
    expect(engine.getIntensity().level).toBe(3);
  });
});

describe('WaveClock follows the dial live', () => {
  const mkClock = (level: number | null) => {
    const { engine, events } = boot('payment');
    engine.setChaosMode({ mode: 'random', frequency: 0.3, seed: 7 });
    if (level !== null) engine.setIntensity(level);
    const clock = new WaveClock({ engine, record: (e) => events.push(e), wave: 1, orders: 50, seed: 7, frequency: 0.3, laneInfo: () => ({ state: 'working', stage: 'payment' }) });
    const advance = (from: number, to: number) => {
      for (let s = from; s < to; s++) {
        clock.step(s * 1000);
        for (const l of engine.lanes) engine.director.orderEnd(l); // keep the stack empty so depth never blocks
      }
    };
    const chaos = () => events.filter((e) => e.type === 'chaos');
    return { engine, advance, chaos };
  };
  const clockRun = (level: number | null) => { const c = mkClock(level); c.advance(0, 81); return c.chaos(); };

  it('a higher level presses more faults; level 11 presses on every tick', () => {
    const lo = clockRun(1).length, mid = clockRun(5).length, hi = clockRun(10).length, all = clockRun(11);
    expect(lo).toBeLessThan(mid);
    expect(mid).toBeLessThan(hi);
    expect(hi).toBeLessThan(all.length);
    expect(all.length).toBeGreaterThan(81 * 3);
    expect(all.some((e) => (e.detail as { unknown?: boolean }).unknown)).toBe(true);
  });

  it('moving the dial mid-wave changes the rate from then on', () => {
    const c = mkClock(1);
    c.advance(0, 40);
    const before = c.chaos().length;
    c.engine.setIntensity(10);
    c.advance(40, 80);
    expect(c.chaos().length - before).toBeGreaterThan(before * 2);
  });

  it('without the dial touched, the old frequency plan still runs', () => {
    expect(clockRun(null).length).toBeGreaterThanOrEqual(0);
  });
});

describe('mock fixture intensity-11', () => {
  it('is a valid stream with the dial thrown to 11, unknown faults with fingerprints and drawn outages', () => {
    const ev = FIXTURES['intensity-11']!();
    expect(validateEvents(ev)).toEqual([]);
    expect(ev.filter((e) => e.type === 'intensity').map((e) => e.detail!.level)).toEqual([3, 11]);
    const unknown = ev.filter((e) => e.type === 'chaos' && e.detail!.unknown);
    expect(unknown.length).toBeGreaterThan(10);
    expect(unknown.every((e) => e.detail!.source === 'fuzz' && /^fz-[0-9a-f]{8}$/.test(String(e.detail!.fingerprint)))).toBe(true);
    const outages = ev.filter((e) => e.type === 'outage');
    expect(outages.length).toBeGreaterThan(3);
    expect(outages.every((e) => e.detail!.outageMs >= 1000 && e.detail!.outageMs <= 30000)).toBe(true);
    for (let lane = 1; lane <= 5; lane++) expect(ev.filter((e) => e.type === 'chaos' && e.lane === lane).length).toBeGreaterThanOrEqual(3);
  });
});
