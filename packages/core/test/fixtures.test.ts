import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { HauntEvent } from '@haunt/shared';
import { FIXTURES, FIXTURE_NAMES } from '../src/sim/fixtures';
import { findRepoRoot, parseJsonl, validateEvents, formatViolations } from '../../haunt/src/contract/validate';

const dir = resolve(findRepoRoot(), 'contract', 'fixtures');
const built = new Map<string, HauntEvent[]>();
const get = (name: string): HauntEvent[] => {
  let e = built.get(name);
  if (!e) { e = FIXTURES[name](); built.set(name, e); }
  return e;
};
const lane = (ev: HauntEvent[], n: number, skipProgress = true): HauntEvent[] =>
  ev.filter((e) => e.lane === n && (!skipProgress || e.type !== 'stage_progress'));
const types = (ev: HauntEvent[]): string[] => ev.map((e) => e.type);

describe('fixtures (C1, C2)', () => {
  it('has every fixture named in contract/CONTRACT.md', () => {
    expect([...FIXTURE_NAMES].sort()).toEqual(
      ['absorbed', 'awaiting-next', 'boss-internet', 'boss-power', 'boss-recovered', 'boss-storm', 'breaker', 'calm', 'cancelled', 'curses-404', 'deferred', 'downtime', 'elimination-corpse', 'full', 'hero-crash', 'inbox', 'intensity-11', 'laps-reviews', 'loop', 'meltdown', 'parked', 'part-added', 'stacked-chaos', 'stress', 'tournament-r1-r4', 'typo-discount', 'typo-redo', 'typo-refund', 'wall-corpse', 'world-events'].sort(),
    );
  });

  it('the committed files are exactly what the generator produces', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl') && !/^(night|finale)/.test(f)).sort();
    expect(files).toEqual(FIXTURE_NAMES.map((n) => `${n}.jsonl`).sort());
    for (const name of FIXTURE_NAMES) {
      const text = readFileSync(resolve(dir, `${name}.jsonl`), 'utf8').replace(/\r\n/g, '\n');
      expect(text, `${name}.jsonl is stale, run npm run make:fixtures`).toBe(get(name).map((e) => JSON.stringify(e)).join('\n') + '\n');
    }
  });

  for (const name of FIXTURE_NAMES) {
    it(`${name}: valid against the schema and the ordering rules`, () => {
      const events = parseJsonl(readFileSync(resolve(dir, `${name}.jsonl`), 'utf8'));
      const v = validateEvents(events);
      expect(formatViolations(v)).toBe('');
      expect(events[0].type).toBe('hello');
      expect(events[1].type).toBe('wave_start');
      // A tournament stream ends with the review events that follow the last wave_end (round_end, corpse, awaiting_next, tournament_end).
      expect(['wave_end', 'awaiting_next', 'tournament_end']).toContain(events[events.length - 1].type);
    });
  }

  it('ignores unknown fields on events (C5, rule 17)', () => {
    const ev = structuredClone(get('calm').slice(0, 5));
    (ev[2] as any).futureField = { a: 1 };
    ev.push({ seq: 99, ts: ev[ev.length - 1].ts + 1, type: 'wave_end', wave: 1, detail: { summary: {} } });
    expect(validateEvents(ev).filter((x) => x.rule === 'schema')).toEqual([]);
  });
});

describe('contract v1.1 fixtures (PT-C0c)', () => {
  const reviews = (name: string, n: number): any[] => lane(get(name), n).filter((e) => e.type === 'review').map((e) => e.detail);

  it('every v1.1 fixture says contractMinor 1 and carries laps and reviews', () => {
    for (const name of ['hero-crash', 'laps-reviews', 'cancelled', 'world-events', 'typo-refund', 'typo-discount', 'typo-redo', 'boss-recovered', 'downtime']) {
      const ev = get(name);
      expect(ev[0]).toMatchObject({ type: 'hello', contractMinor: 1 });
      expect(ev.some((e) => e.type === 'review'), name).toBe(true);
      for (const e of ev.filter((x) => x.type === 'order_done' || x.type === 'order_failed')) expect(e.detail!.lap, `${name} ${e.type}`).toBeDefined();
    }
  });

  it('laps-reviews: cumulative tracker with 5, 4.5 and 2 stars on lane 1', () => {
    const r = reviews('laps-reviews', 1);
    expect(r.map((x) => x.stars)).toEqual([5, 4.5, 2]);
    expect(r.map((x) => `${x.cum.stars}/${x.cum.max}`)).toEqual(['5/5', '9.5/10', '11.5/15']);
  });

  it('cancelled: one star and -300 for the cancelled order', () => {
    const l1 = lane(get('cancelled'), 1);
    expect(reviews('cancelled', 1)[1].stars).toBe(1);
    expect(l1.some((e) => e.type === 'score' && e.detail!.reason === 'order cancelled' && e.detail!.delta === -300)).toBe(true);
    expect(l1.find((e) => e.type === 'chaos')!.detail).toMatchObject({ fault: 'sms_down', creature: 'gargoyle' });
  });

  it('world-events: five world faults with their creatures', () => {
    const faults = get('world-events').filter((e) => e.type === 'chaos').map((e) => `${e.detail!.fault}:${e.detail!.creature}`).sort();
    expect(faults).toEqual(['app_down:imp', 'car_accident:phantom_car', 'no_answer:black_cat', 'sms_down:gargoyle', 'wrong_address:scarecrow']);
  });

  it('typo fixtures: one decision each, resolved as named', () => {
    const want: Record<string, string> = { 'typo-refund': 'refund', 'typo-discount': 'discount', 'typo-redo': 'redo' };
    for (const [name, choice] of Object.entries(want)) {
      const d = get(name).filter((e) => e.type === 'decision_made');
      expect(d).toHaveLength(1);
      expect(d[0].detail!.choice).toBe(choice);
    }
    expect(get('typo-redo').some((e) => e.type === 'order_start' && e.detail!.redo === true)).toBe(true);
    expect(get('typo-refund').some((e) => e.type === 'order_failed' && e.detail!.reason === 'refunded')).toBe(true);
  });

  it('boss-recovered: bonus and refund come in pairs; downtime: penalties are negative', () => {
    const b = get('boss-recovered').filter((e) => e.type === 'score' && (e.detail!.reason === 'boss recovered' || e.detail!.reason === 'boss downtime refund'));
    expect(b.length).toBeGreaterThan(0);
    expect(b.filter((e) => e.detail!.reason === 'boss recovered')).toHaveLength(b.filter((e) => e.detail!.reason === 'boss downtime refund').length);
    const dt = get('downtime').filter((e) => e.type === 'score' && e.detail!.reason === 'downtime');
    expect(dt.length).toBeGreaterThanOrEqual(2);
    expect(dt.every((e) => e.detail!.delta < 0)).toBe(true);
  });

  it('hero-crash keeps the loop grades: wave summary carries the v1.1 fields', () => {
    const end = get('hero-crash').find((e) => e.type === 'wave_end')!;
    for (const s of Object.values<any>(end.detail!.summary)) expect(s).toMatchObject({ orders: expect.any(Object), stars: expect.any(Object), rating: expect.any(String) });
  });
});

describe('storyboards (C3)', () => {
  it('calm: five lanes, four clean orders each, no chaos', () => {
    const ev = get('calm');
    expect(ev.filter((e) => e.type === 'lane_ready')).toHaveLength(5);
    expect(ev.some((e) => e.type === 'chaos')).toBe(false);
    expect(ev.filter((e) => e.type === 'order_done' && e.detail!.clean)).toHaveLength(20);
    const span = (ev[ev.length - 1].ts - ev[0].ts) / 1000;
    expect(span).toBeGreaterThan(50);
    expect(span).toBeLessThan(75);
  });

  it('hero-crash lane 5 (Phoenix): kill, replay, reconcile, no repeat', () => {
    const l5 = lane(get('hero-crash'), 5);
    const i = l5.findIndex((e) => e.type === 'chaos');
    const seq = l5.slice(i, i + 16).map((e) => `${e.type}${e.type === 'recover_start' || e.type === 'recover_done' ? ':' + e.detail!.action : ''}${e.detail?.skipped ? ':skipped' : ''}${e.detail?.replayed ? ':replayed' : ''}`);
    expect(seq).toEqual([
      'chaos', 'effect', 'process_dead', 'process_up', 'recover_start:replay',
      'stage_start', 'stage_done:skipped', 'stage_start', 'stage_done:skipped', 'stage_start', 'stage_done:skipped',
      'stage_start', 'recover_start:reconcile', 'effect:replayed', 'recover_done:reconcile', 'stage_done',
    ]);
    expect(l5[i].detail).toMatchObject({ creature: 'reaper', fault: 'crash', depth: 1, injectedAt: 'after_effect', source: 'demo' });
    const done = l5.find((e) => e.type === 'stage_done' && e.stage === 'payment' && e.detail!.reconciled);
    expect(done?.detail).toMatchObject({ skipped: false, reconciled: true });
    expect(l5.some((e) => e.type === 'repeat')).toBe(false);
    expect(l5.find((e) => e.type === 'order_done')!.detail).toMatchObject({ clean: true });
  });

  it('hero-crash: account is the first stage of every lane and Retrier to Phoenix never duplicate a ledger effect', () => {
    const ev = get('hero-crash');
    for (const n of [1, 2, 3, 4, 5]) {
      expect(lane(ev, n).find((e) => e.type === 'stage_start')!.stage).toBe('account');
    }
    // Lanes 2 to 4 are not pressed in the hero script, lane 5 (Phoenix) is crashed and reconciles: no `repeat` on any of them.
    for (const n of [2, 3, 4, 5]) expect(lane(ev, n).filter((e) => e.type === 'repeat')).toEqual([]);
    // One effect per kind per order on those lanes: account, order, charge, email, store x2, dispatch, notify x2.
    for (const n of [2, 3, 4, 5]) {
      const keys = lane(ev, n).filter((e) => e.type === 'effect' && !e.detail!.replayed).map((e) => `${e.order}|${e.detail!.key}`);
      expect(new Set(keys).size).toBe(keys.length);
      expect(new Set(lane(ev, n).filter((e) => e.type === 'effect').map((e) => e.detail!.kind))).toEqual(new Set(['account_create', 'order', 'charge', 'email', 'store', 'dispatch', 'notify']));
    }
  });

  it('hero-crash lane 1 (Rookie): restart from stage 1, repeats the account, the order then the charge', () => {
    const l1 = lane(get('hero-crash'), 1);
    const i = l1.findIndex((e) => e.type === 'chaos');
    const head = types(l1.slice(i, i + 7));
    expect(head).toEqual(['chaos', 'effect', 'process_dead', 'process_up', 'recover_start', 'recover_done', 'stage_start']);
    expect(l1[i + 4].detail!.action).toBe('restart');
    expect(l1[i + 6]).toMatchObject({ stage: 'account', detail: { attempt: 2 } });
    const repeats = l1.filter((e) => e.type === 'repeat');
    expect(repeats.map((e) => e.detail!.kind)).toEqual(['account_create', 'order', 'charge']);
    const scores = l1.filter((e) => e.type === 'score' && e.detail!.delta === -150);
    expect(scores).toHaveLength(3);
    expect(repeats[0].seq).toBeLessThan(repeats[1].seq);
    expect(repeats[1].seq).toBeLessThan(repeats[2].seq);
    expect(l1.find((e) => e.type === 'order_done')!.detail).toMatchObject({ clean: false, repeats: 3 });
    expect(get('hero-crash').find((e) => e.type === 'process_dead')!.detail!.restartInMs).toBe(1000);
  });

  it('hero-crash: lanes 2, 3 and 4 are never hit', () => {
    for (const n of [2, 3, 4]) expect(lane(get('hero-crash'), n).some((e) => e.type === 'chaos')).toBe(false);
    expect(get('hero-crash').filter((e) => e.type === 'order_start' && e.lane === 3)).toHaveLength(5);
  });

  it('stacked-chaos: depth 1, 2, 3 and the survival bonus 25 + 50 + 75', () => {
    const l5 = lane(get('stacked-chaos'), 5);
    const chaos = l5.filter((e) => e.type === 'chaos');
    expect(chaos.map((e) => `${e.detail!.creature}:${e.detail!.fault}:${e.detail!.depth}:${e.detail!.scope}`)).toEqual(['zombie:timeout:1:outer', 'ghost:http_404:2:inner', 'reaper:crash:3:inner']);
    const bonus = l5.filter((e) => e.type === 'score' && String(e.detail!.reason).startsWith('survived')).map((e) => e.detail!.delta);
    expect(bonus).toEqual([25, 50, 75]);
    expect(l5.find((e) => e.type === 'order_done')!.detail!.clean).toBe(true);
    expect(types(l5)).toContain('process_dead');
    expect(types(l5)).toContain('process_up');
  });

  it('boss-power: warning, 8 s later the start, one boss chaos per lane, five second restarts, then the end', () => {
    const ev = get('boss-power');
    const warn = ev.find((e) => e.type === 'boss_warning')!;
    const start = ev.find((e) => e.type === 'boss_start')!;
    const end = ev.find((e) => e.type === 'boss_end')!;
    expect(warn.detail).toMatchObject({ boss: 'boss_power_outage', startsInMs: 8000 });
    expect(start.ts - warn.ts).toBe(8000);
    const chaos = ev.filter((e) => e.type === 'chaos' && e.detail!.source === 'boss');
    expect(chaos.map((e) => e.lane).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(chaos.every((e) => e.detail!.creature === 'lich' && e.detail!.fault === 'boss_power_outage')).toBe(true);
    const dead = ev.filter((e) => e.type === 'process_dead' && e.ts >= start.ts);
    expect(dead.every((e) => e.detail!.restartInMs === 5000)).toBe(true);
    expect(end.ts).toBeGreaterThan(start.ts + 5000);
    // Lanes 4 and 5 stay clean, lanes 1 and 2 repeat.
    const repeats = (n: number): number => ev.filter((e) => e.type === 'repeat' && e.lane === n).length;
    expect(repeats(4)).toBe(0);
    expect(repeats(5)).toBe(0);
    expect(repeats(1)).toBeGreaterThan(0);
    expect(repeats(2)).toBeGreaterThan(0);
  });

  it('meltdown: halt on lane 1, failed order on lane 2, quarantine then a clean order on lane 5', () => {
    const ev = get('meltdown');
    const l1 = types(lane(ev, 1));
    const h = l1.indexOf('lane_halted');
    expect(l1.slice(h - 2, h + 1)).toEqual(['chaos', 'stage_fail', 'lane_halted']);
    expect(l1.filter((t) => t === 'order_abandoned')).toHaveLength(3);
    const l2 = lane(ev, 2);
    const fails = l2.filter((e) => e.type === 'stage_fail' && e.stage === 'payment');
    expect(fails).toHaveLength(3);
    expect(types(l2)).toContain('order_failed');
    const l5 = types(lane(ev, 5));
    expect(l5).toContain('order_quarantined');
    expect(l5.indexOf('order_done')).toBeGreaterThan(l5.indexOf('order_quarantined'));
    const doneAfter = lane(ev, 5).filter((e) => e.type === 'order_done')[0];
    expect(doneAfter.detail!.clean).toBe(true);
  });

  it('full: hero, stacked chaos and the Lich in one stream', () => {
    const ev = get('full');
    expect(ev.filter((e) => e.type === 'order_start' && e.lane === 3)).toHaveLength(9);
    expect(ev.some((e) => e.type === 'boss_start')).toBe(true);
    expect(lane(ev, 5).filter((e) => e.type === 'chaos').length).toBe(5);
    const span = (ev[ev.length - 1].ts - ev[0].ts) / 1000;
    expect(span).toBeGreaterThan(140);
    expect(span).toBeLessThan(190);
  });

  it('loop: wave 1 grades F and A, hardening, three parts, wave 2 clean on both lanes', () => {
    const ev = get('loop');
    const ends = ev.filter((e) => e.type === 'wave_end');
    expect(ends).toHaveLength(2);
    expect(ends[0].detail!.summary['1'].grade).toBe('F');
    expect(ends[0].detail!.summary['2'].grade).toBe('A');
    expect(ends[1].detail!.summary['1'].grade).toBe('A');
    expect(ends[1].detail!.summary['2'].grade).toBe('A');
    expect(ev.some((e) => e.type === 'reset')).toBe(false);
    expect(ev.filter((e) => e.type === 'hello')).toHaveLength(1);
    const mid = ev.filter((e) => ['hardening_spec', 'fix_applied', 'part_added'].includes(e.type));
    expect(types(mid)).toEqual(['hardening_spec', 'fix_applied', 'part_added', 'part_added', 'part_added']);
    expect(mid.every((e) => e.wave === 1)).toBe(true);
    expect(mid.filter((e) => e.type === 'part_added').map((e) => e.detail!.part)).toEqual(['retry', 'journal', 'idempotency']);
    expect(mid[1].detail).toMatchObject({ recorded: true });
    const w2 = ev.filter((e) => e.wave === 2);
    expect(w2.filter((e) => e.type === 'repeat')).toHaveLength(0);
    expect(w2.filter((e) => e.type === 'chaos')).toHaveLength(6);
    expect(ev.filter((e) => e.wave === 1 && e.type === 'repeat').every((e) => e.lane === 1)).toBe(true);
  });

  it('parked and breaker: the breaker opens, half-opens, closes and the order resumes', () => {
    for (const name of ['parked', 'breaker']) {
      const l5 = lane(get(name), 5);
      const t = types(l5);
      expect(t).toContain('order_parked');
      expect(t).toContain('order_resumed');
      const states = l5.filter((e) => e.type === 'breaker').map((e) => e.detail!.state);
      expect(states[0]).toBe('open');
      expect(states).toContain('half_open');
      expect(states[states.length - 1]).toBe('closed');
      const resumed = l5.find((e) => e.type === 'order_resumed')!;
      const next = l5[l5.indexOf(resumed) + 1];
      expect(next).toMatchObject({ type: 'order_start', order: resumed.order });
    }
  });

  it('absorbed: disk_full on journal-less and journaled lanes and a slow link are absorbed', () => {
    const ev = get('absorbed');
    const reasons = ev.filter((e) => e.type === 'chaos_absorbed').map((e) => `${e.lane}:${e.detail!.reason}`);
    expect(reasons.some((r) => r.startsWith('1:'))).toBe(true);
    expect(reasons.some((r) => r.startsWith('2:') && r.includes('slow link'))).toBe(true);
    expect(reasons.some((r) => r.startsWith('3:') && r.includes('journal write retried'))).toBe(true);
  });

  it('deferred: chaos marked deferred lands on the next stage that takes it', () => {
    const ev = get('deferred');
    const c = ev.filter((e) => e.type === 'chaos' && e.detail!.deferred);
    expect(c.length).toBeGreaterThanOrEqual(2);
    const l5 = lane(ev, 5);
    const chaosIdx = l5.findIndex((e) => e.type === 'chaos');
    const fail = l5.slice(chaosIdx).find((e) => e.type === 'stage_fail');
    // The 404 lands in create (input), the first stage that takes it is submit.
    expect(fail?.stage).toBe('submit');
  });

  it('boss-internet and boss-storm carry their boss faults', () => {
    expect(get('boss-internet').find((e) => e.type === 'boss_warning')!.detail!.boss).toBe('boss_internet_outage');
    expect(get('boss-storm').find((e) => e.type === 'boss_warning')!.detail!.boss).toBe('boss_hazard_storm');
    const storm = get('boss-storm').filter((e) => e.type === 'chaos' && e.detail!.source === 'boss');
    expect(storm.every((e) => e.detail!.creature === 'headless_horseman')).toBe(true);
  });

  it('inbox: two lanes, eleven stages, ticket effects, crash at reply', () => {
    const ev = get('inbox');
    expect(ev.find((e) => e.type === 'wave_start')!.detail!.app).toBe('inbox');
    expect(ev.filter((e) => e.type === 'lane_ready')).toHaveLength(2);
    expect(new Set(ev.filter((e) => e.stage).map((e) => e.stage))).toEqual(new Set(['login', 'ingest', 'validate', 'dedupe', 'triage', 'assign', 'sla', 'notify', 'escalate', 'resolve', 'close']));
    expect(ev.some((e) => e.type === 'effect' && e.detail!.kind === 'ticket')).toBe(true);
    expect(ev.filter((e) => e.type === 'chaos').every((e) => e.detail!.fault === 'crash')).toBe(true);
    expect(ev.some((e) => e.type === 'order_start' && String(e.order).startsWith('msg-'))).toBe(true);
  });

  it('stress: about 200 events per second for 30 seconds', () => {
    const ev = get('stress');
    const span = (ev[ev.length - 1].ts - ev[0].ts) / 1000;
    expect(span).toBeGreaterThan(28);
    expect(ev.length / span).toBeGreaterThan(190);
  });

  it('part-added: three part_added events on lane 1 inside one wave', () => {
    const ev = get('part-added');
    const p = ev.filter((e) => e.type === 'part_added');
    expect(p).toHaveLength(3);
    expect(p.every((e) => e.lane === 1 && e.wave === 1)).toBe(true);
    expect(ev.filter((e) => e.type === 'wave_start')).toHaveLength(1);
  });
});
