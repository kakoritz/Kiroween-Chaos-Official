// CP-C2: campaign acceptance 1 to 4 in in-process mode (virtual clock, no child processes).
import { describe, expect, it } from 'vitest';
import { loadCampaign } from '../../haunt/src/campaign/nights';
import { computeMedal } from '../../haunt/src/campaign/medals';
import { simulateNight } from '../src/campaign/night-sim';
import type { Part } from '../../haunt/src/sdk';

const nights = loadCampaign().nights;
const night = (id: number) => nights.find((n) => n.id === id)!;
const SPELLBOOK_SEAL: Part[] = ['journal', 'idempotency'];
const LANTERN_SHIELD: Part[] = ['retry', 'breaker'];

describe('night 1, The Double Charge (acceptance 1)', () => {
  it('with no gear the Crew repeats effects and scores low', async () => {
    const r = await simulateNight(night(1), []);
    expect(r.summary.repeats).toBeGreaterThan(0);
    expect(r.summary.score).toBeLessThan(night(1).medals.silver.credits);
    expect(computeMedal(night(1), r.summary)).not.toBe('gold');
  });

  it('with Spellbook and Seal there are zero repeats', async () => {
    const r = await simulateNight(night(1), SPELLBOOK_SEAL);
    expect(r.summary.repeats).toBe(0);
    expect(r.summary.orders?.done).toBe(night(1).orders);
    const bare = await simulateNight(night(1), []);
    expect(r.summary.score).toBeGreaterThan(bare.summary.score);
  });
});

describe('night 2, Flaky Network (acceptance 2)', () => {
  it('with Lantern and Shield no order is cancelled', async () => {
    const r = await simulateNight(night(2), LANTERN_SHIELD);
    expect(r.summary.orders?.cancelled).toBe(0);
  });

  it('with no gear at least one order is cancelled', async () => {
    const r = await simulateNight(night(2), []);
    expect(r.summary.orders?.cancelled).toBeGreaterThanOrEqual(1);
  });
});

describe('night 5 (bosses) with all five parts', () => {
  it('survives the boss windows that start before the night ends with no repeats and no cancelled orders', async () => {
    const r = await simulateNight(night(5), ['retry', 'journal', 'idempotency', 'breaker', 'offline_queue']);
    expect(r.events.filter((e) => e.type === 'boss_start').length).toBeGreaterThanOrEqual(1);
    expect(r.summary.repeats).toBe(0);
    expect(r.summary.orders?.cancelled).toBe(0);
  });
});

describe('determinism (acceptance 4)', () => {
  const gear: Part[][] = [[], SPELLBOOK_SEAL, LANTERN_SHIELD, ['retry', 'journal', 'idempotency', 'breaker', 'offline_queue']];
  for (const n of [1, 2, 3, 4]) {
    it(`night ${n} gives the same lane 1 score for the same gear`, async () => {
      for (const parts of gear) {
        const a = await simulateNight(night(n), parts);
        const b = await simulateNight(night(n), parts);
        expect(b.summary).toEqual(a.summary);
        expect(b.events.map((e) => e.type)).toEqual(a.events.map((e) => e.type));
      }
    });
  }
});
