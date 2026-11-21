import { describe, expect, it } from 'vitest';
import { CALLOUT_MS, CaptionPlayer, FREEZE_MS, ccDefault, freezeFromQuery, matches } from '../src/onboarding/captions';
import type { ArenaEvent, Caption } from '../src/api/types';

const ev = (type: string, extra: Record<string, unknown> = {}): ArenaEvent => ({ seq: 1, ts: 0, type, ...extra }) as ArenaEvent;
const track: Caption[] = [
  { at: { ms: 0 }, text: 'first', ms: 1000 },
  { at: { ms: 2000 }, text: 'second', ms: 1000 },
  { at: { lane: 1, event: 'recover_start' }, text: 'crash', ms: 1500 },
];

describe('captions', () => {
  it('plays time offsets one line at a time', () => {
    const p = new CaptionPlayer();
    p.start('hero', track, 100);
    expect(p.tick(100).caption).toBe('first');
    expect(p.tick(1200).caption).toBeNull();
    expect(p.tick(2100).caption).toBe('second');
    expect(p.tick(3200).caption).toBeNull();
  });
  it('fires event triggers once and respects lane', () => {
    const p = new CaptionPlayer();
    p.start('x', track.slice(2), 0);
    p.event(ev('recover_start', { lane: 2 }), 5000);
    expect(p.tick(5000).caption).toBeNull();
    p.event(ev('recover_start', { lane: 1 }), 5000);
    expect(p.tick(5001).caption).toBe('crash');
    expect(p.tick(6600).caption).toBeNull();
    p.event(ev('recover_start', { lane: 1 }), 9000);
    expect(p.tick(9001).caption).toBeNull();
  });
  it('callouts overlay without pausing and expire', () => {
    const p = new CaptionPlayer();
    p.start('hero', track, 0);
    p.event(ev('recover_start', { lane: 1 }), 100);
    expect(p.tick(101).callout?.text).toBe('SAME CRASH');
    expect(p.frozen(101)).toBe(false);
    expect(p.tick(100 + CALLOUT_MS).callout).toBeNull();
  });
  it('freezes rendering only for the named beat', () => {
    const p = new CaptionPlayer('hero-crash');
    p.start('hero', track, 0);
    p.event(ev('recover_start', { lane: 1 }), 100);
    expect(p.frozen(101)).toBe(true);
    expect(p.frozen(100 + FREEZE_MS)).toBe(false);
    const q = new CaptionPlayer('other');
    q.start('hero', track, 0);
    q.event(ev('recover_start', { lane: 1 }), 100);
    expect(q.frozen(101)).toBe(false);
  });
  it('has no callouts for other scripts and stops cleanly', () => {
    const p = new CaptionPlayer();
    p.start('loop', track, 0);
    p.event(ev('recover_start', { lane: 1 }), 100);
    expect(p.tick(101).callout).toBeNull();
    p.stop();
    expect(p.tick(102).caption).toBeNull();
  });
  it('matches fields and parses helpers', () => {
    expect(matches({ event: 'order_done', lane: 5 }, ev('order_done', { lane: 5 }))).toBe(true);
    expect(matches({ event: 'order_done', lane: 5 }, ev('order_done', { lane: 1 }))).toBe(false);
    expect(freezeFromQuery('?freeze=hero-crash')).toBe('hero-crash');
    expect(freezeFromQuery('?freeze=a b')).toBeNull();
    expect(ccDefault(null, true)).toBe(true);
    expect(ccDefault(null, false)).toBe(false);
    expect(ccDefault('0', true)).toBe(false);
  });
});
