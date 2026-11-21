import { describe, expect, it } from 'vitest';
import { autoplayDecision, pickScript } from '../src/demo';

const base = { search: '', demoRunning: false, waveRunning: false, available: null };

describe('demo autoplay', () => {
  it('plays the playlist from hero on a bare load', () => {
    expect(autoplayDecision(base)).toEqual({ start: 'hero', chain: true });
  });
  it('plays one named script without chaining', () => {
    expect(autoplayDecision({ ...base, search: '?demo=meltdown' })).toEqual({ start: 'meltdown', chain: false });
  });
  it('stays quiet for ?demo=off', () => {
    expect(autoplayDecision({ ...base, search: '?demo=off' })).toEqual({ start: null, chain: false });
  });
  it('never interrupts a running show', () => {
    expect(autoplayDecision({ ...base, demoRunning: true }).start).toBeNull();
    expect(autoplayDecision({ ...base, waveRunning: true }).start).toBeNull();
  });
  it('rejects an unsafe script name', () => {
    expect(autoplayDecision({ ...base, search: '?demo=../x' }).start).toBe('hero');
  });
  it('walks hero, full, loop and wraps', () => {
    expect(pickScript(null, null)).toBe('hero');
    expect(pickScript('hero', null)).toBe('full');
    expect(pickScript('full', null)).toBe('loop');
    expect(pickScript('loop', null)).toBe('hero');
  });
  it('skips scripts the server does not have', () => {
    expect(pickScript('hero', ['hero', 'loop'])).toBe('loop');
  });
});
