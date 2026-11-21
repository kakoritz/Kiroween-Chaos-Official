// CP-C3: campaign fixtures night1..night6 and finale (scripted, demo style), the mock's POST /api/wave/start {campaign}
// and inpage getCampaign(). Contract: contract/V1_1.md sections 3, 4, 6, 7, 11 and 12.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { HauntEvent, PartId } from '@haunt/shared';
import { createMockServer } from '../src/mock/server';
import { FIXTURE_NAMES } from '../src/sim/fixtures';
import {
  CAMPAIGN_FIXTURES, campaignFixture, campaignFixtureSpecs, nightFixtureName, parseCampaignFixtureName,
} from '../mock/campaign-fixtures';
import { findRepoRoot, formatViolations, parseJsonl, validateEvents } from '../../haunt/src/contract/validate';
import { loadCampaign } from '../../haunt/src/campaign/nights';
// @ts-expect-error plain JS module without types
import { createHaunt } from '../inpage-stub.js';

const dir = resolve(findRepoRoot(), 'contract', 'fixtures');
const ALL: PartId[] = ['retry', 'journal', 'idempotency', 'breaker', 'offline_queue'];
const cache = new Map<string, HauntEvent[]>();
const fx = (night: number, parts: PartId[] = []): HauntEvent[] => {
  const k = nightFixtureName(night, parts);
  if (!cache.has(k)) cache.set(k, campaignFixture(night, parts));
  return cache.get(k)!;
};
const summary = (ev: HauntEvent[], lane = 1): any => (ev.find((e) => e.type === 'wave_end')!.detail as any).summary[String(lane)];
const lane1 = (ev: HauntEvent[], type: string): HauntEvent[] => ev.filter((e) => e.lane === 1 && e.type === type);

describe('campaign fixture names', () => {
  it('names the starting crew night1..night6 and finale, and the gear with letters', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => nightFixtureName(n))).toEqual(['night1', 'night2', 'night3', 'night4', 'night5', 'night6', 'finale']);
    expect(nightFixtureName(1, ['idempotency', 'journal'])).toBe('night1-j-i');
    expect(nightFixtureName(2, ['breaker', 'retry'])).toBe('night2-r-b');
    expect(nightFixtureName(7, ALL)).toBe('finale-r-j-i-b-q');
  });

  it('parses names back, including the none and nogear aliases', () => {
    expect(parseCampaignFixtureName('night1')).toEqual({ night: 1, parts: [] });
    expect(parseCampaignFixtureName('night1-nogear')).toEqual({ night: 1, parts: [] });
    expect(parseCampaignFixtureName('night2-none')).toEqual({ night: 2, parts: [] });
    expect(parseCampaignFixtureName('night2-r-b')).toEqual({ night: 2, parts: ['retry', 'breaker'] });
    expect(parseCampaignFixtureName('finale-r-j-i-b-q')).toEqual({ night: 7, parts: ALL });
    expect(parseCampaignFixtureName('night7')).toBeUndefined();
    expect(parseCampaignFixtureName('night2-b-r')).toBeUndefined();
    expect(parseCampaignFixtureName('night2-r-r')).toBeUndefined();
    expect(parseCampaignFixtureName('calm')).toBeUndefined();
  });

  it('commits no gear and the gear hint for every night, outside the main fixture registry', () => {
    expect(campaignFixtureSpecs().map((f) => f.name)).toEqual([
      'night1', 'night1-j-i', 'night2', 'night2-r-b', 'night3', 'night3-j-q', 'night4', 'night4-r-b-q',
      'night5', 'night5-r-j-i-b-q', 'night6', 'night6-r-j-i-b-q', 'finale', 'finale-r-j-i-b-q',
    ]);
    expect(Object.keys(CAMPAIGN_FIXTURES).filter((n) => FIXTURE_NAMES.includes(n))).toEqual([]);
  });

  it('the committed files are exactly what the generator produces', () => {
    const files = readdirSync(dir).filter((f) => /^(night|finale)/.test(f) && f.endsWith('.jsonl')).sort();
    expect(files).toEqual(Object.keys(CAMPAIGN_FIXTURES).map((n) => `${n}.jsonl`).sort());
    for (const name of Object.keys(CAMPAIGN_FIXTURES)) {
      const text = readFileSync(resolve(dir, `${name}.jsonl`), 'utf8').replace(/\r\n/g, '\n');
      expect(text, `${name}.jsonl is stale, run npm run make:fixtures`).toBe(CAMPAIGN_FIXTURES[name]().map((e) => JSON.stringify(e)).join('\n') + '\n');
    }
  });
});

describe('campaign fixtures are valid waves', () => {
  for (const name of Object.keys(CAMPAIGN_FIXTURES)) {
    it(`${name}: valid against the schema and the ordering rules`, () => {
      const events = parseJsonl(readFileSync(resolve(dir, `${name}.jsonl`), 'utf8'));
      expect(formatViolations(validateEvents(events))).toBe('');
      expect(events[0].type).toBe('hello');
      expect(events[events.length - 1].type).toBe('wave_end');
    });
  }

  it('any other gear combination builds a valid wave too', () => {
    for (const [n, parts] of [[1, ['retry']], [2, ['journal', 'idempotency']], [4, ['offline_queue']], [7, ['retry']], [6, ['retry', 'journal']]] as [number, PartId[]][]) {
      expect(formatViolations(validateEvents(fx(n, parts))), `night ${n} ${parts}`).toBe('');
    }
  });

  it('is deterministic', () => {
    expect(JSON.stringify(campaignFixture(3, ['journal']))).toBe(JSON.stringify(campaignFixture(3, ['journal'])));
  });
});

describe('campaign fixtures: lane 1 is the Crew', () => {
  it('lane_ready shows tier crew with the gear, the rivals follow, and wave_start carries the campaign', () => {
    const { nights } = loadCampaign();
    for (const n of nights) {
      const ev = fx(n.id, ['journal', 'retry']);
      const ready = ev.filter((e) => e.type === 'lane_ready').sort((a, b) => a.lane! - b.lane!).map((e) => (e.detail as any).tier);
      expect(ready).toEqual(['crew', ...n.rivals]);
      expect(ev.find((e) => e.type === 'lane_ready' && e.lane === 1)!.detail).toEqual({ tier: 'crew', label: 'Your Crew', parts: ['retry', 'journal'] });
      const ws = ev.find((e) => e.type === 'wave_start')!.detail as any;
      expect(ws).toMatchObject({ orders: n.orders, seed: n.seed, lanes: 5, pace: 'slow', app: n.app ?? 'orders', campaign: { night: n.id, parts: ['retry', 'journal'] } });
    }
  });

  it('night 6 is the inbox app', () => {
    const stages = new Set(fx(6).filter((e) => e.type === 'stage_start').map((e) => e.stage));
    expect(stages.has('ticket')).toBe(true);
    expect(stages.has('payment')).toBe(false);
  });
});

describe('campaign fixtures carry v1.1 data', () => {
  it('every night has laps, reviews and travel gaps on lane 1 (V1_1 sections 1, 3, 4)', () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      const ev = fx(n, ALL);
      const ends = ev.filter((e) => e.lane === 1 && (e.type === 'order_done' || e.type === 'order_failed'));
      expect(ends.length).toBeGreaterThan(0);
      for (const e of ends) expect((e.detail as any).lap, `night ${n}`).toMatchObject({ ms: expect.any(Number), workMs: expect.any(Number), attempts: expect.any(Number) });
      expect(lane1(ev, 'review').length).toBeGreaterThan(0);
      expect(lane1(ev, 'order_start').some((e) => (e.detail as any).grabMs > 0)).toBe(true);
      expect(lane1(ev, 'stage_done').some((e) => (e.detail as any).walkMs > 0)).toBe(true);
    }
  });

  it('the wave summary has orders, stars, rating and downtime (V1_1 section 6)', () => {
    const s = summary(fx(1, ['journal', 'idempotency']));
    expect(s.orders).toEqual({ done: 4, cancelled: 0, parked: 0, quarantined: 0, abandoned: 0 });
    expect(s.stars.count).toBe(4);
    expect(['Five-Star Crypt', 'Respectable', 'Spooky Service', 'Cursed']).toContain(s.rating);
    expect(typeof s.downtimeMs).toBe('number');
  });
});

describe('gear changes the result where it should', () => {
  it('night 1: Spellbook and Seal stop the double charge', () => {
    const none = summary(fx(1));
    const gear = summary(fx(1, ['journal', 'idempotency']));
    expect(none.repeats).toBeGreaterThan(0);
    expect(gear.repeats).toBe(0);
    expect(gear.score).toBeGreaterThan(none.score);
  });

  it('night 2: Lantern and Shield bring every order home', () => {
    expect(summary(fx(2)).orders.cancelled).toBe(4);
    const gear = summary(fx(2, ['retry', 'breaker']));
    expect(gear.orders.done).toBe(4);
    expect(gear.orders.cancelled).toBe(0);
  });

  it('night 3: the full set beats no gear on parked and broken orders', () => {
    expect(summary(fx(3)).orders.abandoned).toBe(3);
    const gear = summary(fx(3, ALL));
    expect(gear.orders.abandoned).toBe(0);
    expect(gear.orders.done).toBeGreaterThan(0);
  });

  it('night 4: the world faults appear, with downtime for the geared crew', () => {
    const faults = lane1(fx(4, ['retry', 'breaker', 'offline_queue']), 'chaos').map((e) => (e.detail as any).fault);
    expect(faults).toEqual(expect.arrayContaining(['sms_down', 'app_down', 'wrong_address', 'no_answer', 'car_accident']));
    const gear = summary(fx(4, ['retry', 'breaker', 'offline_queue']));
    expect(gear.downtimeMs).toBeGreaterThan(0);
    expect(gear.orders.done).toBeGreaterThan(summary(fx(4)).orders.done);
  });

  it('night 5: a geared crew recovers from the boss and is paid for it (V1_1 rule 46)', () => {
    const ev = fx(5, ALL);
    const bosses = ev.filter((e) => e.type === 'boss_start').length;
    expect(bosses).toBeGreaterThanOrEqual(1);
    expect(lane1(ev, 'chaos').some((e) => (e.detail as any).source === 'boss')).toBe(true);
    const reasons = lane1(ev, 'score').map((e) => (e.detail as any).reason);
    expect(reasons).toContain('boss recovered');
    expect(reasons).toContain('boss downtime refund');
    expect(summary(fx(5)).orders.cancelled).toBeGreaterThan(0);
    expect(summary(ev).orders.cancelled).toBe(0);
  });

  it('night 5: boss windows never overlap', () => {
    const marks = fx(5, ALL).filter((e) => e.type === 'boss_start' || e.type === 'boss_end').map((e) => e.type);
    expect(marks).toEqual(marks.map((_, i) => (i % 2 === 0 ? 'boss_start' : 'boss_end')));
  });

  it('finale: the wrong-order decision is offered and made, then the storm is ridden out with Lantern', () => {
    const ev = fx(7, ALL);
    const need = lane1(ev, 'decision_needed');
    const made = lane1(ev, 'decision_made');
    expect(need).toHaveLength(1);
    expect(made).toHaveLength(1);
    expect(need[0].detail).toMatchObject({ kind: 'wrong_order', detectedAt: 'confirmation', options: ['refund', 'discount', 'redo'] });
    expect(made[0].detail).toMatchObject({ order: (need[0].detail as any).order, choice: 'discount', source: 'user' });
    expect(lane1(ev, 'effect').some((e) => (e.detail as any).kind === 'discount')).toBe(true);
    expect(lane1(ev, 'score').map((e) => (e.detail as any).reason)).toContain('boss recovered');
    expect(summary(ev).orders).toMatchObject({ done: 4, cancelled: 0 });
    // Without Lantern the storm costs an order.
    expect(summary(fx(7)).orders.cancelled).toBe(1);
  });
});

describe('mock: POST /api/wave/start {campaign}', () => {
  async function withServer(fn: (base: string) => Promise<void>): Promise<void> {
    const m = createMockServer({ port: 0 });
    const port = await m.listen();
    try { await fn(`http://127.0.0.1:${port}`); } finally { await m.close(); }
  }
  const post = (base: string, path: string, body: unknown = {}) => fetch(`${base}${path}`, { method: 'POST', body: JSON.stringify(body) });

  async function waitState(base: string, ok: (s: any) => boolean): Promise<any> {
    for (let i = 0; i < 100; i++) {
      const s: any = await (await fetch(`${base}/api/state`)).json();
      if (ok(s)) return s;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('timed out');
  }

  it('starts the night with the crew lane and ignores the other wave settings', async () => {
    await withServer(async (base) => {
      const r = await post(base, '/api/wave/start', { campaign: { night: 2, parts: ['breaker', 'retry'] }, orders: 99, lanes: 1, speed: 4 });
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ wave: 1 });
      const state: any = await waitState(base, (s) => s.lanes.length === 5);
      expect(state.wave).toMatchObject({ running: true, orders: 4, speed: 4 });
      const ready = state.lanes.map((l: any) => l.tier);
      expect(ready).toEqual(['crew', 'retrier', 'journaler', 'reconciler', 'phoenix']);
      expect((await post(base, '/api/wave/start', { campaign: { night: 1 } })).status).toBe(409);
    });
  });

  it('plays night 6 on the inbox app', async () => {
    await withServer(async (base) => {
      expect((await post(base, '/api/wave/start', { campaign: { night: 6, parts: [] }, speed: 4 })).status).toBe(200);
      const state: any = await (await fetch(`${base}/api/state`)).json();
      expect(state.app).toBe('inbox');
    });
  });

  it('refuses a bad night, a bad part and a bad speed', async () => {
    await withServer(async (base) => {
      for (const campaign of [{ night: 9 }, { night: 0 }, { night: 1, parts: ['nope'] }, 'x', { night: 1, parts: 'retry' }]) {
        const r = await post(base, '/api/wave/start', { campaign });
        expect(r.status).toBe(400);
        expect(((await r.json()) as any).error.code).toBe('bad_request');
      }
      expect((await post(base, '/api/wave/start', { campaign: { night: 1 }, speed: 3 })).status).toBe(400);
    });
  });

  it('plays a campaign fixture as a demo script too', async () => {
    await withServer(async (base) => {
      expect((await post(base, '/api/demo/start', { script: 'night1-j-i', speed: 4 })).status).toBe(200);
      const state: any = await (await fetch(`${base}/api/state`)).json();
      expect(state.demo.running).toBe('night1-j-i');
      expect((await post(base, '/api/demo/stop')).status).toBe(200);
      expect((await post(base, '/api/demo/start', { script: 'night7' })).status).toBe(400);
    });
  });

  it('inpage getCampaign() returns the nights, the gear and the start', async () => {
    await withServer(async (base) => {
      const h = createHaunt({ base });
      const c = await h.getCampaign();
      expect(c.nights).toHaveLength(7);
      expect(c.gear).toHaveLength(5);
      expect(c.start).toEqual({ gear: [], credits: 300 });
      const w = await h.startWave({ campaign: { night: 1, parts: ['journal'] }, speed: 4 });
      expect(w.wave).toBe(1);
    });
  });
});
