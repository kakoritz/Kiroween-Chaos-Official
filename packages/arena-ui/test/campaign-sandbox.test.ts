import { describe, expect, it } from 'vitest';
import { SANDBOX_KEY, compareRuns, describeCompare, formatTime, loadLastRun, saveLastRun, summarizeRun, type SandboxRun } from '../src/campaign/sandbox-model';
import { renderSandbox } from '../src/campaign/sandbox';
import { STORAGE_KEY } from '../src/campaign/hub-model';
import { EARNED_KEY, type ResultNight } from '../src/campaign/results-model';
import data from '../../core/campaign/nights.json';

const nights = data as unknown as ResultNight[];
const n1 = nights[0];
const memory = (init: Record<string, string> = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m } as unknown as Storage & { m: Map<string, string> }; };
const run = (o: Partial<SandboxRun> = {}): SandboxRun => ({ night: 1, parts: [], score: 100, timeMs: 60000, medal: 'none', ...o });

describe('summarizeRun', () => {
  it('sorts parts, floors the score and grades with the night thresholds', () => {
    const r = summarizeRun(n1, { score: n1.medals.bronze.credits + 0.9, repeats: 0 }, ['retry', 'journal'], 61234.4);
    expect(r).toMatchObject({ night: 1, parts: ['journal', 'retry'], timeMs: 61234, medal: 'bronze', repeats: 0 });
    expect(r.score).toBe(Math.floor(n1.medals.bronze.credits + 0.9));
  });
  it('gives no medal and zero score for an empty summary', () => {
    expect(summarizeRun(n1, {}, [], -5)).toMatchObject({ score: 0, timeMs: 0, medal: 'none' });
  });
});

describe('compareRuns', () => {
  it('marks higher score, shorter time and higher medal as better', () => {
    const c = compareRuns(run({ score: 100, timeMs: 90000, medal: 'bronze' }), run({ score: 160, timeMs: 80000, medal: 'silver' }));
    expect(c.score).toMatchObject({ delta: 60, trend: 'better' });
    expect(c.time).toMatchObject({ delta: -10000, trend: 'better' });
    expect(c.medal.trend).toBe('better');
  });
  it('marks lower score, longer time and lower medal as worse, equal as same', () => {
    const c = compareRuns(run({ score: 200, timeMs: 50000, medal: 'gold' }), run({ score: 150, timeMs: 70000, medal: 'bronze' }));
    expect([c.score.trend, c.time.trend, c.medal.trend]).toEqual(['worse', 'worse', 'worse']);
    const s = compareRuns(run(), run());
    expect([s.score.trend, s.time.trend, s.medal.trend]).toEqual(['same', 'same', 'same']);
  });
  it('lists gear added and removed and flags a different night', () => {
    const c = compareRuns(run({ parts: ['retry', 'journal'] }), run({ night: 2, parts: ['journal', 'breaker'] }));
    expect(c.gearAdded).toEqual(['breaker']);
    expect(c.gearRemoved).toEqual(['retry']);
    expect(c.sameNight).toBe(false);
    expect(describeCompare(c).join(' ')).toContain('different night');
  });
  it('describes the numbers in plain words', () => {
    const lines = describeCompare(compareRuns(run({ score: 100, timeMs: 90000 }), run({ score: 150, timeMs: 75000, medal: 'bronze' })));
    expect(lines).toContain('Score 150 (last 100, +50).');
    expect(lines).toContain('Time 1:15 (last 1:30, 15 s faster).');
    expect(lines).toContain('Medal bronze (last none).');
    expect(formatTime(5000)).toBe('0:05');
  });
});

describe('storage', () => {
  it('round-trips the last run under its own key', () => {
    const m = memory();
    expect(loadLastRun(m)).toBeUndefined();
    saveLastRun(m, run({ score: 42, parts: ['retry'], medal: 'silver' }));
    expect(loadLastRun(m)).toEqual(run({ score: 42, parts: ['retry'], medal: 'silver' }));
    expect([...m.m.keys()]).toEqual([SANDBOX_KEY]);
  });
  it('never writes credits, medals, best scores or unlocks', () => {
    const progress = JSON.stringify({ credits: 300, owned: [], medals: {}, best: {} });
    const m = memory({ [STORAGE_KEY]: progress });
    saveLastRun(m, summarizeRun(n1, { score: 99999, repeats: 0, stars: { avg: 5 } }, ['retry'], 1000));
    expect(m.m.get(STORAGE_KEY)).toBe(progress);
    expect(m.m.has(EARNED_KEY)).toBe(false);
  });
  it('ignores corrupt or foreign data', () => {
    expect(loadLastRun(memory({ [SANDBOX_KEY]: 'not json' }))).toBeUndefined();
    expect(loadLastRun(memory({ [SANDBOX_KEY]: '{"night":1}' }))).toBeUndefined();
    expect(loadLastRun(memory({ [SANDBOX_KEY]: JSON.stringify({ night: 1, score: 1, timeMs: 1, medal: 'platinum' }) }))).toBeUndefined();
    expect(loadLastRun(undefined)).toBeUndefined();
  });
});

describe('renderSandbox', () => {
  const gear = [{ id: 'g1', label: 'Retry Ring', part: 'retry' }, { id: 'g2', label: 'Journal', part: 'journal' }];
  it('shows any night and any gear with no credit cost', () => {
    const html = renderSandbox(nights, gear, 1, ['retry'], undefined, undefined, '');
    expect(html).toContain('No credits are earned');
    expect(html).toContain('data-part="retry" checked');
    expect(html).not.toContain('data-part="journal" checked');
    expect(html).toContain('No sandbox run yet');
    expect((html.match(/<option/g) ?? []).length).toBe(nights.length);
  });
  it('shows the comparison against the last run', () => {
    const html = renderSandbox(nights, gear, 1, [], run({ score: 100 }), run({ score: 150, medal: 'bronze' }), 'done');
    expect(html).toContain('Compared to your last run');
    expect(html).toContain('Score 150 (last 100, +50).');
    expect(html).toContain('Score \u25B2 better');
  });
  it('says so when there is nothing to compare yet', () => {
    expect(renderSandbox(nights, gear, 1, [], undefined, run(), '')).toContain('first sandbox run');
  });
});
