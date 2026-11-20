import { describe, expect, it } from 'vitest';
import { FAULTS, BOSSES } from '../src/chaos';
import { RandomChaos, bossForWave, planBoss } from '../src/runner';

function plan(seed: string, speed = 1) {
  const rc = new RandomChaos({ seed, frequency: 1, speed });
  const out: string[] = [];
  for (let t = 0; t < 600; t++) {
    const r = rc.tick('tracking', 'dispatch', t * rc.tickMs);
    if (r) out.push(`${t}:${r.fault}`);
  }
  return out;
}

describe('random chaos tick', () => {
  it('is deterministic for a seed and timing', () => {
    expect(plan('s1')).toEqual(plan('s1'));
    expect(plan('s1')).not.toEqual(plan('s2'));
  });
  it('tick interval is 1000/speed', () => {
    expect(new RandomChaos({ seed: 1, frequency: 1, speed: 4 }).tickMs).toBe(250);
  });
  it('arms only faults applicable to the stage and never bosses', () => {
    const rc = new RandomChaos({ seed: 'a', frequency: 1 });
    for (let t = 0; t < 2000; t++) {
      const r = rc.tick('l', 'intake', t * 3000);
      if (r) {
        const def = FAULTS.find((f) => f.id === r.fault)!;
        expect(def.stages).toContain('intake');
        expect(BOSSES as readonly string[]).not.toContain(r.fault);
      }
    }
  });
  it('honours the 2500 ms cooldown per lane', () => {
    const rc = new RandomChaos({ seed: 'c', frequency: 1 });
    const times: number[] = [];
    for (let t = 0; t < 5000; t++) if (rc.tick('l', 'dispatch', t * 100)) times.push(t * 100);
    expect(times.length).toBeGreaterThan(1);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(2500);
  });
  it('never fires at frequency 0 or on an idle lane', () => {
    const z = new RandomChaos({ seed: 1, frequency: 0 });
    const f = new RandomChaos({ seed: 1, frequency: 1 });
    for (let t = 0; t < 500; t++) {
      expect(z.tick('l', 'dispatch', t * 3000)).toBeNull();
      expect(f.tick('l', null, t * 3000)).toBeNull();
    }
  });
  it('fires at about p = frequency * 0.08 per tick', () => {
    const rc = new RandomChaos({ seed: 'rate', frequency: 1 });
    let n = 0;
    for (let t = 0; t < 20000; t++) if (rc.tick(`l${t}`, 'dispatch', 0)) n++;
    expect(n / 20000).toBeGreaterThan(0.06);
    expect(n / 20000).toBeLessThan(0.1);
  });
});

describe('boss schedule', () => {
  it('rotates Lich, Banshee Queen, Horseman', () => {
    expect([1, 2, 3, 4].map(bossForWave)).toEqual(['boss_power_outage', 'boss_internet_outage', 'boss_hazard_storm', 'boss_power_outage']);
  });
  it('warns at 40% of expected duration and starts 8000 ms later', () => {
    const p = planBoss({ wave: 1, orders: 10 });
    expect(p.expectedMs).toBe(73500);
    expect(p.warnAtMs).toBe(29400);
    expect(p.startsInMs).toBe(8000);
    expect(p.startAtMs).toBe(37400);
  });
  it('scales by speed and pace', () => {
    const p = planBoss({ wave: 2, orders: 10, speed: 2, pace: 2 });
    expect(p.expectedMs).toBe(73500);
    expect(p.startsInMs).toBe(4000);
  });
});
