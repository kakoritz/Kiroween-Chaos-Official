// covers: CP-C1
// CP-C2: campaign acceptance 1 to 4 in in-process mode (virtual clock, no child processes).
import { describe, expect, it } from 'vitest';
import { loadCampaign } from '../../haunt/src/campaign/load';
import { computeMedal } from '../../haunt/src/campaign/medals';
import { simulateNight } from '../src/campaign/night-sim';
import { scanRepeats } from '../../haunt/src/runner/provider';
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

describe('the 11-step order through the real pipeline and provider ledger', () => {
  const PHOENIX: Part[] = ['retry', 'journal', 'idempotency', 'breaker', 'offline_queue'];
  it('Reconciler and Phoenix crash at payment on every order and the ledger still has one row per effect', async () => {
    for (const parts of [['retry', 'journal', 'idempotency'] as Part[], PHOENIX]) {
      const r = await simulateNight(night(1), parts);
      expect(scanRepeats(r.ledger)).toEqual([]);
      const per = new Map<string, number>();
      for (const row of r.ledger) per.set(`${row.order}|${row.kind}`, (per.get(`${row.order}|${row.kind}`) ?? 0) + 1);
      const kinds = [...new Set(r.ledger.map((x) => x.kind))].sort();
      expect(kinds).toEqual(['account', 'charge', 'dispatch', 'email', 'notify', 'order', 'store']);
      for (let i = 1; i <= night(1).orders; i++) {
        const o = `ord-${String(i).padStart(4, '0')}`;
        expect([per.get(`${o}|account`), per.get(`${o}|order`), per.get(`${o}|charge`), per.get(`${o}|store`), per.get(`${o}|dispatch`)]).toEqual([1, 1, 1, 2, 1]);
      }
    }
  });

  it('with no parts the Crew repeats account, order and charge when the crash lands at payment', async () => {
    const r = await simulateNight(night(1), []);
    const kinds = new Set(scanRepeats(r.ledger).map((x) => x.kind));
    expect(kinds.has('account') && kinds.has('order') && kinds.has('charge')).toBe(true);
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
