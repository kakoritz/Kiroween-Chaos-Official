import { describe, expect, it } from 'vitest';
import { Provider, type ProviderClock } from '../src/provider';
import { faultBody, RepeatDetector, scanRepeats } from '../../haunt/src/runner/provider';

const fast: ProviderClock = { now: () => Date.now(), sleep: async () => {} };
const post = (p: Provider, path: string, body: Record<string, unknown>, key?: string) =>
  p.handle({ method: 'POST', path, body, headers: key ? { 'Idempotency-Key': key } : {} });

describe('provider typo mode (PT-C8b)', () => {
  it('arm becomes a one-shot typo fault on email, or on handoff with detect', () => {
    const a = faultBody('1', 'create', { id: 1, fault: 'order_typo', order: 'ord-0001' });
    expect(a).toMatchObject({ lane: '1', service: 'email', mode: 'typo', order: 'ord-0001', count: 1 });
    const b = faultBody('1', 'create', { id: 2, fault: 'order_typo', order: 'ord-0001', detect: 'handoff' });
    expect(b).toMatchObject({ service: 'handoff', mode: 'typo', block: 'wrong_order' });
  });

  it('confirmation: the email answers 201 with a complaint, once, only for that order', async () => {
    const p = new Provider({ clock: fast });
    await p.handle({ method: 'POST', path: '/_fault', body: faultBody('L', 'create', { id: 1, fault: 'order_typo', order: 'o1' })! as never });
    const other = await post(p, '/emails', { lane: 'L', order: 'o2' }, 'o2:email');
    expect(other.body).not.toHaveProperty('complaint');
    const r = await post(p, '/emails', { lane: 'L', order: 'o1' }, 'o1:email');
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ complaint: 'wrong_order' });
    expect(p.ledger('L').filter((x) => x.order === 'o1')).toHaveLength(1);
    const again = await post(p, '/emails', { lane: 'L', order: 'o1' }, 'o1:email2');
    expect(again.body).not.toHaveProperty('complaint');
  });

  it('handoff: the handoff call answers wrong_order', async () => {
    const p = new Provider({ clock: fast });
    await p.handle({ method: 'POST', path: '/_fault', body: faultBody('L', 'create', { id: 1, fault: 'order_typo', order: 'o1', detect: 'handoff' })! as never });
    const r = await p.handle({ method: 'GET', path: '/handoff/sh_1', query: { lane: 'L' } });
    expect(r.body).toEqual({ status: 'wrong_order' });
  });

  it('refund and discount are ledger kinds with keys and replays', async () => {
    const p = new Provider({ clock: fast });
    const a = await post(p, '/refunds', { lane: 'L', order: 'o1', amount: 500 }, 'o1:refund');
    const b = await post(p, '/refunds', { lane: 'L', order: 'o1', amount: 500 }, 'o1:refund');
    expect((a.body as { id: string }).id).toBe('rf_1');
    expect(b.headers['Idempotent-Replayed']).toBe('true');
    expect(((await post(p, '/discounts', { lane: 'L', order: 'o1' }, 'o1:discount')).body as { id: string }).id).toBe('dc_1');
    expect(p.ledger('L')).toHaveLength(2);
  });
});

describe('P15: ledger exemption', () => {
  const row = (kind: string, key: string | null) => ({ lane: 'L', order: 'o1', kind, key, index: null }) as never;
  it('a :rN charge after a refund is not a repeat, a plain second charge still is', () => {
    const d = new RepeatDetector();
    expect(d.add(row('charge', 'o1:charge'))).toBeNull();
    expect(d.add(row('refund', 'o1:refund'))).toBeNull();
    expect(d.add(row('charge', 'o1:charge:r1'))).toBeNull();
    expect(d.add(row('charge', 'o1:charge:x'))).toMatchObject({ kind: 'charge', count: 2 });
  });
  it('a :rN charge without a refund before it is still a repeat', () => {
    expect(scanRepeats([row('charge', 'o1:charge'), row('charge', 'o1:charge:r1')] as never)).toHaveLength(1);
  });
  it('refund and discount rows never count as repeats', () => {
    expect(scanRepeats([row('refund', 'a'), row('refund', 'b'), row('discount', 'c'), row('discount', 'd')] as never)).toHaveLength(0);
  });
});