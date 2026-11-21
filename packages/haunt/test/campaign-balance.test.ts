// CP-C4: each night is deterministic, medal thresholds hold against the rival tiers, and medals depend only on the events.
// Runs on the scripted mock waves (packages/core/mock). Partial until S1 lands the scoring engine in the live runner:
// the live and browser engines are not replayed here, see the todo below.
import { describe, expect, it } from 'vitest';
import type { HauntEvent, PartId } from '@haunt/shared';
import { campaignFixture } from '../../core/mock/campaign-fixtures';
import { parseJsonl } from '../src/contract/validate';
import { checkNightBalance, computeMedal, laneSummary, loadCampaign, medalFromEvents, scoreCeiling, ROOKIE_BLOCKED_NIGHTS } from '../src/campaign';

const { nights } = loadCampaign();
const ALL: PartId[] = ['retry', 'journal', 'idempotency', 'breaker', 'offline_queue'];
const night = (id: number) => nights.find((n) => n.id === id)!;
const run = (id: number, parts: PartId[] = []): HauntEvent[] => campaignFixture(id, parts);
const score = (ev: HauntEvent[], lane = 1): number => laneSummary(ev, lane)!.score;
const jsonl = (ev: HauntEvent[]): string => ev.map((e) => JSON.stringify(e)).join('\n');

describe('determinism (acceptance 4)', () => {
  for (const n of nights) {
    it(`night ${n.id}: two runs with the same gear give the same lane 1 score`, () => {
      for (const parts of [[], n.gearHint, ALL] as PartId[][]) {
        const a = run(n.id, parts);
        run(((n.id % 7) + 1), ['retry']); // another night in between must not leak state
        const b = run(n.id, parts);
        expect(score(b), `${parts}`).toBe(score(a));
        expect(jsonl(b)).toBe(jsonl(a));
      }
    });
  }

  it('the gear order the player picks does not change the result', () => {
    expect(jsonl(run(1, ['idempotency', 'journal']))).toBe(jsonl(run(1, ['journal', 'idempotency'])));
  });
});

describe('thresholds against the rival tiers', () => {
  it('Phoenix reaches gold on every night', () => {
    for (const n of nights) {
      const ev = run(n.id);
      const ready = ev.find((e) => e.type === 'lane_ready' && e.lane === 5)!.detail as { tier: string };
      expect(ready.tier, `night ${n.id}`).toBe('phoenix');
      expect(medalFromEvents(n, ev, 5), `night ${n.id}`).toBe('gold');
    }
  });

  it('Rookie with no gear does not reach bronze on nights 1 to 3', () => {
    expect(ROOKIE_BLOCKED_NIGHTS).toEqual([1, 2, 3]);
    for (const id of ROOKIE_BLOCKED_NIGHTS) {
      const ev = run(id);
      expect(medalFromEvents(night(id), ev), `night ${id}`).toBe('none');
      expect(score(ev), `night ${id}`).toBeLessThan(night(id).medals.bronze.credits);
    }
  });

  it('no gear never beats the Phoenix and the hint gear beats no gear', () => {
    for (const n of nights) {
      const bare = run(n.id);
      const geared = run(n.id, n.gearHint);
      expect(score(bare), `night ${n.id} bare vs phoenix`).toBeLessThan(score(bare, 5));
      expect(score(geared), `night ${n.id} hint vs bare`).toBeGreaterThanOrEqual(score(bare)); // night 3 hint gear still fails in the mock (Partial)
      if (n.id !== 3) expect(score(geared), `night ${n.id} hint beats bare`).toBeGreaterThan(score(bare));
    }
  });

  it('the intended gear reaches silver or better on nights 1 and 5, gold with all parts on nights 1, 2, 5 and 6', () => {
    expect(['silver', 'gold']).toContain(medalFromEvents(night(1), run(1, night(1).gearHint)));
    expect(['silver', 'gold']).toContain(medalFromEvents(night(5), run(5, night(5).gearHint)));
    for (const id of [1, 2, 5, 6]) expect(medalFromEvents(night(id), run(id, ALL)), `night ${id}`).toBe('gold');
  });

  it('every night passes the balance check', () => {
    for (const n of nights) {
      const ev = run(n.id);
      expect(checkNightBalance(n, { rookie: laneSummary(ev, 1)!, phoenix: laneSummary(ev, 5)! }), `night ${n.id}`).toEqual([]);
    }
  });

  it('gold stays below what the point table allows', () => {
    for (const n of nights) expect(n.medals.gold.credits, `night ${n.id}`).toBeLessThanOrEqual(scoreCeiling(n));
    expect(scoreCeiling(night(1))).toBe(4 * 200 + 25);
  });

  it('the balance check names a night that breaks the rules', () => {
    const n = structuredClone(night(1));
    const good = { score: 800, repeats: 0, stars: { avg: 5 }, orders: { done: 4 }, downtimeMs: 0 };
    const rookieBronze = { score: 150, repeats: 3, stars: { avg: 2 }, orders: { done: 4 }, downtimeMs: 0 };
    const rookieNone = { ...rookieBronze, score: 50 };
    expect(checkNightBalance(n, { rookie: rookieNone, phoenix: good })).toEqual([]);
    expect(checkNightBalance(n, { rookie: rookieBronze, phoenix: good }).join(';')).toMatch(/Rookie with no gear reaches bronze/);
    n.medals.gold.credits = 5000;
    expect(checkNightBalance(n, { rookie: rookieNone, phoenix: good }).join(';')).toMatch(/ceiling/);
    const easy = structuredClone(night(1));
    expect(checkNightBalance(easy, { rookie: rookieNone, phoenix: { ...good, score: 100 } }).join(';')).toMatch(/Phoenix reaches bronze/);
    const lax = structuredClone(night(1)); lax.medals.bronze.credits = 0;
    expect(checkNightBalance(lax, { rookie: rookieNone, phoenix: good }).join(';')).toMatch(/above 0/);
  });
});

describe('medals depend only on the events (acceptance 5)', () => {
  it('the same events give the same medal whether they stay objects, travel as JSON lines or come back out of order of keys', () => {
    for (const n of nights) {
      for (const parts of [[], n.gearHint, ALL] as PartId[][]) {
        const ev = run(n.id, parts);
        const wire = parseJsonl(jsonl(ev)) as HauntEvent[];
        const bare = ev.map(({ type, lane, detail }) => ({ type, lane, detail })); // no seq, ts or wave
        for (let lane = 1; lane <= 5; lane++) {
          const expected = medalFromEvents(n, ev, lane);
          expect(medalFromEvents(n, wire, lane), `night ${n.id} lane ${lane} wire`).toBe(expected);
          expect(medalFromEvents(n, bare, lane), `night ${n.id} lane ${lane} bare`).toBe(expected);
          expect(computeMedal(n, laneSummary(ev, lane)!), `night ${n.id} lane ${lane}`).toBe(expected);
        }
      }
    }
  });

  it('the summary agrees with the last score event of each lane', () => {
    for (const n of nights) {
      const ev = run(n.id, n.gearHint);
      const last = new Map<string, number>();
      for (const e of ev) if (e.type === 'score') last.set(String(e.lane), (e.detail as { total: number }).total);
      for (let lane = 1; lane <= 5; lane++) if (last.has(String(lane))) expect(score(ev, lane), `night ${n.id} lane ${lane}`).toBe(last.get(String(lane)));
    }
  });

  it('a stream with no summary earns no medal and a later wave_end wins', () => {
    const ev = run(1, ALL);
    expect(medalFromEvents(night(1), ev.filter((e) => e.type !== 'wave_end'))).toBe('none');
    expect(laneSummary([])).toBeUndefined();
    const lost = [...ev.filter((e) => e.type !== 'wave_end'), { type: 'wave_end', detail: { summary: { 1: { score: 0 } } } }];
    expect(medalFromEvents(night(1), [...ev, ...lost])).toBe('none');
  });

  it.todo('live and browser engines produce the same medals from the same seed (needs the S1 scoring engine in the live runner)');
});
