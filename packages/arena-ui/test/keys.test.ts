import { describe, expect, it } from 'vitest';
import { STATE_LEGEND, chaosAnnouncement, isNextKey, keyAction, nextMode } from '../src/arena/keys';
import { presentFromQuery } from '../src/mode';

describe('keyboard chaos', () => {
  it('maps digits to lanes inside the lane count', () => {
    expect(keyAction({ key: '1' }, 5)).toEqual({ type: 'chaos', lane: 0 });
    expect(keyAction({ key: '5' }, 5)).toEqual({ type: 'chaos', lane: 4 });
    expect(keyAction({ key: '6' }, 5)).toBeNull();
    expect(keyAction({ key: '0' }, 5)).toBeNull();
  });
  it('reads present mode from the query string', () => {
    expect(presentFromQuery('?present=1')).toBe(true);
    expect(presentFromQuery('?present=0')).toBe(false);
    expect(presentFromQuery('')).toBe(false);
  });
  it('maps p to present mode and ignores it with modifiers', () => {
    expect(keyAction({ key: 'p' }, 5)).toEqual({ type: 'present' });
    expect(keyAction({ key: 'P' }, 5)).toEqual({ type: 'present' });
    expect(keyAction({ key: 'p', ctrlKey: true }, 5)).toBeNull();
    expect(keyAction({ key: 'p', targetTag: 'INPUT' }, 5)).toBeNull();
  });
  it('maps c, m and ? and ignores other keys', () => {
    expect(keyAction({ key: 'c' }, 5)).toEqual({ type: 'chaos' });
    expect(keyAction({ key: 'C' }, 5)).toEqual({ type: 'chaos' });
    expect(keyAction({ key: 'm' }, 5)).toEqual({ type: 'cycle-mode' });
    expect(keyAction({ key: '?' }, 5)).toEqual({ type: 'help' });
    expect(keyAction({ key: 'x' }, 5)).toBeNull();
  });
  it('never fires while typing, with modifiers, or on key repeat', () => {
    expect(keyAction({ key: '1', targetTag: 'INPUT' }, 5)).toBeNull();
    expect(keyAction({ key: 'c', targetTag: 'textarea' }, 5)).toBeNull();
    expect(keyAction({ key: 'c', editable: true }, 5)).toBeNull();
    expect(keyAction({ key: 'c', ctrlKey: true }, 5)).toBeNull();
    expect(keyAction({ key: '2', metaKey: true }, 5)).toBeNull();
    expect(keyAction({ key: 'c', repeat: true }, 5)).toBeNull();
    expect(keyAction({ key: 'c', targetTag: 'BUTTON' }, 5)).toEqual({ type: 'chaos' });
  });
  it('cycles modes off, manual, random', () => {
    expect(nextMode('off')).toBe('manual');
    expect(nextMode('manual')).toBe('random');
    expect(nextMode('random')).toBe('off');
  });
  it('announces the lane', () => {
    expect(chaosAnnouncement(2, 'Gremlin')).toBe('Chaos sent to lane 3: Gremlin');
    expect(chaosAnnouncement(undefined)).toBe('Chaos sent to a random lane');
  });
});

describe('color-blind safe legend', () => {
  it('gives every state its own icon and a word', () => {
    expect(new Set(STATE_LEGEND.map((s) => s.icon)).size).toBe(STATE_LEGEND.length);
    expect(STATE_LEGEND.every((s) => s.word.length > 2)).toBe(true);
    expect(STATE_LEGEND.length).toBe(9);
  });
});
describe('next wave key', () => {
  it('N works even with the Next round button focused; Space is left to the button', () => {
    expect(isNextKey({ key: 'n', targetTag: 'BUTTON' })).toBe(true);
    expect(isNextKey({ key: 'N' })).toBe(true);
    expect(isNextKey({ key: ' ', targetTag: 'BUTTON' })).toBe(false);
    expect(isNextKey({ key: ' ', targetTag: 'BODY' })).toBe(true);
    expect(isNextKey({ key: 'n', targetTag: 'INPUT' })).toBe(false);
    expect(isNextKey({ key: 'n', ctrlKey: true })).toBe(false);
  });
});
