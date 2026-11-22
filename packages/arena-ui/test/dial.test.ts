import { describe, expect, it } from 'vitest';
import { DIAL_DEFAULT, applyIntensity, defaultDial, isOverride, levelTip, levelWord, rampTip, readDial, snapLevel, valueText } from '../src/arena/dial';
import { applyEvent, emptyVM, loadSnapshot } from '../src/arena/model';
import { soundFor } from '../src/sound';

describe('intensity dial (TV3-U6)', () => {
  it('starts calm at level 3 and snaps any input to 1..11', () => {
    expect(defaultDial().level).toBe(DIAL_DEFAULT);
    expect(DIAL_DEFAULT).toBe(3);
    expect(snapLevel(0)).toBe(1);
    expect(snapLevel(14)).toBe(11);
    expect(snapLevel(4.6)).toBe(5);
    expect(snapLevel('7')).toBe(7);
    expect(snapLevel('x')).toBe(3);
  });
  it('has a word and a spoken value for every level, 11 is THROW EVERYTHING', () => {
    for (let l = 1; l <= 11; l++) { expect(levelWord(l).length).toBeGreaterThan(2); expect(valueText(l)).toContain(String(l)); expect(levelTip(l)).toContain('Level ' + l); }
    expect(levelWord(11)).toBe('THROW EVERYTHING');
    expect(isOverride(11)).toBe(true);
    expect(isOverride(10)).toBe(false);
    expect(valueText(3)).toBe('Level 3 of 10, calm');
    expect(valueText(11, true)).toContain('override');
    expect(valueText(5, true)).toContain('auto-ramp on');
    expect(levelTip(3)).toContain('0.7 faults per order');
    expect(rampTip(4, 11)).toContain('every 4 finished orders');
  });
  it('reads state.intensity and tolerates a server without it', () => {
    expect(readDial({})).toBeNull();
    expect(readDial({ intensity: { level: 9, autoRamp: true, everyN: 6, max: 10 } })).toEqual({ level: 9, autoRamp: true, everyN: 6, max: 10, source: 'server' });
  });
  it('folds intensity events, including ramp, into the view model', () => {
    const vm = emptyVM();
    loadSnapshot(vm, { app: 'orders', stages: [], lanes: [], intensity: { level: 3, autoRamp: false, everyN: 4, max: 11 } } as never, 0);
    expect(vm.intensity.level).toBe(3);
    applyEvent(vm, { seq: 1, ts: 1, type: 'intensity', detail: { level: 5, source: 'player', autoRamp: true } }, 0);
    expect(vm.intensity).toMatchObject({ level: 5, autoRamp: true, source: 'player' });
    applyEvent(vm, { seq: 2, ts: 2, type: 'intensity', wave: 1, detail: { level: 6, source: 'ramp', autoRamp: true } }, 0);
    expect(vm.intensity).toMatchObject({ level: 6, source: 'ramp' });
    applyEvent(vm, { seq: 3, ts: 3, type: 'intensity', detail: { source: 'ramp' } }, 0);
    expect(vm.intensity.level).toBe(6);
    const d = defaultDial();
    expect(applyIntensity(d, { level: 99 })).toBe(true);
    expect(d.level).toBe(11);
  });
  it('rises only when the dial hits 11', () => {
    expect(soundFor({ type: 'intensity', detail: { level: 11 } })).toBe('rise');
    expect(soundFor({ type: 'intensity', detail: { level: 10 } })).toBeNull();
    expect(soundFor({ type: 'intensity' })).toBeNull();
  });
});
