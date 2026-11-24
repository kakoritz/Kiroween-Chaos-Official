import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PARTS } from '@haunt/shared';
import { findRepoRoot } from '../src/contract/validate';
import { awardCredits, computeMedal, loadCampaign, scoreNight, validateGear, validateNights, type CampaignNight, type LaneSummary } from '../src/campaign';

const root = findRepoRoot();
const dir = resolve(root, 'packages', 'core', 'campaign');
const read = (f: string): any => JSON.parse(readFileSync(resolve(dir, f), 'utf8'));
const schema = read('nights.schema.json');
const nights = (): CampaignNight[] => structuredClone(read('nights.json'));

describe('campaign data (CP-C1)', () => {
  it('loads seven nights and five gear items', () => {
    const c = loadCampaign(root);
    expect(c.nights.map((n) => n.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(c.nights[6]!.finale).toBe(true);
    expect(c.gear.map((g) => g.badge)).toEqual(['R', 'J', 'I', 'B', 'Q']);
    expect(c.gear.map((g) => g.cost)).toEqual([200, 300, 300, 500, 500]);
    expect(c.start).toEqual({ gear: [], credits: 300 });
    for (const g of c.gear) expect(g.part in PARTS).toBe(true);
  });

  it('matches the night shape of the spec', () => {
    for (const n of nights()) {
      expect(n.lesson).toHaveLength(3);
      expect(n.orders).toBe(4);
      expect(n.pace).toBe('slow');
      expect(n.rivals).toEqual(['retrier', 'journaler', 'reconciler', 'phoenix']);
      expect(n.plan.length).toBeGreaterThan(0);
    }
    const [n1, n2, n3, n4, n5, , n7] = nights();
    expect(n1!.medals.gold).toMatchObject({ repeats: 0, avgStars: 3.5 });
    expect(n2!.medals.gold).toMatchObject({ cancelled: 0 });
    expect(n3!.medals.gold).toMatchObject({ abandoned: 0, repeats: 0 });
    expect(n4!.medals.gold).toMatchObject({ maxDowntimeMsPerOrder: 20000 });
    expect(n5!.plan.filter((p) => 'boss' in p)).toHaveLength(3);
    expect(n7!.medals.gold.avgStars).toBe(4.5);
  });

  it('has a fixed seed per night, all different', () => {
    const seeds = nights().map((n) => n.seed);
    expect(new Set(seeds).size).toBe(7);
    expect(JSON.stringify(nights())).toBe(JSON.stringify(nights()));
  });

  it('rejects data that breaks the schema', () => {
    const missing = nights().slice(0, 6);
    expect(() => validateNights(missing, schema)).toThrow(/nights.json/);
    const bad = nights(); (bad[0] as any).lesson = ['one'];
    expect(() => validateNights(bad, schema)).toThrow();
    const extra = nights(); (extra[0] as any).surprise = true;
    expect(() => validateNights(extra, schema)).toThrow();
    const pace = nights(); (pace[2] as any).pace = 'fast';
    expect(() => validateNights(pace, schema)).toThrow();
  });

  it('rejects data that breaks the rules the schema cannot express', () => {
    const wrongId = nights(); wrongId[1]!.id = 5;
    expect(() => validateNights(wrongId, schema)).toThrow(/id must be 2/);
    const unknown = nights(); (unknown[0]!.plan[0] as any).fault = 'nope';
    expect(() => validateNights(unknown, schema)).toThrow(/unknown fault nope/);
    const mismatch = nights(); (mismatch[0]!.plan[0] as any).creature = 'zombie';
    expect(() => validateNights(mismatch, schema)).toThrow(/belongs to reaper/);
    const order = nights(); order[0]!.medals.silver.credits = 50;
    expect(() => validateNights(order, schema)).toThrow(/must not decrease/);
    const boss = nights(); (boss[4]!.plan[0] as any).startAtMs = 1;
    expect(() => validateNights(boss, schema)).toThrow(/after its warning/);
  });

  it('validates gear', () => {
    const g = read('gear.json');
    expect(validateGear(g).items).toHaveLength(5);
    const cheap = structuredClone(g); cheap.start.credits = 999;
    expect(() => validateGear(cheap)).toThrow(/300 credits/);
    const dup = structuredClone(g); dup.items[1].part = 'retry';
    expect(() => validateGear(dup)).toThrow();
  });
});

const sum = (over: Partial<LaneSummary> & { score: number }): LaneSummary => ({ repeats: 0, downtimeMs: 0, orders: { done: 4, cancelled: 0, abandoned: 0 }, stars: { avg: 5 }, ...over });

describe('medal rule (CP-C1)', () => {
  const n = nights();
  const night = (i: number): CampaignNight => n[i - 1]!;

  it('gives the highest tier whose thresholds are all met', () => {
    expect(computeMedal(night(1), sum({ score: 50 }))).toBe('none');
    expect(computeMedal(night(1), sum({ score: 100 }))).toBe('bronze');
    expect(computeMedal(night(1), sum({ score: 400 }))).toBe('silver');
    expect(computeMedal(night(1), sum({ score: 700 }))).toBe('gold');
  });

  it('holds a tier back when any of its thresholds fails', () => {
    expect(computeMedal(night(1), sum({ score: 900, repeats: 1 }))).toBe('bronze');
    expect(computeMedal(night(1), sum({ score: 900, stars: { avg: 3.4 } }))).toBe('silver');
    expect(computeMedal(night(2), sum({ score: 900, orders: { done: 3, cancelled: 1 } }))).toBe('silver');
    expect(computeMedal(night(3), sum({ score: 900, orders: { done: 3, abandoned: 1 } }))).toBe('silver');
    expect(computeMedal(night(5), sum({ score: 900, orders: { done: 3, cancelled: 1 } }))).toBe('silver');
    expect(computeMedal(night(7), sum({ score: 950, stars: { avg: 4.4 } }))).toBe('silver');
    expect(computeMedal(night(7), sum({ score: 950, stars: { avg: 4.5 } }))).toBe('gold');
  });

  it('measures downtime per order on night 4', () => {
    expect(computeMedal(night(4), sum({ score: 800, downtimeMs: 79_999 }))).toBe('gold');
    expect(computeMedal(night(4), sum({ score: 800, downtimeMs: 80_001 }))).toBe('silver');
    expect(computeMedal(night(4), sum({ score: 800, downtimeMs: 40_000, orders: { done: 2, cancelled: 0 } }))).toBe('gold');
  });

  it('never passes a limit when the summary lacks the field', () => {
    expect(computeMedal(night(1), { score: 900 })).toBe('bronze');
    expect(computeMedal(night(2), { score: 900, repeats: 0 })).toBe('silver');
  });

  it('never skips an unmet lower tier', () => {
    const odd = structuredClone(night(1)); odd.medals.silver.repeats = -1;
    expect(computeMedal(odd, sum({ score: 900 }))).toBe('bronze');
  });

  it('pays the score the first time and 25 percent on replays', () => {
    expect(awardCredits(700, 'gold', [])).toBe(700);
    expect(awardCredits(700, 'gold', ['bronze'])).toBe(700);
    expect(awardCredits(700, 'gold', ['gold'])).toBe(175);
    expect(awardCredits(701, 'gold', new Set(['gold']))).toBe(175);
    expect(awardCredits(-250, 'none', [])).toBe(0);
    expect(awardCredits(-250, 'none', ['none'])).toBe(0);
    expect(awardCredits(Number.NaN, 'bronze', [])).toBe(0);
  });

  it('scoreNight returns medal, credits and the updated earned tiers', () => {
    const first = scoreNight(night(1), sum({ score: 700 }), []);
    expect(first).toEqual({ medal: 'gold', credits: 700, earned: ['gold'] });
    const again = scoreNight(night(1), sum({ score: 700 }), first.earned);
    expect(again).toEqual({ medal: 'gold', credits: 175, earned: ['gold'] });
  });
});