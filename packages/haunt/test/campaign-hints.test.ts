import { describe, expect, it } from 'vitest';
import { checkNightHints, gearForFault, hintGear, hintText, loadCampaign, nightAttacks, orderId } from '../src/campaign';

const { nights, gear } = loadCampaign();
const night = (id: number) => nights[id - 1]!;

describe('night plans 1 to 3 (cp-night-1-3)', () => {
  it('night 1 crashes every order after the charge', () => {
    const a = nightAttacks(night(1));
    expect(a.map((x) => x.order)).toEqual([1, 2, 3, 4].map(orderId));
    expect(a.every((x) => x.fault === 'crash' && x.creature === 'reaper' && x.stage === 'payment' && x.point === 'after_effect_before_journal')).toBe(true);
  });

  it('night 2 mixes timeouts and server errors on four orders', () => {
    expect(nightAttacks(night(2)).map((x) => `${x.order}:${x.fault}`)).toEqual([
      'ord-0001:timeout', 'ord-0002:http_429', 'ord-0003:http_500', 'ord-0004:timeout',
    ]);
  });

  it('night 3 hits create with missing, bad and duplicate input', () => {
    expect(nightAttacks(night(3)).map((x) => `${x.stage}:${x.fault}`)).toEqual([
      'create:missing_file', 'create:malformed_payload', 'create:duplicate_request',
    ]);
  });
});

describe('hint mapping (cp-night-1-3)', () => {
  it('hint text matches the gear labels of gearHint for nights 1 to 3', () => {
    for (const n of nights.slice(0, 3)) expect(n.hint).toBe(hintText(n, gear));
  });

  it('maps the hint parts to shop gear in order', () => {
    expect(hintGear(night(1), gear).map((g) => g.label)).toEqual(['Spellbook', 'Seal']);
    expect(hintGear(night(2), gear).map((g) => g.badge)).toEqual(['R', 'B']);
    expect(hintGear(night(3), gear).map((g) => g.id)).toEqual(['coffin_stash', 'spellbook']);
  });

  it('suggests gear for a fault and nothing for an unmapped one', () => {
    expect(gearForFault('crash', gear)?.label).toBe('Seal');
    expect(gearForFault('missing_file', gear)?.label).toBe('Coffin Stash');
    expect(gearForFault('no_such_fault', gear)).toBeUndefined();
  });

  it('the shipped nights 1 to 3 have no plan or hint problems', () => {
    expect(checkNightHints(nights.slice(0, 3), gear)).toEqual([]);
  });

  it('reports a wrong hint and an order outside the night', () => {
    const bad = structuredClone(night(1));
    bad.hint = 'Try Lantern.';
    bad.orders = 2;
    bad.plan = [{ when: { lane: 1, event: 'stage_start', stage: 'payment', order: 'ord-0005', attempt: 1 }, lane: 1, fault: 'crash', creature: 'reaper' }];
    const p = checkNightHints([bad], gear);
    expect(p.some((x) => x.includes('should read "Try Spellbook and Seal."'))).toBe(true);
    expect(p.some((x) => x.includes('outside 2 orders'))).toBe(true);
  });
});
