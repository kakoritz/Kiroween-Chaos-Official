// covers: playtest-v2/R6.1 playtest-v2/R6.3
import { describe, expect, it } from 'vitest';
import { resolveOutcome, creatureForFault } from '@haunt/shared';
import { assembleWave, BASE_TS, planWave } from '../src/sim/wave';
import { faultBody } from '../../haunt/src/runner/provider';
import { faultById } from '../../haunt/src/chaos/catalog';
import { CREATURES, FAULT_IDS } from '../src/live/catalog';
import { Provider } from '../src/provider/provider';

const CASES = [
  { fault: 'wrong_address', creature: 'scarecrow', stage: 'transit', service: 'tracking', mode: 'stall', forMs: 5000, row: 'L4' },
  { fault: 'no_answer', creature: 'black_cat', stage: 'handoff', service: 'handoff', mode: 'handoff_block', forMs: 3000, row: 'L5' },
  { fault: 'gated_house', creature: 'black_cat', stage: 'handoff', service: 'handoff', mode: 'handoff_block', forMs: 3000, row: 'L6' },
  { fault: 'car_accident', creature: 'phantom_car', stage: 'handoff', service: 'handoff', mode: 'handoff_block', forMs: 7000, row: 'L7' },
] as const;

describe('world events b: wrong_address, no_answer, gated_house, car_accident (PT-C7, table L4 to L7)', () => {
  for (const c of CASES) {
    it(`${c.row} ${c.fault}: catalog, provider body, creature`, () => {
      const def = faultById(c.fault)!;
      expect(def.creature).toBe(c.creature);
      expect(def.stages).toEqual([c.stage]);
      const body = faultBody('lane1', c.stage, { id: 1, fault: c.fault });
      expect(body).toMatchObject({ lane: 'lane1', service: c.service, mode: c.mode, forMs: c.forMs });
      expect(creatureForFault(c.fault)?.id).toBe(c.creature);
      const cr = CREATURES.find((x) => x.id === c.creature)!;
      expect(cr.causes).toContain(c.fault);
      expect(cr.family).toBe('world');
      expect(cr.apps).toEqual(['orders']);
      expect(FAULT_IDS.has(c.fault)).toBe(true);
    });

    it(`${c.row} ${c.fault}: outcomes by tier, deferred off its stage`, () => {
      expect(resolveOutcome('orders', 'rookie', c.fault, c.stage === 'transit' ? 'payment' : 'transit')).toBeNull();
      for (const tier of ['rookie', 'retrier', 'journaler', 'reconciler'] as const) {
        expect(resolveOutcome('orders', tier, c.fault, c.stage)!.outcome).toBe('FAILED');
      }
      const phoenix = resolveOutcome('orders', 'phoenix', c.fault, c.stage)!;
      expect(phoenix.outcome).toBe(c.fault === 'car_accident' ? 'PARKED_OK' : 'OK');
    });

    it(`${c.row} ${c.fault}: mock simulator emits chaos, failure and recovery`, () => {
      const arms = { 1: [{ id: 'w1', fault: c.fault, source: 'demo' as const, creature: c.creature, when: { order: 1, stage: c.stage, attempt: 1, delay: 300 } }] };
      for (const tier of ['rookie', 'phoenix'] as const) {
        const ev = assembleWave(planWave({ app: 'orders', seed: 7, pace: 2, orders: 2, tiers: [tier, tier] }, arms, []), BASE_TS);
        const chaos = ev.filter((e) => e.type === 'chaos' && e.lane === 1);
        expect(chaos.length).toBeGreaterThan(0);
        expect(chaos[0]!.detail).toMatchObject({ fault: c.fault, creature: c.creature });
        if (c.stage === 'handoff') {
          const fails = ev.filter((e) => e.type === 'stage_fail' && e.lane === 1 && e.stage === 'handoff');
          expect(fails.length).toBeGreaterThan(0);
        }
        if (tier === 'rookie') expect(ev.some((e) => e.lane === 1 && e.type === 'order_failed')).toBe(true);
      }
    });
  }

  it('live provider: handoff answers delivered, then the blocked status inside the window', async () => {
    const p = new Provider({ seed: 's' });
    const get = (): Promise<any> => p.handle({ method: 'GET', path: '/handoff/ship1', query: { lane: 'lane1' } });
    expect((await get()).body).toEqual({ status: 'delivered' });
    await p.handle({ method: 'POST', path: '/_fault', body: { lane: 'lane1', service: 'handoff', mode: 'handoff_block', block: 'gated', count: 2 } });
    expect((await get()).body).toEqual({ status: 'gated' });
    expect((await get()).body).toEqual({ status: 'gated' });
    expect((await get()).body).toEqual({ status: 'delivered' });
  });
});
