import { describe, expect, it } from 'vitest';
import { BOSS_CREATURES, CORE_CREATURES, CreatureRegistry, EXTRA_CREATURES, type BossContext } from '../src/creatures';
import { BOSSES } from '../src/chaos/catalog';
import { ChaosDirector, type ArmRequest } from '../src/chaos/director';

const lanes = { L1: { state: 'working', stage: 'payment' }, L2: { state: 'working', stage: 'intake' }, L3: { state: 'working', stage: 'tracking' } } as BossContext['lanes'];

function ctx(): { c: BossContext; pressed: { lane: string; req: ArmRequest }[] } {
  const pressed: { lane: string; req: ArmRequest }[] = [];
  const dir = new ChaosDirector();
  const c: BossContext = {
    rng: () => 0.5, lane: '*', stage: null, lanes,
    bossArms: (b, l) => dir.bossArms(b, l),
    press: (lane, req) => { pressed.push({ lane, req }); },
  };
  return { c, pressed };
}

describe('boss creatures', () => {
  it('register next to the other 14 and cover every boss id once', () => {
    const r = new CreatureRegistry();
    for (const p of [...CORE_CREATURES, ...EXTRA_CREATURES, ...BOSS_CREATURES]) r.register(p);
    expect(r.list()).toHaveLength(17);
    for (const b of BOSSES) expect(r.forFault(b)?.faults).toEqual([b]);
    expect(r.get('lich')?.label).toBe('Lich');
    expect(r.get('banshee_queen')?.label).toBe('Banshee Queen');
    expect(r.get('headless_horseman')?.label).toBe('Headless Horseman');
  });

  it('lich crashes every lane: effect point on effect stages, mid_stage otherwise', async () => {
    const { c, pressed } = ctx();
    await BOSS_CREATURES[0]!.inject(c, 'boss_power_outage');
    expect(pressed).toEqual([
      { lane: 'L1', req: { fault: 'power_outage', point: 'after_effect_before_journal' } },
      { lane: 'L2', req: { fault: 'power_outage', point: 'mid_stage' } },
      { lane: 'L3', req: { fault: 'power_outage', point: 'after_effect_before_journal' } },
    ]);
  });

  it('banshee queen drops the network on every lane for 12000 ms', async () => {
    const { c, pressed } = ctx();
    await BOSS_CREATURES[1]!.inject(c, 'boss_internet_outage');
    expect(pressed).toHaveLength(3);
    for (const p of pressed) expect(p.req).toEqual({ fault: 'internet_outage', forMs: 12000 });
  });

  it('horseman presses hazard_event and http_429 on every lane', async () => {
    const { c, pressed } = ctx();
    await BOSS_CREATURES[2]!.inject(c, 'boss_hazard_storm');
    expect(pressed.map((p) => `${p.lane}:${p.req.fault}`)).toEqual(['L1:hazard_event', 'L1:http_429', 'L2:hazard_event', 'L2:http_429', 'L3:hazard_event', 'L3:http_429']);
  });

  it('fail loudly without engine helpers', async () => {
    await expect(BOSS_CREATURES[0]!.inject({ rng: () => 0, lane: '*', stage: null } as BossContext, 'boss_power_outage')).rejects.toThrow(/lanes/);
  });
});
