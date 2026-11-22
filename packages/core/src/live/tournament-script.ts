// The storm of one tournament round as a demo script: the seeded plan, once per live lane (same presses, same orders, same stages).
import { FAULTS } from '../../../haunt/src/chaos/catalog';
import { roundPlan, type RoundCfg } from '../../../haunt/src/tournament/rounds';
import type { DemoScript } from './demo';

const orderId = (n: number): string => `ord-${String(n).padStart(4, '0')}`;

export function roundScript(seed: string | number, round: number, cfg: RoundCfg, lanes: readonly number[], waveSeed: number, app: 'orders' | 'inbox' = 'orders'): DemoScript {
  const plan = roundPlan(seed, round, cfg, app);
  const presses: DemoScript['presses'] = [];
  for (const lane of lanes) {
    for (const p of plan) {
      presses.push({
        lane, fault: p.fault, creature: FAULTS.find((f) => f.id === p.fault)?.creature ?? p.fault,
        when: { lane, event: 'stage_start', stage: p.stage, order: orderId(p.order), attempt: 1 }, delayMs: 250,
        ...(p.point ? { point: p.point } : {}), ...(p.outageMs !== undefined ? { outageMs: p.outageMs } : {}), ...(p.fuzz ? { fuzz: p.fuzz, source: 'fuzz' as const } : {}),
      });
    }
  }
  return { name: `tournament-r${round}`, seed: waveSeed, pace: 'slow', orders: cfg.orders, lanes: 5, tiers: 'race', presses };
}
