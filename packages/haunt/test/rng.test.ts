import { describe, expect, it } from 'vitest';
import { fnv1a32, mulberry32, unit } from '@haunt/shared';

describe('rng', () => {
  it('fnv1a32 matches known vectors', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });

  it('mulberry32 is deterministic and in [0,1)', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('unit() is stateless', () => {
    expect(unit(7, 1, 'ord-0001', 'payment', 1)).toBe(unit(7, 1, 'ord-0001', 'payment', 1));
    expect(unit(7, 1, 'ord-0001', 'payment', 1)).not.toBe(unit(7, 1, 'ord-0001', 'payment', 2));
  });
});
