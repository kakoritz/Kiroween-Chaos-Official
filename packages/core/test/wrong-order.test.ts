import { describe, expect, it } from 'vitest';
import { resolveOutcome, creatureForFault } from '@haunt/shared';
import { assembleWave, BASE_TS, planWave } from '../src/sim/wave';
import { FAULT_IDS } from '../src/live/catalog';

const L8 = [
  { tier: 'rookie', outcome: 'CANCELLED', choice: 'refund' },
  { tier: 'retrier', outcome: 'CANCELLED', choice: 'refund' },
  { tier: 'journaler', outcome: 'OK', choice: 'discount' },
  { tier: 'reconciler', outcome: 'OK', choice: 'discount' },
  { tier: 'phoenix', outcome: 'OK', choice: 'redo' },
] as const;

describe('wrong order decisions (PT-C8, table L8)', () => {
  it('catalog: order_typo belongs to the prankster', () => {
    expect(creatureForFault('order_typo')?.id).toBe('prankster');
    expect(FAULT_IDS.has('order_typo')).toBe(true);
  });

  for (const c of L8) {
    it(`L8 ${c.tier}: ${c.choice}`, () => {
      expect(resolveOutcome('orders', c.tier, 'order_typo', 'create')!.outcome).toBe(c.outcome);
      expect(resolveOutcome('orders', c.tier, 'order_typo', 'payment')).toBeNull();
      const arms = { 1: [{ id: 'w1', fault: 'order_typo', source: 'demo' as const, creature: 'prankster', when: { order: 1, stage: 'create', attempt: 1, delay: 100 } }] };
      const ev = assembleWave(planWave({ app: 'orders', seed: 7, pace: 2, orders: 2, tiers: [c.tier, c.tier] }, arms, []), BASE_TS).filter((e) => e.lane === 1);
      const types = ev.map((e) => e.type);
      const i = types.indexOf('decision_needed');
      expect(i).toBeGreaterThan(-1);
      expect(types[i - 1]).toBe('stage_fail');
      expect(types[i + 1]).toBe('decision_made');
      expect(types.filter((t) => t === 'decision_made')).toHaveLength(1);
      expect(ev[i + 1]!.detail!.choice).toBe(c.choice);
      const kinds = ev.filter((e) => e.type === 'effect').map((e) => e.detail!.kind);
      if (c.choice === 'refund') {
        expect(kinds).toContain('refund');
        expect(ev.find((e) => e.type === 'order_failed')!.detail!).toMatchObject({ outcome: 'cancelled', reason: 'refunded' });
      } else if (c.choice === 'discount') {
        expect(kinds).toContain('discount');
        expect(ev.filter((e) => e.type === 'order_done').length).toBe(2);
      } else {
        expect(kinds).toContain('refund');
        expect(ev.some((e) => e.type === 'order_start' && e.detail!.redo === true)).toBe(true);
        const charges = ev.filter((e) => e.type === 'effect' && e.detail!.kind === 'charge');
        expect(charges.some((e) => /:r1$/.test(String(e.detail!.key)))).toBe(true);
      }
    });
  }
});
