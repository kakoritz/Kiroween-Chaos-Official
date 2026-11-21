import { describe, expect, it } from 'vitest';
import { MIN_GAP_MS, MuteState, canPlay, soundFor } from '../src/sound';

describe('sound trigger mapping', () => {
  it('maps events to the five sounds', () => {
    expect(soundFor({ type: 'stage_done' })).toBe('rattle');
    expect(soundFor({ type: 'order_start' })).toBe('creak');
    expect(soundFor({ type: 'process_dead' })).toBe('wail');
    expect(soundFor({ type: 'stage_fail' })).toBe('thud');
    expect(soundFor({ type: 'boss_warning' })).toBe('sting');
    expect(soundFor({ type: 'boss_start' })).toBe('sting');
  });
  it('stays silent for other events', () => {
    for (const t of ['hello', 'stage_progress', 'score', 'chaos', 'wave_end', undefined]) expect(soundFor({ type: t })).toBeNull();
  });
  it('rate limits each sound separately', () => {
    const last = { thud: 1000 };
    expect(canPlay('thud', 1000 + MIN_GAP_MS.thud - 1, last)).toBe(false);
    expect(canPlay('thud', 1000 + MIN_GAP_MS.thud, last)).toBe(true);
    expect(canPlay('wail', 1001, last)).toBe(true);
  });
  it('starts muted and toggles', () => {
    const m = new MuteState();
    expect(m.muted).toBe(true);
    expect(m.toggle()).toBe(false);
    expect(m.toggle()).toBe(true);
  });
});
