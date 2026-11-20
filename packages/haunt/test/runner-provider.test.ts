import { describe, expect, it } from 'vitest';
import { Provider, type FaultSpec, type ProviderClock } from '../../core/src/provider';
import { RepeatDetector, faultBody, postProviderArm, scanRepeats } from '../src/runner';

describe('faultBody', () => {
  it('maps http_429 on payment to the charge service with Retry-After', () => {
    const b = faultBody('L1', 'payment', { id: 1, fault: 'http_429', count: 3 })!;
    expect(b).toMatchObject({ lane: 'L1', service: 'charge', mode: 'status', value: 429, count: 3, headers: { 'Retry-After': '2' } });
  });
  it('internet_outage drops every service for a window', () => {
    const b = faultBody('L1', 'dispatch', { id: 2, fault: 'internet_outage', forMs: 8000 })!;
    expect(b).toMatchObject({ service: '*', mode: 'drop', forMs: 8000 });
    expect(b.count).toBeUndefined();
  });
  it('inner arms target recovery callers with count 1', () => {
    const b = faultBody('L1', 'account', { id: 3, fault: 'timeout', count: 1, nextCaller: 'recovery' })!;
    expect(b).toMatchObject({ service: 'account', mode: 'latency', value: 3000, count: 1, nextCaller: 'recovery' });
  });
  it('hazard_event stalls tracking', () => {
    expect(faultBody('L1', 'tracking', { id: 4, fault: 'hazard_event', forMs: 5000 })).toMatchObject({ service: 'tracking', mode: 'stall', value: 5000 });
  });
  it('returns null for process and file faults', () => {
    expect(faultBody('L1', 'payment', { id: 5, fault: 'crash' })).toBeNull();
    expect(faultBody('L1', 'intake', { id: 6, fault: 'missing_file' })).toBeNull();
  });
});

describe('postProviderArm against the provider', () => {
  it('a posted 500 fault makes the next charge fail with no ledger row', async () => {
    const clock: ProviderClock = { now: () => 0, sleep: async () => {} };
    const provider = new Provider({ clock });
    const post = async (body: FaultSpec) => {
      const r = await provider.handle({ method: 'POST', path: '/_fault', body: body as unknown as Record<string, unknown> });
      expect(r.status).toBe(200);
    };
    await postProviderArm(post, 'L1', 'payment', { id: 1, fault: 'http_500', count: 2 });
    const call = () => provider.handle({ method: 'POST', path: '/charges', body: { lane: 'L1', order: 'o1', amount: 5 }, headers: { 'Idempotency-Key': 'o1:charge' } });
    expect((await call()).status).toBe(500);
    expect((await call()).status).toBe(500);
    expect((await call()).status).toBe(201);
    expect(provider.ledger('L1')).toHaveLength(1);
  });
});

describe('RepeatDetector', () => {
  const row = (order: string, kind: string, index: number | null = null) => ({ lane: 'L1', order, kind: kind as never, index });
  it('emits a repeat with the total count on each extra row', () => {
    const d = new RepeatDetector();
    expect(d.add(row('o1', 'charge'))).toBeNull();
    expect(d.add(row('o1', 'charge'))).toEqual({ kind: 'charge', key: 'o1:charge', count: 2 });
    expect(d.add(row('o1', 'charge'))).toEqual({ kind: 'charge', key: 'o1:charge', count: 3 });
    expect(d.extraRows('L1')).toBe(2);
  });
  it('treats notify indexes as separate effects', () => {
    const d = new RepeatDetector();
    expect(d.add(row('o1', 'notify', 1))).toBeNull();
    expect(d.add(row('o1', 'notify', 2))).toBeNull();
    expect(d.add(row('o1', 'notify', 2))?.key).toBe('o1:notify:2');
  });
  it('scanRepeats and reset', () => {
    const rows = [row('o1', 'account'), row('o1', 'account'), row('o2', 'account')] as never[];
    expect(scanRepeats(rows)).toHaveLength(1);
    const d = new RepeatDetector();
    d.add(row('o1', 'charge')); d.reset();
    expect(d.add(row('o1', 'charge'))).toBeNull();
  });
});
