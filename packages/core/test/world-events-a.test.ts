import { describe, expect, it } from 'vitest';
import { resolveOutcome, creatureForFault } from '@haunt/shared';
import { assembleWave, BASE_TS, planWave } from '../src/sim/wave';
import { faultBody } from '../../haunt/src/runner/provider';
import { faultById } from '../../haunt/src/chaos/catalog';
import { CREATURES, FAULT_IDS } from '../src/live/catalog';

const CASES = [
  { fault: 'sms_down', creature: 'gargoyle', stage: 'confirmation', service: 'email' },
  { fault: 'app_down', creature: 'imp', stage: 'ship', service: 'dispatch' },
  { fault: 'updates_down', creature: 'goblin', stage: 'updates', service: 'notify' },
] as const;

describe('world events a: sms_down, app_down, updates_down (PT-C7, table L1 to L3)', () => {
  for (const c of CASES) {
    it(`${c.fault}: catalog, provider body, creature`, () => {
      const def = faultById(c.fault)!;
      expect(def.creature).toBe(c.creature);
      expect(def.stages).toEqual([c.stage]);
      const body = faultBody('lane1', c.stage, { id: 1, fault: c.fault });
      expect(body).toMatchObject({ lane: 'lane1', service: c.service, mode: 'status', value: 503, forMs: 8000 });
      expect(creatureForFault(c.fault)?.id).toBe(c.creature);
      expect(CREATURES.find((x) => x.id === c.creature)!.causes).toContain(c.fault);
      expect(FAULT_IDS.has(c.fault)).toBe(true);
    });

    it(`${c.fault}: defers off its stage and resolves at its stage`, () => {
      const other = c.stage === 'confirmation' ? 'payment' : 'confirmation';
      expect(resolveOutcome('orders', 'rookie', c.fault, other)).toBeNull();
      const rookie = resolveOutcome('orders', 'rookie', c.fault, c.stage)!;
      const phoenix = resolveOutcome('orders', 'phoenix', c.fault, c.stage)!;
      if (c.fault === 'updates_down') {
        expect(rookie.outcome).toBe('OK');
        expect(phoenix.outcome).toBe('OK');
      } else {
        expect(rookie.outcome).toBe('FAILED');
        expect(phoenix.outcome).toBe('PARKED_OK');
      }
    });

    it(`${c.fault}: mock simulator emits the chaos event with its creature`, () => {
      const arms = { 1: [{ id: 'w1', fault: c.fault, source: 'demo' as const, creature: c.creature, when: { order: 1, stage: c.stage, attempt: 1, delay: 300 } }] };
      const ev = assembleWave(planWave({ app: 'orders', seed: 7, pace: 2, orders: 2, tiers: ['rookie', 'phoenix'] }, arms, []), BASE_TS);
      const chaos = ev.filter((e) => e.type === 'chaos' && e.lane === 1);
      expect(chaos.length).toBeGreaterThan(0);
      expect(chaos[0]!.detail).toMatchObject({ fault: c.fault, creature: c.creature });
    });
  }
});
