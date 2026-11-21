import { describe, expect, it } from 'vitest';
import { modeBadge } from '../src/mode';
import { hasStarted, quietBadge, rankGlyph, waveLabel } from '../src/onboarding/polish';

describe('first-impression polish', () => {
  it('has no wave text before a wave', () => {
    expect(waveLabel(0)).toBe('');
    expect(waveLabel(4)).toBe('Wave 4');
  });
  it('shows Ready instead of MOCK while idle', () => {
    const b = modeBadge('mock', 'live');
    expect(quietBadge(b, { waveNo: 0, demoRunning: false }).label).toBe('Ready');
    expect(quietBadge(b, { waveNo: 1, demoRunning: false }).label).toBe('MOCK');
    expect(quietBadge(b, { waveNo: 0, demoRunning: true }).label).toBe('MOCK');
  });
  it('leaves live and error badges alone', () => {
    const live = modeBadge('live', 'live');
    expect(quietBadge(live, { waveNo: 0, demoRunning: false })).toBe(live);
    const off = modeBadge(null, 'closed');
    expect(quietBadge(off, { waveNo: 0, demoRunning: false })).toBe(off);
  });
  it('does not crown a zero score', () => {
    expect(rankGlyph(0, 0)).toBe('1');
    expect(rankGlyph(0, 10)).toBe('\u265B');
    expect(rankGlyph(1, 10)).toBe('2');
  });
  it('tracks started state', () => {
    expect(hasStarted({ waveNo: 0, demoRunning: false })).toBe(false);
  });
});

