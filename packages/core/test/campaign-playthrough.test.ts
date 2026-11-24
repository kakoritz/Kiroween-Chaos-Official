// CP-PLAY: a headless playthrough of Haunted Nights 1 to 5 (no browser, no child processes, virtual clock).
// The player equips the gear each night teaches and must win a medal; the Rookie with no gear must lose. Same night, same gear,
// same result: every run below is a pure function of the night's seed. The live engine (real bots, real provider) is covered by
// `npm run e2e` (night 1) and by the CP-NIGHT tests in this folder; this file is the fast, deterministic one.
import { describe, expect, it } from 'vitest';
import { loadCampaign } from '../../haunt/src/campaign/load';
import { computeMedal, scoreNight, type Medal } from '../../haunt/src/campaign/medals';
import { simulateNight } from '../src/campaign/night-sim';
import type { Part } from '../../haunt/src/sdk';
import type { CampaignNight } from '../../haunt/src/campaign/types';

const { nights, gear, start } = loadCampaign();
const night = (id: number): CampaignNight => nights.find((n) => n.id === id)!;
const partOf = (id: string): Part => gear.find((g) => g.id === id)!.part as Part;

/** What each night's intended gear wins, and the least the Rookie may score. */
const PLAY: { id: number; gear: Part[]; medal: Medal }[] = [
  { id: 1, gear: ['journal', 'idempotency'], medal: 'gold' },
  { id: 2, gear: ['retry', 'breaker'], medal: 'gold' },
  { id: 3, gear: ['offline_queue', 'journal'], medal: 'gold' },
  { id: 4, gear: ['retry', 'journal', 'idempotency', 'breaker', 'offline_queue'], medal: 'gold' },
  { id: 5, gear: ['retry', 'journal', 'idempotency', 'breaker', 'offline_queue'], medal: 'gold' },
];
const rank = (m: Medal): number => ['none', 'bronze', 'silver', 'gold'].indexOf(m);

describe('the campaign data a player meets', () => {
  it('starts with no gear and 300 credits, and the shop sells the five parts at 200, 300, 300, 500 and 500', () => {
    expect(start).toEqual({ gear: [], credits: 300 });
    expect(gear.map((g) => g.cost)).toEqual([200, 300, 300, 500, 500]);
    expect(new Set(gear.map((g) => g.part)).size).toBe(5);
  });

  it('every night has a one-lesson briefing in plain words and a hint naming real gear', () => {
    for (const n of nights) {
      expect(n.briefing.length, `night ${n.id} briefing`).toBeGreaterThan(20);
      expect(n.lesson).toHaveLength(3);
      if (n.gearHint.length === gear.length) { expect(n.hint.toLowerCase()).toContain('all five'); continue; }
      for (const g of n.gearHint) expect(n.hint.toLowerCase(), `night ${n.id} hint names ${g}`).toContain(gear.find((x) => x.part === g)!.label.toLowerCase());
    }
  });
});

describe('playing nights 1 to 5', () => {
  for (const p of PLAY) {
    it(`night ${p.id}: the intended gear wins ${p.medal}, and the Rookie loses`, async () => {
      const n = night(p.id);
      const win = await simulateNight(n, p.gear);
      expect(rank(computeMedal(n, win.summary)), `${n.title} with ${p.gear.join('+')}: ${JSON.stringify(win.summary)}`).toBeGreaterThanOrEqual(rank(p.medal));
      const lose = await simulateNight(n, []);
      expect(computeMedal(n, lose.summary), `${n.title} with no gear: ${JSON.stringify(lose.summary)}`).toBe('none');
      expect(lose.summary.score).toBeLessThan(win.summary.score);
    });
  }

  it('CP-E2E: a fresh save can buy the Seal and the Seal alone wins at least bronze on night 1', async () => {
    const seal = gear.find((g) => g.id === 'seal')!;
    expect(seal.cost).toBeLessThanOrEqual(start.credits);
    const run = await simulateNight(night(1), [seal.part as Part]);
    expect(rank(computeMedal(night(1), run.summary)), JSON.stringify(run.summary)).toBeGreaterThanOrEqual(1);
  });

  it('the Rookie with no purchase cannot win night 1, and the retry-only purchase does not either', async () => {
    for (const parts of [[], ['retry']] as Part[][]) {
      const run = await simulateNight(night(1), parts);
      expect(computeMedal(night(1), run.summary), parts.join('+')).toBe('none');
    }
  });

  it('the campaign pays out: first gold of night 1 buys the next gear', async () => {
    const win = await simulateNight(night(1), ['journal', 'idempotency']);
    const result = scoreNight(night(1), win.summary, []);
    expect(result.medal).toBe('gold');
    expect(result.credits).toBe(Math.max(0, Math.floor(win.summary.score)));
    expect(result.credits).toBeGreaterThanOrEqual(partOf('lantern') ? gear.find((g) => g.id === 'lantern')!.cost : 0);
  });

  it('is deterministic by seed: two playthroughs of every night give the same events and summary', async () => {
    for (const p of PLAY) {
      const a = await simulateNight(night(p.id), p.gear);
      const b = await simulateNight(night(p.id), p.gear);
      expect(b.summary).toEqual(a.summary);
      expect(b.events.map((e) => `${e.type}:${e.order ?? ''}`)).toEqual(a.events.map((e) => `${e.type}:${e.order ?? ''}`));
    }
  });
});
