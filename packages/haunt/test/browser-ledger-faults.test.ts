import { describe, expect, it } from 'vitest';
import { PageLedger } from '../src/browser/ledger';

describe('PageLedger provider faults', () => {
  it('status fault applies to the next N matching calls only', () => {
    const l = new PageLedger(() => 0);
    l.addFault({ lane: 'a', service: 'charge', mode: 'status', value: 500, count: 2 });
    expect(l.matchFault('b', 'charge', false)).toBeNull();
    expect(l.matchFault('a', 'email', false)).toBeNull();
    expect(l.matchFault('a', 'charge', false)?.value).toBe(500);
    expect(l.matchFault('a', 'charge', false)?.value).toBe(500);
    expect(l.matchFault('a', 'charge', false)).toBeNull();
  });

  it('window opens at the first matching call and closes after forMs', () => {
    let t = 1000;
    const l = new PageLedger(() => t);
    l.addFault({ lane: 'a', service: '*', mode: 'drop', forMs: 500 });
    t = 5000;
    expect(l.matchFault('a', 'email', false)?.mode).toBe('drop');
    t = 5400;
    expect(l.matchFault('a', 'charge', false)?.mode).toBe('drop');
    t = 5500;
    expect(l.matchFault('a', 'charge', false)).toBeNull();
  });

  it('nextCaller recovery skips normal calls', () => {
    const l = new PageLedger(() => 0);
    l.addFault({ lane: 'a', service: '*', mode: 'status', value: 503, count: 1, nextCaller: 'recovery' });
    expect(l.matchFault('a', 'charge', false)).toBeNull();
    expect(l.matchFault('a', 'charge', true)?.value).toBe(503);
  });
});
