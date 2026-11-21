import { describe, expect, it } from 'vitest';
import { buildDoors, isUnlocked, moveFocus, parseProgress, emptyProgress, type HubNight } from '../src/campaign/hub-model';

const night = (id: number, extra: Partial<HubNight> = {}): HubNight => ({
  id, title: `T${id}`, briefing: 'b', lesson: ['a', 'b', 'c'], hint: 'h', orders: 5,
  medals: { bronze: { credits: 1 }, silver: { credits: 2 }, gold: { credits: 3 } }, ...extra,
});
const nights = [1, 2, 3, 4, 5, 6, 7].map((i) => night(i, i === 7 ? { finale: true } : {}));

describe('campaign hub model', () => {
  it('opens night 1 and gates the rest on bronze of the previous night', () => {
    expect(isUnlocked(1, {})).toBe(true);
    expect(isUnlocked(2, {})).toBe(false);
    expect(isUnlocked(2, { '1': 'bronze' })).toBe(true);
    expect(isUnlocked(3, { '1': 'gold' })).toBe(false);
  });
  it('builds seven doors with state, medal and a spoken label', () => {
    const doors = buildDoors(nights, { ...emptyProgress(), medals: { '1': 'silver' }, best: { '1': 420 } });
    expect(doors).toHaveLength(7);
    expect(doors[0]).toMatchObject({ state: 'silver', locked: false, best: 420 });
    expect(doors[1]).toMatchObject({ state: 'open', locked: false });
    expect(doors[2]).toMatchObject({ state: 'locked', locked: true });
    expect(doors[2].label).toContain('Locked');
    expect(doors[6].finale).toBe(true);
  });
  it('parses stored progress defensively', () => {
    expect(parseProgress(null)).toEqual(emptyProgress());
    expect(parseProgress('{nope')).toEqual(emptyProgress());
    const p = parseProgress(JSON.stringify({ credits: 12.7, owned: ['a', 3], medals: { '1': 'gold', '2': 'platinum' }, best: { '1': 9, '2': 'x' } }));
    expect(p).toEqual({ credits: 12, owned: ['a'], medals: { '1': 'gold' }, best: { '1': 9, '2': 0 } });
  });
  it('moves keyboard focus within bounds', () => {
    expect(moveFocus(0, 'ArrowLeft', 7)).toBe(0);
    expect(moveFocus(0, 'ArrowRight', 7)).toBe(1);
    expect(moveFocus(6, 'ArrowRight', 7)).toBe(6);
    expect(moveFocus(3, 'Home', 7)).toBe(0);
    expect(moveFocus(3, 'End', 7)).toBe(6);
    expect(moveFocus(3, 'x', 7)).toBe(3);
  });
});
