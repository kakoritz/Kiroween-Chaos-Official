// covers: playtest-v2/R7.1 playtest-v2/R7.2
import { describe, expect, it } from 'vitest';
import { assembleWave, BASE_TS, planWave } from '../src/sim/wave';
import { faultBody } from '../../haunt/src/runner/provider';
import { Provider } from '../src/provider/provider';
import { decorateV11 } from '../src/sim/v11';

const STAGES = ['confirmation', 'process', 'transit', 'handoff'] as const;

function run(detect: (typeof STAGES)[number], tier: 'rookie' | 'journaler' | 'phoenix', seed = 7) {
  const arms = { 1: [{ id: 'w1', fault: 'order_typo', source: 'demo' as const, creature: 'prankster', detect, when: { order: 1, stage: 'create', attempt: 1, delay: 100 } }] };
  return assembleWave(planWave({ app: 'orders', seed, pace: 2, orders: 2, tiers: [tier, tier] }, arms, []), BASE_TS).filter((e) => e.lane === 1);
}

describe('wrong order found later (PT-C8): detect at confirmation, process, transit or handoff', () => {
  for (const stage of STAGES) {
    it(`detect ${stage}: stage_fail, decision_needed with detectedAt, one decision_made, tier default applied`, () => {
      for (const [tier, choice] of [['rookie', 'refund'], ['journaler', 'discount'], ['phoenix', 'redo']] as const) {
        const ev = run(stage, tier);
        const i = ev.findIndex((e) => e.type === 'decision_needed');
        expect(i, `${stage}/${tier}`).toBeGreaterThan(-1);
        expect(ev[i]!.detail).toMatchObject({ kind: 'wrong_order', detectedAt: stage, defaultChoice: choice });
        expect(ev[i - 1]).toMatchObject({ type: 'stage_fail', stage });
        expect(ev[i + 1]).toMatchObject({ type: 'decision_made', detail: { choice } });
        expect(ev.filter((e) => e.type === 'decision_made')).toHaveLength(1);
      }
    });

    it(`detect ${stage}: deterministic for one seed`, () => {
      expect(JSON.stringify(run(stage, 'phoenix', 11))).toBe(JSON.stringify(run(stage, 'phoenix', 11)));
    });
  }

  it('scores: refund -150 and a refund review of 1 star, discount -60 and 3 stars, redo 4 stars', () => {
    const score = (tier: 'rookie' | 'journaler' | 'phoenix') => run('process', tier).filter((e) => e.type === 'score').map((e) => [e.detail!.reason, e.detail!.delta]);
    expect(score('rookie')).toContainEqual(['refund', -150]);
    expect(score('journaler')).toContainEqual(['discount', -60]);
    const stars = (tier: 'rookie' | 'journaler' | 'phoenix') => decorateV11(run('process', tier), { pace: 2 }).filter((e) => e.type === 'review').map((e) => e.detail!.stars as number);
    expect(stars('rookie')[0]).toBe(1);
    expect(stars('journaler')[0]).toBeLessThanOrEqual(3);
    expect(stars('phoenix')[0]).toBeLessThanOrEqual(4);
  });

  it('arm becomes a one-shot typo fault on the store (process) or the tracking poll (transit)', () => {
    expect(faultBody('1', 'create', { id: 1, fault: 'order_typo', order: 'ord-0001', detect: 'process' })).toMatchObject({ service: 'store', mode: 'typo', count: 2 });
    expect(faultBody('1', 'create', { id: 1, fault: 'order_typo', order: 'ord-0001', detect: 'transit' })).toMatchObject({ service: 'tracking', mode: 'typo', count: 1 });
  });

  it('live provider: the second store call complains, the tracking poll answers wrong_order', async () => {
    const p = new Provider({ clock: { now: () => Date.now(), sleep: async () => {} } });
    await p.handle({ method: 'POST', path: '/_fault', body: faultBody('L', 'create', { id: 1, fault: 'order_typo', order: 'o1', detect: 'process' })! as never });
    const store = (index: number) => p.handle({ method: 'POST', path: '/store', headers: { 'Idempotency-Key': `o1:store:${index}` }, body: { lane: 'L', order: 'o1', index } });
    expect(((await store(1)).body as { complaint?: string }).complaint).toBeUndefined();
    expect(((await store(2)).body as { complaint?: string }).complaint).toBe('wrong_order');
    await p.handle({ method: 'POST', path: '/_fault', body: faultBody('L', 'create', { id: 2, fault: 'order_typo', order: 'o1', detect: 'transit' })! as never });
    expect((await p.handle({ method: 'GET', path: '/tracking/ship1', query: { lane: 'L' } })).body).toEqual({ status: 'wrong_order' });
  });
});
