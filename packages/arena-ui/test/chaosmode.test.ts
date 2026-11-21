import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChaosModeModel, frequencyWord, modeRequest, parseSeed, readChaosState, snapFrequency } from '../src/arena/chaosmode';

describe('chaos mode helpers', () => {
  it('snaps frequency to 0.05 steps inside 0..1', () => {
    expect(snapFrequency(0.31)).toBe(0.3);
    expect(snapFrequency(0.33)).toBe(0.35);
    expect(snapFrequency(-2)).toBe(0);
    expect(snapFrequency(7)).toBe(1);
    expect(snapFrequency(NaN)).toBe(0.3);
  });
  it('names the frequency range from Calm to Storm', () => {
    expect([0, 0.3, 0.6, 1].map(frequencyWord)).toEqual(['Calm', 'Uneasy', 'Haunted', 'Storm']);
  });
  it('parses only whole-number seeds', () => {
    expect(parseSeed(' 42 ')).toBe(42);
    expect(parseSeed('')).toBeNull();
    expect(parseSeed('1.5')).toBeNull();
    expect(parseSeed('-3')).toBeNull();
    expect(parseSeed('99999999999')).toBeNull();
    expect(parseSeed('2147483648')).toBeNull();
  });
  it('sends frequency and seed only with Random', () => {
    expect(modeRequest('off', 0.5, 7)).toEqual({ mode: 'off' });
    expect(modeRequest('manual', 0.5, 7)).toEqual({ mode: 'manual' });
    expect(modeRequest('random', 0.52, 7)).toEqual({ mode: 'random', frequency: 0.5, seed: 7 });
    expect(modeRequest('random', 0.5, null)).toEqual({ mode: 'random', frequency: 0.5 });
  });
  it('reads the chaos block of a snapshot', () => {
    expect(readChaosState({ chaos: { mode: 'random', frequency: 0.8, seed: 9 } })).toEqual({ mode: 'random', frequency: 0.8, seed: 9 });
    expect(readChaosState({ chaos: { mode: 'weird' } })).toBeNull();
    expect(readChaosState({})).toBeNull();
  });
});

describe('ChaosModeModel', () => {
  afterEach(() => { vi.useRealTimers(); });
  const make = (fail = false) => {
    vi.useFakeTimers();
    const calls: unknown[] = [];
    const errors: unknown[] = [];
    const msgs: string[] = [];
    let changes = 0;
    const m = new ChaosModeModel({ setChaosMode: (o) => { calls.push(o); return fail ? Promise.reject(new Error('bad_request')) : Promise.resolve({}); }, onError: (e) => errors.push(e) },
      () => { changes++; }, (s) => msgs.push(s), () => 0.5);
    return { m, calls, errors, msgs, changes: () => changes };
  };
  it('posts a mode change right away, with seed and frequency only for Random', () => {
    const { m, calls } = make();
    m.choose('off'); m.choose('random');
    expect(calls).toEqual([{ mode: 'off' }, { mode: 'random', frequency: 0.3, seed: 500000 }]);
  });
  it('debounces slider moves into one request', () => {
    const { m, calls } = make();
    m.choose('random'); calls.length = 0;
    for (const v of [0.4, 0.6, 0.85]) m.setFrequency(v);
    expect(calls).toHaveLength(0);
    vi.advanceTimersByTime(300);
    expect(calls).toEqual([{ mode: 'random', frequency: 0.85, seed: 500000 }]);
  });
  it('does not post slider moves while Manual or Off', () => {
    const { m, calls } = make();
    m.setFrequency(0.9); vi.advanceTimersByTime(500);
    expect(calls).toHaveLength(0);
    expect(m.frequency).toBe(0.9);
  });
  it('sends an edited seed and rejects an invalid one', () => {
    const { m, calls } = make();
    m.choose('random'); calls.length = 0;
    expect(m.setSeedText('abc')).toBe(false);
    expect(m.setSeedText('1234')).toBe(true);
    vi.advanceTimersByTime(300);
    expect(calls).toEqual([{ mode: 'random', frequency: 0.3, seed: 1234 }]);
  });
  it('re-rolls the seed from the dice', () => {
    const { m, calls } = make();
    m.choose('random'); calls.length = 0;
    m.reroll(() => 0.25); vi.advanceTimersByTime(300);
    expect(calls).toEqual([{ mode: 'random', frequency: 0.3, seed: 250000 }]);
  });
  it('adopts the server state (seed only in Random)', () => {
    const { m, changes } = make();
    m.adopt({ mode: 'manual', frequency: 0.65, seed: 11 });
    expect([m.mode, m.frequency, m.seed]).toEqual(['manual', 0.65, 500000]);
    m.adopt({ mode: 'random', frequency: 0.2, seed: 11 });
    expect(m.seed).toBe(11);
    expect(changes()).toBe(2);
  });
  it('reports a failed request', async () => {
    const { m, errors, msgs } = make(true);
    m.choose('random');
    await vi.advanceTimersByTimeAsync(0);
    expect(errors).toHaveLength(1);
    expect(msgs.at(-1)).toBe('bad_request');
  });
});
