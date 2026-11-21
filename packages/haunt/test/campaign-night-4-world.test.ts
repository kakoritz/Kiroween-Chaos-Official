import { describe, expect, it } from 'vitest';
import { BOSS_PART, FAULT_PART, WORLD_FAULT_PART, bossWindows, checkNightHints, checkWorldNights, gearForFault, hintText, loadCampaign, nightAttacks, worldFaults } from '../src/campaign';

const { nights, gear } = loadCampaign();
const night = (id: number) => nights[id - 1]!;

describe('night 4 world faults (cp-night-4-world)', () => {
  it('plans the five world faults in order', () => {
    expect(worldFaults(night(4))).toEqual(['sms_down', 'app_down', 'wrong_address', 'no_answer', 'car_accident']);
    expect(nightAttacks(night(4)).map((a) => a.creature)).toEqual(['gargoyle', 'imp', 'scarecrow', 'black_cat', 'phantom_car']);
  });

  it.each([
    ['sms_down', 'Shield'], ['app_down', 'Lantern'], ['wrong_address', 'Coffin Stash'],
    ['no_answer', 'Lantern'], ['car_accident', 'Coffin Stash'], ['order_typo', 'Coffin Stash'],
  ])('maps %s to %s', (fault, label) => {
    expect(gearForFault(fault, gear)?.label).toBe(label);
    expect(FAULT_PART[fault]).toBe(WORLD_FAULT_PART[fault]);
  });

  it('keeps the night 4 hint in step with its gear and plan', () => {
    expect(night(4).hint).toBe(hintText(night(4), gear));
    expect(checkNightHints([night(4)], gear)).toEqual([]);
  });
});

describe('nights 5 to 7 (cp-night-4-world)', () => {
  it('night 6 keeps its mapped faults and night 7 maps the typo', () => {
    expect(worldFaults(night(6)).every((f) => FAULT_PART[f])).toBe(true);
    expect(worldFaults(night(7))).toEqual(['order_typo']);
  });

  it('maps every boss to one of its key parts', () => {
    for (const id of [5, 7]) for (const w of bossWindows(night(id))) expect(w.keyParts).toContain(BOSS_PART[w.boss]);
    expect(bossWindows(night(7)).map((w) => w.boss)).toEqual(['boss_hazard_storm']);
  });

  it('the shipped nights 4 to 7 have no problems', () => {
    expect(checkWorldNights(nights, FAULT_PART, gear)).toEqual([]);
  });

  it('reports an unmapped fault', () => {
    const bad = structuredClone(nights);
    bad[3]!.plan.push({ afterPrevMs: 1, lane: 1, fault: 'meteor', creature: 'imp' });
    expect(checkWorldNights(bad, FAULT_PART, gear)).toContain('night 4: fault meteor has no part');
  });
});
