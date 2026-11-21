import { describe, expect, it } from 'vitest';
import { doorSvg, gearIconSvg, lockSvg, medalSvg, shopBackdropSvg } from '../src/campaign/art';

const wellFormed = (s: string): void => {
  expect(s.startsWith('<svg')).toBe(true);
  expect(s.trimEnd().endsWith('</svg>')).toBe(true);
  expect(s).toContain('aria-hidden="true"');
  expect(s).not.toMatch(/<image|href=|src=|url\(http/);
  expect((s.match(/<g[ >]/g) ?? []).length).toBe((s.match(/<\/g>/g) ?? []).length);
};

describe('campaign art', () => {
  it('draws a distinct medal per tier with 1, 2 or 3 pips', () => {
    const [b, s, g] = (['bronze', 'silver', 'gold'] as const).map((t) => medalSvg(t));
    [b, s, g].forEach(wellFormed);
    expect(new Set([b, s, g]).size).toBe(3);
    expect((b.match(/r="2.6"/g) ?? []).length).toBe(1);
    expect((s.match(/r="2.6"/g) ?? []).length).toBe(2);
    expect((g.match(/r="2.6"/g) ?? []).length).toBe(3);
    wellFormed(medalSvg(null));
    expect(medalSvg(null)).toContain('cpart--medal-none');
  });
  it('draws a door for every state, chained when locked, with a finale variant', () => {
    for (const st of ['locked', 'open', 'bronze', 'silver', 'gold'] as const) { wellFormed(doorSvg(st, 3)); expect(doorSvg(st, 3)).toContain(`cpart--door-${st}`); }
    expect(doorSvg('locked', 2)).toContain('stroke-dasharray');
    expect(doorSvg('open', 2)).not.toContain('stroke-dasharray');
    expect(doorSvg('open', 7, true)).toContain('FINALE');
    expect(doorSvg('open', 4)).toContain('>4<');
    wellFormed(lockSvg());
  });
  it('gives each of the five parts its own icon and a letter fallback', () => {
    const parts = ['retry', 'journal', 'idempotency', 'breaker', 'offline_queue'];
    const icons = parts.map((p) => gearIconSvg({ part: p, badge: 'X' }));
    icons.forEach(wellFormed);
    expect(new Set(icons).size).toBe(5);
    const other = gearIconSvg({ part: 'mystery', badge: 'Z<' });
    wellFormed(other);
    expect(other).toContain('>Z<');
    expect(other).not.toContain('Z<<');
  });
  it('draws the shop backdrop with two torches', () => {
    const s = shopBackdropSvg();
    wellFormed(s);
    expect((s.match(/translate\(/g) ?? []).length).toBe(2);
  });
});
