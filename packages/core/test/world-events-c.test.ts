// covers: playtest-v2/R6.1
import { describe, expect, it } from 'vitest';
import { resolveOutcome, creatureForFault } from '@haunt/shared';
import { assembleWave, BASE_TS, planWave } from '../src/sim/wave';
import { faultBody } from '../../haunt/src/runner/provider';
import { faultById } from '../../haunt/src/chaos/catalog';
import { CREATURES, FAULT_IDS } from '../src/live/catalog';

// Transit faults (V1_2 section 4): stalls and reroutes on the tracking poll.
const CASES = [
  { fault: 'weather', creature: 'storm_crow', mode: 'stall', forMs: 1800, retry: 'OK', phoenix: 'OK' },
  { fault: 'road_hazard', creature: 'pothole_imp', mode: 'stall', forMs: 4000, retry: 'FAILED', phoenix: 'OK' },
  { fault: 'delay', creature: 'scarecrow', mode: 'stall', forMs: 600, retry: 'OK', phoenix: 'OK' },
  { fault: 'out_of_gas', creature: 'fuel_wraith', mode: 'stall', forMs: 7000, retry: 'FAILED', phoenix: 'PARKED_OK' },
  { fault: 'not_on_truck', creature: 'lost_parcel_ghoul', mode: 'no_driver', forMs: 4000, retry: 'FAILED', phoenix: 'PARKED_OK' },
] as const;

describe('world events c: transit faults (PT-C7)', () => {
  for (const c of CASES) {
    it(`${c.fault}: catalog, provider body, creature`, () => {
      const def = faultById(c.fault)!;
      expect(def.creature).toBe(c.creature);
      expect(def.stages).toEqual(['transit']);
      expect(faultBody('lane1', 'transit', { id: 1, fault: c.fault })).toMatchObject({ lane: 'lane1', service: 'tracking', mode: c.mode, forMs: c.forMs });
      expect(creatureForFault(c.fault)?.id).toBe(c.creature);
      const cr = CREATURES.find((x) => x.id === c.creature)!;
      expect(cr.causes).toContain(c.fault);
      expect(cr.family).toBe('world');
      expect(cr.apps).toEqual(['orders']);
      expect(FAULT_IDS.has(c.fault)).toBe(true);
    });

    it(`${c.fault}: outcomes by tier, deferred off its stage`, () => {
      expect(resolveOutcome('orders', 'rookie', c.fault, 'payment')).toBeNull();
      expect(resolveOutcome('orders', 'rookie', c.fault, 'transit')!.outcome).toBe('FAILED');
      for (const tier of ['retrier', 'journaler', 'reconciler'] as const) expect(resolveOutcome('orders', tier, c.fault, 'transit')!.outcome).toBe(c.retry);
      expect(resolveOutcome('orders', 'phoenix', c.fault, 'transit')!.outcome).toBe(c.phoenix);
    });

    it(`${c.fault}: the mock simulator agrees with the table`, () => {
      for (const tier of ['rookie', 'retrier', 'phoenix'] as const) {
        const arms = { 1: [{ id: 'w1', fault: c.fault, source: 'demo' as const, creature: c.creature, when: { order: 1, stage: 'transit', attempt: 1, delay: 300 } }] };
        const ev = assembleWave(planWave({ app: 'orders', seed: 7, pace: 2, orders: 2, tiers: [tier, tier] }, arms, []), BASE_TS);
        const chaos = ev.filter((e) => e.type === 'chaos' && e.lane === 1);
        expect(chaos[0]!.detail).toMatchObject({ fault: c.fault, creature: c.creature });
        const first = ev.find((e) => e.lane === 1 && (e.type === 'order_done' || e.type === 'order_failed' || e.type === 'order_parked'));
        const want = resolveOutcome('orders', tier, c.fault, 'transit')!.outcome;
        if (want === 'FAILED') expect(first?.type).toBe('order_failed');
        else expect(first?.type).not.toBe('order_failed');
        if (want !== 'OK' || tier !== 'rookie') expect(ev.some((e) => e.lane === 1 && e.stage === 'transit' && e.type === 'stage_fail')).toBe(true);
      }
    });
  }
});
