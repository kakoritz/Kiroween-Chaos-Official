import { describe, expect, it } from 'vitest';
import { emptyLessons, learnRound, policyOf, DECISION_SIGNATURE } from '../src/tournament/lessons';
import { laneCases, type Case } from '../src/tournament/signature';
import { decisionChoice, parsePolicy } from '../src/sdk/policy';
import type { Ev } from '../src/tournament/rp';

const e = (type: string, detail: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Ev => ({ type, lane: '2', detail, ...extra });

function typoRound(choice: string, source: string, end: 'order_done' | 'order_failed'): Ev[] {
  return [
    e('order_start', {}, { order: 'ord-0001' }),
    e('chaos', { fault: 'order_typo', creature: 'prankster' }, { stage: 'create' }),
    e('stage_fail', { error: 'wrong_order', retryable: false }, { order: 'ord-0001', stage: 'confirmation' }),
    e('decision_needed', { order: 'ord-0001', detectedAt: 'confirmation' }),
    e('decision_made', { order: 'ord-0001', choice, source }),
    e(end, {}, { order: 'ord-0001' }),
  ];
}

describe('wrong-order decisions are learned (tournament, PT-C8)', () => {
  it('a case carries the decision the lane made', () => {
    const [c] = laneCases(typoRound('redo', 'user', 'order_done'), 2, 1);
    expect(c).toMatchObject({ fault: 'order_typo', outcome: 'solved', mechanism: 'decision', decision: { choice: 'redo', source: 'user' } });
  });

  it('a lane that picked redo and kept the order learns redo; the overlay carries it to the next round', () => {
    const cases = laneCases(typoRound('redo', 'user', 'order_done'), 2, 1);
    const r = learnRound(emptyLessons(2, 'retrier'), cases, 1);
    expect(r.newLessons).toEqual([expect.objectContaining({ signature: DECISION_SIGNATURE, via: 'overcame', mechanism: 'decision_redo', action: 'decision' })]);
    expect(r.firstOvercome).toEqual([DECISION_SIGNATURE]);
    expect(policyOf(r.next, 1).rules).toEqual([]);
    const next = policyOf(r.next, 2);
    expect(decisionChoice(parsePolicy(JSON.parse(JSON.stringify(next))))).toBe('redo');
  });

  it('a lane that lost the order to a refund learns from the loss: redo next time', () => {
    const cases = laneCases(typoRound('refund', 'timeout', 'order_failed'), 2, 1);
    expect(cases[0]).toMatchObject({ outcome: 'lost', decision: { choice: 'refund' } });
    const r = learnRound(emptyLessons(2, 'retrier'), cases, 1);
    expect(r.newLessons[0]).toMatchObject({ via: 'suggested', rule: { action: 'decision', choice: 'redo' } });
  });

  it('a better decision replaces a worse one, never the other way round', () => {
    const discount = learnRound(emptyLessons(3, 'journaler'), laneCases(typoRound('discount', 'timeout', 'order_done'), 2, 1), 1).next;
    expect(policyOf(discount, 9).rules[0]).toMatchObject({ choice: 'discount' });
    const redo = learnRound(discount, laneCases(typoRound('redo', 'user', 'order_done'), 2, 2), 2).next;
    expect(policyOf(redo, 9).rules).toHaveLength(1);
    expect(policyOf(redo, 9).rules[0]).toMatchObject({ choice: 'redo' });
    const back = learnRound(redo, laneCases(typoRound('discount', 'timeout', 'order_done'), 2, 3), 3);
    expect(back.newLessons).toEqual([]);
    expect(policyOf(back.next, 9).rules[0]).toMatchObject({ choice: 'redo' });
  });

  it('any tier can learn it, a Rookie too', () => {
    const r = learnRound(emptyLessons(1, 'rookie'), laneCases(typoRound('redo', 'user', 'order_done'), 2, 1), 1);
    expect(r.newLessons).toHaveLength(1);
  });
});
