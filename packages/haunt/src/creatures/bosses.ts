// The three bosses as plugins: Lich (power outage), Banshee Queen (internet outage), Headless Horseman
// (hazard storm). A boss hits every lane at once. Spec: tasks.md H2.3, design.md section 5, runtime.md section 12.
import type { ArmRequest, LaneInfo } from '../chaos/director';
import type { BossId } from '../chaos/catalog';
import type { CreaturePlugin } from './plugin';
import { need, type CoreContext } from './core';

/** What the engine attaches for a boss: every lane's state and a way to press one fault on one lane. */
export interface BossContext extends CoreContext {
  lanes?: Record<string, LaneInfo>;
  /** Builds the per-lane arms for a boss (the director's `bossArms`). */
  bossArms?: (boss: BossId, lanes: Record<string, LaneInfo>) => { lane: string; req: ArmRequest }[];
  /** Presses one fault on one lane with source "boss". */
  press?: (lane: string, req: ArmRequest) => void | Promise<void>;
}

function boss(id: string, label: string, family: CreaturePlugin['family'], fault: BossId): CreaturePlugin {
  return {
    id, label, family, faults: [fault],
    async inject(ctx, f) {
      const c = ctx as BossContext;
      const lanes = need(c.lanes, 'lanes', f);
      const arms = need(c.bossArms, 'bossArms', f)(fault, lanes);
      const press = need(c.press, 'press', f);
      for (const { lane, req } of arms) await press(lane, req);
    },
  };
}

export const lich = boss('lich', 'Lich', 'process', 'boss_power_outage');
export const bansheeQueen = boss('banshee_queen', 'Banshee Queen', 'network', 'boss_internet_outage');
export const headlessHorseman = boss('headless_horseman', 'Headless Horseman', 'world', 'boss_hazard_storm');

export const BOSS_CREATURES: readonly CreaturePlugin[] = [lich, bansheeQueen, headlessHorseman];

