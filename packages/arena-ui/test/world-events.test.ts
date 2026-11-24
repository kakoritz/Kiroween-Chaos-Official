// covers: playtest-v2/R6.2
import { describe, expect, it } from 'vitest';
import { isWorld, worldPhase, worldProp, WORLD_CAPTION } from '../src/arena/world-events';
import { captionOf } from '../src/arena/creatures';

describe('world events (PT-U10)', () => {
  it('knows the four world creatures', () => {
    for (const id of ['scarecrow', 'black_cat', 'phantom_car', 'prankster']) expect(isWorld(id)).toBe(true);
    expect(isWorld('gargoyle')).toBe(false);
  });

  it('shows no prop until the creature acts', () => {
    expect(worldProp('scarecrow', 'wrong_address', null, 100).kind).toBe('none');
    expect(worldProp('scarecrow', 'wrong_address', 500, 100).kind).toBe('none');
    expect(worldProp('scarecrow', 'wrong_address', 500, 600).kind).toBe('signpost');
  });

  it('maps each creature and fault to its prop', () => {
    expect(worldProp('black_cat', 'no_answer', 0, 10).kind).toBe('nobody_home');
    expect(worldProp('black_cat', 'gated_house', 0, 10).kind).toBe('gate_bars');
    expect(worldProp('phantom_car', 'car_accident', 0, 10).kind).toBe('crash');
    const p = worldProp('prankster', 'order_typo', 0, 10);
    expect(p.kind).toBe('wrong_order');
    expect(p.label).toBe('WRONG ORDER');
    expect(worldProp('imp', 'app_down', 0, 10).kind).toBe('none');
  });

  it('progress is clamped and scales with speed', () => {
    expect(worldPhase(0, 99999).p).toBe(1);
    expect(worldPhase(0, 100, 2).p).toBeGreaterThan(worldPhase(0, 100, 1).p);
    expect(worldPhase(null, 100).acted).toBe(false);
  });

  it('captions the world faults and the three caption-only creatures', () => {
    expect(captionOf('sms_down')).toBe('SMS DOWN');
    expect(captionOf('app_down')).toBe('APP DOWN');
    expect(captionOf('updates_down')).toBe('UPDATES DOWN');
    for (const f of Object.keys(WORLD_CAPTION)) expect(captionOf(f)).toBe(WORLD_CAPTION[f]);
  });
});
