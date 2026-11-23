import { describe, expect, it, vi } from 'vitest';
import { MAX_VOICES, MIN_GAP_MS, canPlay, cuesFor, soundFor, starPitch } from '../src/sound';
import { Announcer, POLITE_GAP_MS, announcementFor } from '../src/arena/announce';

const names = (ev: Parameters<typeof cuesFor>[0]) => cuesFor(ev).map((c) => c.name);

describe('PT-U12 sound cues', () => {
  it('door opens then closes at the ceremony', () => {
    const c = cuesFor({ type: 'order_done', detail: { ceremonyMs: 2000 } });
    expect(c.map((x) => x.name)).toEqual(['doorOpen', 'doorClose']);
    expect(c[1]!.after).toBeGreaterThan(c[0]!.after);
    expect(c[1]!.after).toBeLessThanOrEqual(2000);
    expect(names({ type: 'order_done' })).toEqual(['doorOpen', 'doorClose']);
  });
  it('star chime pitch rises with stars; ding at 4.5+, trombone at 2 or less', () => {
    expect(starPitch(1)).toBeLessThan(starPitch(3));
    expect(starPitch(3)).toBeLessThan(starPitch(5));
    expect(starPitch(99)).toBe(starPitch(5));
    expect(names({ type: 'review', detail: { stars: 5 } })).toEqual(['star', 'ding']);
    expect(names({ type: 'review', detail: { stars: 4.5 } })).toEqual(['star', 'ding']);
    expect(names({ type: 'review', detail: { stars: 4 } })).toEqual(['star']);
    expect(names({ type: 'review', detail: { stars: 2 } })).toEqual(['star', 'trombone']);
    expect(names({ type: 'review', detail: { stars: 1 } })).toEqual(['star', 'trombone']);
    expect(names({ type: 'review', detail: {} })).toEqual([]);
  });
  it('maps the rest of section 13', () => {
    expect(names({ type: 'order_failed' })).toEqual(['slam']);
    expect(names({ type: 'score', detail: { reason: 'downtime' } })).toEqual(['tick']);
    expect(names({ type: 'score', detail: { reason: 'boss recovered' } })).toEqual(['fanfare']);
    expect(names({ type: 'score', detail: { reason: 'clean' } })).toEqual([]);
    expect(names({ type: 'decision_needed' })).toEqual(['jingle']);
    expect(names({ type: 'chaos', detail: { creature: 'scarecrow' } })).toEqual(['rustle']);
    expect(names({ type: 'chaos', detail: { creature: 'black_cat' } })).toEqual(['meow']);
    expect(names({ type: 'chaos', detail: { creature: 'phantom_car' } })).toEqual(['crash']);
    expect(names({ type: 'chaos', detail: { creature: 'wraith' } })).toEqual([]);
  });
  it('keeps the old mapping', () => {
    expect(soundFor({ type: 'stage_fail' })).toBe('thud');
    expect(names({ type: 'process_dead' })).toEqual(['wail']);
  });
  it('downtime tick is rate limited and the voice cap is 8', () => {
    expect(MIN_GAP_MS.tick).toBeGreaterThanOrEqual(1000);
    expect(canPlay('tick', 500, { tick: 0 })).toBe(false);
    expect(MAX_VOICES).toBe(8);
  });
});

const ctx = { tier: (n: number) => (n === 3 ? 'Veteran' : ''), stageLabel: (id: string) => id.toUpperCase() };

describe('PT-U12 announcements', () => {
  it('review stars, with the lane and the text', () => {
    expect(announcementFor({ type: 'review', lane: 3, detail: { stars: 4, text: 'Lightning fast' } } as never, ctx)).toEqual({ text: 'Lane 3 got 4 stars: Lightning fast', assertive: false });
    expect(announcementFor({ type: 'review', lane: 1, detail: { stars: 1 } } as never, ctx)?.text).toBe('Lane 1 got 1 star');
    expect(announcementFor({ type: 'review', lane: 1, detail: { stars: 4.5 } } as never, ctx)?.text).toBe('Lane 1 got 4.5 stars');
  });
  it('decision needed and boss warning are assertive', () => {
    expect(announcementFor({ type: 'decision_needed', lane: 2, detail: { detectedAt: 'confirmation' } } as never, ctx)).toMatchObject({ assertive: true });
    expect(announcementFor({ type: 'decision_needed', lane: 2 } as never, ctx)?.text).toContain('lane 2');
    expect(announcementFor({ type: 'boss_warning' } as never, ctx)?.assertive).toBe(true);
  });
  it('crash names lane tier and stage; cancel and boss recovered are left to ScoreVisuals', () => {
    expect(announcementFor({ type: 'process_dead', lane: 3, stage: 'payment' } as never, ctx)?.text).toBe('Lane 3, Veteran, crashed at PAYMENT. Recovering.');
    expect(announcementFor({ type: 'order_failed', lane: 3 } as never, ctx)).toBeNull();
    expect(announcementFor({ type: 'score', lane: 3, detail: { reason: 'boss recovered' } } as never, ctx)).toBeNull();
    expect(announcementFor({ type: 'stage_progress', lane: 3 } as never, ctx)).toBeNull();
  });
});

describe('Announcer', () => {
  it('assertive goes out at once; polite is limited to one per second and keeps order', () => {
    vi.useFakeTimers();
    let now = 0;
    const pol = { textContent: '' as string | null }, ass = { textContent: '' as string | null };
    const a = new Announcer(pol, ass, () => now);
    a.say({ text: 'now', assertive: true });
    expect(ass.textContent).toBe('now');
    a.say({ text: 'one', assertive: false });
    expect(pol.textContent).toBe('one');
    now = 100; a.say({ text: 'two', assertive: false });
    expect(pol.textContent).toBe('one');
    now = POLITE_GAP_MS; vi.advanceTimersByTime(POLITE_GAP_MS);
    expect(pol.textContent).toBe('two');
    vi.useRealTimers();
  });
  it('drops the oldest polite messages when flooded', () => {
    vi.useFakeTimers();
    let now = 0;
    const pol = { textContent: '' as string | null };
    const a = new Announcer(pol, { textContent: '' }, () => now);
    for (let i = 0; i < 20; i++) a.sayPolite(`m${i}`);
    const seen: string[] = [pol.textContent!];
    for (let i = 0; i < 6; i++) { now += POLITE_GAP_MS; vi.advanceTimersByTime(POLITE_GAP_MS); seen.push(pol.textContent!); }
    expect(seen[0]).toBe('m0');
    expect(seen).toContain('m19');
    expect(seen).not.toContain('m5');
    vi.useRealTimers();
  });
});

import { arenaSummary } from '../src/arena/announce';
describe('arenaSummary', () => {
  it('names the leader and active chaos', () => {
    expect(arenaSummary([])).toContain('no lanes');
    const t = arenaSummary([{ lane: 1, tier: 'Rookie', score: 10 }, { lane: 2, tier: 'Phoenix', score: 90, creatures: [{ id: 'black_cat' }, { id: 'black_cat' }] }]);
    expect(t).toContain('Lane 2, Phoenix, leads with 90');
    expect(t).toContain('active chaos: black cat');
    expect(arenaSummary([{ lane: 1, tier: 'Rookie', score: 0 }])).toContain('no active chaos');
  });
});
