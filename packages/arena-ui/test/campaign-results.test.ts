import { describe, expect, it } from 'vitest';
import { applyResult, creditsFor, exportProgress, explain, loadEarned, medalFor, nextGoal, parseImport, saveImport, saveOutcome, EARNED_KEY, type ResultGear, type ResultNight } from '../src/campaign/results-model';
import { STORAGE_KEY, emptyProgress, isUnlocked, loadProgress } from '../src/campaign/hub-model';
import { renderResults } from '../src/campaign/results';
import data from '../../core/campaign/nights.json';
import gearData from '../../core/campaign/gear.json';

const nights = data as unknown as ResultNight[];
const gear = gearData.items as ResultGear[];
const n1 = nights[0];
const memory = (init: Record<string, string> = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m } as unknown as Storage & { m: Map<string, string> }; };

describe('medals', () => {
  it('picks the highest tier whose thresholds are all met', () => {
    const b = n1.medals.bronze.credits, s = n1.medals.silver.credits, g = n1.medals.gold.credits;
    expect(medalFor(n1, { score: b - 1, repeats: 0 })).toBe('none');
    expect(medalFor(n1, { score: b, repeats: 0 })).toBe('bronze');
    expect(medalFor(n1, { score: s, repeats: 0 })).toBe('silver');
    expect(medalFor(n1, { score: s, repeats: 99 })).toBe('bronze');
    expect(medalFor(n1, { score: g, repeats: 0, stars: { avg: 5 } })).toBe('gold');
    expect(medalFor(n1, { score: g, repeats: 0, stars: { avg: 1 } })).toBe('silver');
    expect(medalFor(n1, {})).toBe('none');
  });
  it('awards the score once per tier and 25 percent on replays', () => {
    expect(creditsFor(400, 'silver', [])).toBe(400);
    expect(creditsFor(401, 'silver', ['silver'])).toBe(100);
    expect(creditsFor(-50, 'none', [])).toBe(0);
    expect(creditsFor(Number.NaN, 'bronze', [])).toBe(0);
  });
});

describe('applyResult', () => {
  it('adds credits, keeps the best medal and score, and unlocks the next night once', () => {
    const p = { ...emptyProgress(), credits: 10 };
    const hi = { score: n1.medals.silver.credits + 5, repeats: 0 };
    const a = applyResult(n1, hi, p, {});
    expect(a.medal).toBe('silver');
    expect(a.progress.credits).toBe(10 + hi.score);
    expect(a.unlockedNext).toBe(true);
    expect(isUnlocked(2, a.progress.medals)).toBe(true);
    const lo = { score: n1.medals.bronze.credits, repeats: 9 };
    const b = applyResult(n1, lo, a.progress, a.earned);
    expect(b.progress.medals['1']).toBe('silver');
    expect(b.progress.best['1']).toBe(hi.score);
    expect(b.unlockedNext).toBe(false);
    const c = applyResult(n1, hi, b.progress, b.earned);
    expect(c.credits).toBe(Math.floor(hi.score * 0.25));
  });
  it('a failed night changes nothing but the best score', () => {
    const a = applyResult(n1, { score: -40 }, emptyProgress(), {});
    expect(a.medal).toBe('none');
    expect(a.credits).toBe(0);
    expect(a.progress.medals).toEqual({});
    expect(isUnlocked(2, a.progress.medals)).toBe(false);
  });
});

describe('what happened', () => {
  it('names the top three causes and suggests gear', () => {
    const c = explain({ score: 0 }, [{ delta: -30, reason: 'repeated charge' }, { delta: -10, reason: 'downtime' }, { delta: -5, reason: 'review' }, { delta: -1, reason: 'mystery' }, { delta: 20, reason: 'done' }], gear);
    expect(c).toHaveLength(3);
    expect(c[0].gear).toBe('Seal');
    expect(c[1].gear).toBe('Shield');
  });
  it('falls back to the summary when no loss events were seen', () => {
    const c = explain({ score: 0, repeats: 2, orders: { cancelled: 1 } }, [], gear);
    expect(c.map((x) => x.gear)).toEqual(['Seal', 'Lantern']);
    expect(explain({ score: 500, repeats: 0 }, [], gear)).toEqual([]);
  });
  it('states the next goal in words', () => {
    expect(nextGoal(n1, 'bronze')).toMatch(/^For silver: \d+ credits/);
    expect(nextGoal(n1, 'gold')).toBe('');
  });
});

describe('persistence', () => {
  it('round trips through the storage key and exports valid JSON', () => {
    const s = memory();
    const a = applyResult(n1, { score: n1.medals.bronze.credits }, emptyProgress(), {});
    saveOutcome(s, a);
    expect(s.m.has(STORAGE_KEY)).toBe(true);
    expect(loadProgress(s).medals['1']).toBe('bronze');
    expect(loadEarned(s)['1']).toEqual(['bronze']);
    const out = JSON.parse(exportProgress(s));
    expect(out.credits).toBe(a.progress.credits);
    const r = parseImport(JSON.stringify(out));
    expect(r.ok).toBe(true);
    const t = memory();
    if (r.ok) saveImport(t, r);
    expect(loadProgress(t)).toEqual(loadProgress(s));
    expect(t.m.has(EARNED_KEY)).toBe(true);
  });
  it('rejects bad imports and writes nothing', () => {
    expect(parseImport('nope').ok).toBe(false);
    expect(parseImport('[1]').ok).toBe(false);
    expect(parseImport('{"x":1}').ok).toBe(false);
  });
  it('survives broken storage', () => {
    const bad = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } } as unknown as Storage;
    expect(() => saveOutcome(bad, applyResult(n1, { score: 1 }, emptyProgress(), {}))).not.toThrow();
    expect(loadEarned(bad)).toEqual({});
  });
});

describe('results screen', () => {
  it('renders medal, credits, causes and buttons', () => {
    const o = applyResult(n1, { score: n1.medals.bronze.credits, repeats: 3 }, emptyProgress(), {});
    const html = renderResults(n1, o, { score: n1.medals.bronze.credits, repeats: 3 }, [], gear, nights);
    expect(html).toContain('Bronze medal');
    expect(html).toContain('data-act="retry"');
    expect(html).toContain('Try the <b>Seal</b>');
    expect(html).toContain('A new door opens');
  });
});
