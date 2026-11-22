// TV3-C9: curses (spec 5.2, V1_2 section 5).
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST_ROUTES, Provider, type CurseHit, type FaultSpec, type ProviderClock } from '../../core/src/provider';
import { ProcessKilled, Sdk, type Host, type Transport } from '../src/sdk';
import { Pipeline, generateOrders, tierById } from '../src/pipeline';
import { RunnerEngine } from '../src/runner';
import { CURSE_KINDS, CURSE_LABELS, classifyHit, curseTable, drawCurse, effectSeen, stageOfCall } from '../src/tournament/curses';
import { laneCases } from '../src/tournament/signature';
import { isIssueEvent } from '../src/runner/floor';
import { review } from '../src/score/review';
import { LapTracker } from '../../core/src/live/lap-tracker';
import { validateEvents } from '../src/contract/validate';
import { FIXTURES } from '../../core/src/sim/fixtures';
import type { Ev } from '../src/tournament/rp';
import type { HauntEvent as SEvent } from '../src/score/score';

const PATHS = Object.fromEntries(Object.entries(POST_ROUTES).map(([p, k]) => [k, p]));

describe('the five curses', () => {
  it('have the wire names of V1_2 and the ranges of spec 5.2', () => {
    expect([...CURSE_KINDS]).toEqual(['404', 'slow', 'flaky500', 'clock_skew', 'rate_limit']);
    expect(CURSE_LABELS['404']).toBe('Cursed 404');
    for (let n = 1; n <= 80; n++) {
      const a = drawCurse(7, 1, n, '404'); expect(a.rate).toBeGreaterThanOrEqual(0.15); expect(a.rate).toBeLessThanOrEqual(0.4);
      const s = drawCurse(7, 1, n, 'slow'); expect(s.delayMs).toBeGreaterThanOrEqual(2000); expect(s.delayMs).toBeLessThanOrEqual(8000);
    }
    expect(drawCurse(7, 2, 3)).toEqual(drawCurse(7, 2, 3));
    expect(new Set(Array.from({ length: 60 }, (_, n) => drawCurse(7, 1, n).kind)).size).toBe(5);
  });

  it('calls map to the stage they belong to', () => {
    expect([stageOfCall('charge'), stageOfCall('store', 1), stageOfCall('store', 2), stageOfCall('notify', 2), stageOfCall('tracking'), stageOfCall('dispatch')]).toEqual(['payment', 'receive', 'process', 'updates', 'transit', 'ship']);
  });
});

describe('the provider lies on one endpoint of one lane, persistently', () => {
  const mk = (curses: FaultSpec['curses'], lane = 'L1') => {
    let now = 0;
    const clock: ProviderClock = { now: () => now, sleep: async (ms) => { now += ms; } };
    const p = new Provider({ clock, seed: 'curse-seed' });
    const hits: CurseHit[] = [];
    p.onCurse = (h) => hits.push(h);
    void p.handle({ method: 'POST', path: '/_fault', body: { lane, service: '*', mode: 'curse', curses } as never });
    const call = async (l: string, path: string, order: string, body: Record<string, unknown> = {}) => { const t0 = now; const r = await p.handle({ method: 'POST', path, body: { lane: l, order, ...body } }); return { r, ms: now - t0 }; };
    return { p, hits, call, clock: () => now };
  };

  it('Cursed 404 hits the given share of calls with 404 and leaves the others and other endpoints alone', async () => {
    const { call, hits } = mk([{ id: 'c1', kind: '404', service: 'charge', rate: 0.3 }]);
    let n404 = 0;
    for (let i = 0; i < 400; i++) { const { r } = await call('L1', '/charges', `ord-${i}`, { amount: 1 }); if (r.status === 404) n404++; else expect(r.status).toBe(201); }
    expect(n404).toBeGreaterThan(80); expect(n404).toBeLessThan(160);
    expect(hits).toHaveLength(n404);
    expect(hits[0]).toMatchObject({ lane: 'L1', service: 'charge', curse: '404', id: 'c1', status: 404 });
    expect((await call('L1', '/emails', 'ord-1')).r.status).toBe(201);
    expect((await call('L2', '/charges', 'ord-1', { amount: 1 })).r.status).toBe(201);
    expect(hits).toHaveLength(n404);
  });

  it('is seeded: the same calls lie the same way', async () => {
    const run = async () => { const { call } = mk([{ id: 'c1', kind: 'flaky500', service: 'charge', rate: 0.4 }]); const out: number[] = []; for (let i = 0; i < 40; i++) out.push((await call('L1', '/charges', `o${i}`, { amount: 1 })).r.status); return out; };
    expect(await run()).toEqual(await run());
  });

  it('Slow Hand makes every call slower by its delay, Flaky 500 answers 500, Rate Limited answers 429 with Retry-After, Skewed Clock only moves the clock header', async () => {
    const slow = mk([{ id: 's', kind: 'slow', service: 'account', delayMs: 5000 }]);
    const a = await slow.call('L1', '/accounts', 'ord-1');
    expect(a.r.status).toBe(201);
    expect(a.ms).toBeGreaterThanOrEqual(5000);
    expect(slow.hits).toHaveLength(1);
    const f = mk([{ id: 'f', kind: 'flaky500', service: 'email', rate: 1 }]);
    expect((await f.call('L1', '/emails', 'ord-1')).r.status).toBe(500);
    const r = mk([{ id: 'r', kind: 'rate_limit', service: 'order', rate: 1 }]);
    const rl = (await r.call('L1', '/orders', 'ord-1')).r;
    expect([rl.status, rl.headers['Retry-After']]).toEqual([429, '1']);
    const c = mk([{ id: 'k', kind: 'clock_skew', service: 'charge' }]);
    const sk = (await c.call('L1', '/charges', 'ord-1', { amount: 1 })).r;
    expect(sk.status).toBe(201);
    expect(Number(sk.headers['X-Haunt-Clock-Jump'])).toBeGreaterThan(3_600_000);
    expect(c.hits[0]).toMatchObject({ curse: 'clock_skew', status: 201 });
  });

  it('persists when the provider is reset between waves, until the list is replaced', async () => {
    const { p, call } = mk([{ id: 'f', kind: 'flaky500', service: 'email', rate: 1 }]);
    await p.handle({ method: 'POST', path: '/_reset' });
    expect((await call('L1', '/emails', 'ord-1')).r.status).toBe(500);
    await p.handle({ method: 'POST', path: '/_fault', body: { lane: 'L1', service: '*', mode: 'curse', curses: [] } as never });
    expect((await call('L1', '/emails', 'ord-2')).r.status).toBe(201);
  });
});

describe('how a bot reacted', () => {
  const trace = (o: Partial<{ effects: { kind: string; key: string }[]; failed: boolean; died: boolean }> = {}) => ({ order: 'ord-0001', effects: [], failed: false, died: false, ...o });

  it('classifies handled, reported, swallowed and crashed', () => {
    const charge = [{ kind: 'charge', key: 'ord-0001:charge' }];
    expect(classifyHit('order_done', trace({ effects: charge }), 'charge')).toBe('handled');
    expect(classifyHit('order_done', trace(), 'charge')).toBe('swallowed');
    expect(classifyHit('order_done', trace(), 'tracking')).toBe('handled');
    expect(classifyHit('order_parked', trace(), 'charge')).toBe('reported');
    expect(classifyHit('order_failed', trace({ failed: true }), 'charge')).toBe('reported');
    expect(classifyHit('order_failed', trace(), 'charge')).toBe('crashed');
    expect(classifyHit('order_done', trace({ effects: charge, died: true }), 'charge')).toBe('crashed');
    expect(effectSeen([{ kind: 'store', key: 'ord-0001:store:1' }], 'store', 2)).toBe(false);
    expect(effectSeen([{ kind: 'store', key: 'ord-0001:store:2' }], 'store', 2)).toBe(true);
    expect(effectSeen([{ kind: 'account_create', key: 'ord-0001:account' }], 'account')).toBe(true);
  });

  it('the table: what each lane returned when the API lied', () => {
    const e = (type: string, lane: number, detail: Record<string, unknown>): Ev => ({ type, lane: String(lane), detail });
    const rows = curseTable([
      e('curse_start', 1, { id: 'a', kind: '404', endpoint: 'charge' }), e('curse_response', 1, { curse: '404', class: 'reported' }), e('curse_response', 1, { curse: '404', class: 'crashed' }),
      e('curse_response', 3, { curse: '404', class: 'handled' }), e('curse_response', 3, { curse: '404', class: 'swallowed' }), e('curse_response', 2, { curse: 'slow', class: 'handled' }),
    ]);
    expect(rows.map((r) => [r.lane, r.curse, r.handled, r.reported, r.swallowed, r.crashed, r.total])).toEqual([[1, '404', 0, 1, 0, 1, 2], [2, 'slow', 1, 0, 0, 0, 1], [3, '404', 1, 0, 1, 0, 2]]);
    expect(rows[0]).toMatchObject({ endpoint: 'charge', tier: 'Rookie', verdict: 'crashed' });
    expect(rows[2]!.verdict).toMatch(/swallowed errors/);
    expect(rows[1]!.verdict).toBe('handled');
  });
});

describe('engine: curses persist, follow the level and classify live', () => {
  const settings = (lanes: number[], round = 1) => ({ orders: 4, seed: 7, tiers: 'race' as const, lanes: lanes.length, speed: 1, pace: 'show' as const, app: 'orders', tournament: { round, lanes, level: 3, script: {} } });
  function boot() {
    const events: SEvent[] = [];
    const posted: FaultSpec[] = [];
    const engine = new RunnerEngine({ laneInfo: () => ({ state: 'working', stage: 'payment' }), post: async (b) => { posted.push(b); } });
    // As in the runtime: the engine sees an event before it is published, so a curse_response lands before its order_done.
    const record = (e: SEvent) => { engine.observe(e); events.push(e); };
    engine.startWave(1, settings([1, 2, 3, 4, 5]), record);
    return { engine, events, posted, record };
  }

  it('curses per lane follow the table: none up to level 3, then 1, 1, 1, 2, 2, 2, 3, all five at 11, five distinct kinds', () => {
    const counts: number[] = [];
    for (const level of [1, 3, 4, 6, 7, 9, 10, 11]) { const { engine } = boot(); engine.assignCurses([1, 2], level, 7, 1); counts.push(engine.curses.get(1)?.length ?? 0); }
    expect(counts).toEqual([0, 0, 1, 1, 2, 2, 3, 5]);
    const { engine } = boot();
    engine.assignCurses([1], 11, 7, 1);
    expect(new Set(engine.curses.get(1)!.map((c) => c.kind)).size).toBe(5);
  });

  it('a curse is announced with curse_start, posted to the provider, kept for the next round, and ended with curse_end', () => {
    const { engine, events, posted } = boot();
    const c = engine.addCurse(2, '404', 'charge');
    expect(events.at(-1)).toMatchObject({ type: 'curse_start', lane: '2', detail: { id: c.id, kind: '404', endpoint: 'charge', source: 'player' } });
    expect(posted.at(-1)).toMatchObject({ lane: '2', mode: 'curse', curses: [{ id: c.id, kind: '404', service: 'charge' }] });
    engine.startWave(2, settings([2, 3, 4, 5], 2), (e) => events.push(e));
    expect(engine.curses.get(2)).toHaveLength(1);
    expect(posted.filter((p) => p.mode === 'curse').length).toBeGreaterThanOrEqual(2);
    // The curse stays on a lane that is no longer live (a corpse keeps its tag) until it is ended.
    engine.startWave(3, settings([3, 4, 5], 3), (e) => events.push(e));
    expect(engine.curses.get(2)).toHaveLength(1);
    expect(engine.endCurse(2, c.id)).toBe(true);
    expect(events.length).toBeGreaterThan(0);
    expect(engine.endCurse(2, c.id)).toBe(false);
  });

  it('emits curse_response after the order ends: handled, swallowed (step skipped), reported (failed with an error), crashed (process died)', () => {
    const { engine, events, record } = boot();
    const ev = (type: string, lane: number, detail: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => record({ type, lane: String(lane), detail, ...extra } as SEvent);
    const hit = (lane: number, service: string, index?: number) => engine.noteCurse({ lane: String(lane), service, order: 'ord-0001', ...(index ? { index } : {}), curse: '404', id: `cu-${lane}`, status: 404 });
    // Lane 1: the charge row exists after a retry -> handled.
    ev('order_start', 1, {}, { order: 'ord-0001' }); hit(1, 'charge'); ev('effect', 1, { kind: 'charge', key: 'ord-0001:charge' }, { order: 'ord-0001' }); ev('order_done', 1, {}, { order: 'ord-0001' });
    // Lane 2: the second notice never happened, the order is done -> swallowed.
    ev('order_start', 2, {}, { order: 'ord-0001' }); hit(2, 'notify', 2); ev('effect', 2, { kind: 'notify', key: 'ord-0001:notify:1' }, { order: 'ord-0001' }); ev('order_done', 2, {}, { order: 'ord-0001' });
    // Lane 3: the error surfaced and the order failed -> reported.
    ev('order_start', 3, {}, { order: 'ord-0001' }); hit(3, 'charge'); ev('stage_fail', 3, { error: 'x' }, { order: 'ord-0001', stage: 'payment' }); ev('order_failed', 3, {}, { order: 'ord-0001' });
    // Lane 4: the process died after the lie -> crashed.
    ev('order_start', 4, {}, { order: 'ord-0001' }); hit(4, 'charge'); ev('process_dead', 4, { reason: 'crash' }); ev('order_done', 4, {}, { order: 'ord-0001' });
    // Lane 5: the ledger's effect reached the log BEFORE the bot's own order_start (the bot's stdout lags): the step still happened -> handled, not swallowed.
    ev('effect', 5, { kind: 'charge', key: 'ord-0001:charge' }, { order: 'ord-0001' }); ev('order_start', 5, {}, { order: 'ord-0001' }); hit(5, 'charge'); ev('order_done', 5, {}, { order: 'ord-0001' });
    const got = Object.fromEntries(events.filter((e) => e.type === 'curse_response').map((e) => [e.lane, e]));
    expect(got['1']).toMatchObject({ order: 'ord-0001', stage: 'payment', detail: { class: 'handled', curse: '404', endpoint: 'charge' } });
    expect(got['2']).toMatchObject({ stage: 'updates', detail: { class: 'swallowed' } });
    expect(got['3']!.detail).toMatchObject({ class: 'reported' });
    expect(got['4']!.detail).toMatchObject({ class: 'crashed' });
    expect(got['5']!.detail).toMatchObject({ class: 'handled' });
    // A curse_response lands before its order_done, and a swallowed or crashed one counts as an issue.
    const i = events.findIndex((e) => e.type === 'curse_response' && e.lane === '2');
    expect(events[i + 1]!.type).toBe('order_done');
    expect(isIssueEvent(got['2']!)).toBe(true);
    expect(isIssueEvent(got['4']!)).toBe(true);
    expect(isIssueEvent(got['1']!)).toBe(false);
    expect(isIssueEvent(got['3']!)).toBe(false);
  });
});

describe('real bots against a cursed provider', () => {
  class World {
    now = 0;
    readonly provider: Provider;
    readonly msgs: SEvent[] = [];
    readonly orders = generateOrders('seed-1', 2);
    readonly journalPath = join(mkdtempSync(join(tmpdir(), 'haunt-curse-')), 'lane.journal.jsonl');
    constructor(seed: string, readonly engine: RunnerEngine) {
      const clock: ProviderClock = { now: () => this.now, sleep: async (ms) => { this.now += ms; } };
      this.provider = new Provider({ clock, seed });
      this.provider.onCurse = (h) => engine.noteCurse(h);
      this.provider.onRow = (row) => this.log({ type: 'effect', lane: '1', order: row.order, detail: { kind: row.kind === 'account' ? 'account_create' : row.kind, key: row.key ?? `${row.order}:${row.kind}`, replayed: false } } as SEvent);
    }
    log(e: SEvent): void { this.engine.observe(e); this.msgs.push(e); }
    host: Host = { now: () => this.now, sleep: async (ms) => { this.now += ms; }, hook: async () => {}, emit: (m) => this.log({ lane: '1', ...(m as object) } as SEvent) };
    transport: Transport = {
      post: async (kind, body, o) => {
        const r = await this.provider.handle({ method: 'POST', path: PATHS[kind]!, body, headers: { ...(o.key ? { 'Idempotency-Key': o.key } : {}), 'X-Haunt-Phase': o.recovery ? 'recovery' : 'normal' } });
        if (r.drop) throw new Error('dropped');
        return { status: r.status, body: r.body, headers: r.headers };
      },
      lookup: async (kind, key) => (await this.provider.handle({ method: 'GET', path: '/lookup', query: { lane: '1', kind, key } })).body as { found: boolean; row?: Record<string, unknown> },
    };
    curse(c: NonNullable<FaultSpec['curses']>): void { void this.provider.handle({ method: 'POST', path: '/_fault', body: { lane: '1', service: '*', mode: 'curse', curses: c } as never }); }
    async run(tierId: string): Promise<string> {
      const tier = tierById(tierId);
      const sdk = new Sdk({ tier: tier.id, lane: '1', use: tier.use, host: this.host, transport: this.transport, journalPath: this.journalPath });
      await sdk.start();
      const p = new Pipeline({
        sdk, tier, seed: 'seed-1', lane: '1', readOrder: async (id) => this.orders.find((o) => o.id === id)!,
        pollTracking: async (s) => ((await this.provider.handle({ method: 'GET', path: `/tracking/${s}`, query: { lane: '1' } })).body as { status?: string }).status === 'delivered',
        hook: async () => {}, emit: (m) => this.host.emit(m),
      });
      try { return await p.run('ord-0001'); } catch (err) { if (err instanceof ProcessKilled) return 'killed'; throw err; }
    }
    classes(): string[] { return this.msgs.filter((m) => m.type === 'curse_response').map((m) => `${m.stage}:${(m.detail as { class: string }).class}`); }
  }
  const engine = () => { const e = new RunnerEngine(); e.startWave(1, { orders: 2, seed: 7, tiers: 'race', lanes: 1, speed: 1, pace: 'show', app: 'orders' }, () => {}); return e; };

  it('a Cursed 404 on the second notice: the update stage degrades, the order is done, the step is gone: swallowed (an issue with a big penalty)', async () => {
    const eng = engine();
    const w = new World('s', eng);
    // The engine records its own events; collect them through the same path.
    (eng as unknown as { record: (e: SEvent) => void }).record = (e) => w.log(e);
    w.curse([{ id: 'cu', kind: '404', service: 'notify', rate: 1 }]);
    expect(await w.run('rookie')).toBe('done');
    expect(w.classes()).toEqual(['updates:swallowed']);
    expect(isIssueEvent(w.msgs.find((m) => m.type === 'curse_response')!)).toBe(true);
    // The case a lane meets, for the Casebook and the miner:
    const cases = laneCases([{ type: 'order_start', lane: '1', order: 'ord-0001', detail: {} }, ...w.msgs.filter((m) => m.type !== 'order_start')] as never, 1, 1);
    expect(cases.find((c) => c.fault === 'curse_404')).toMatchObject({ signature: 'updates + curse_404 + swallowed', outcome: 'lost', consequence: 'swallowed' });
  });

  it('a Cursed 404 on the charge: the Rookie reports (its order fails with an error), a Retrier that retries gets through and has handled it', async () => {
    const eng1 = engine();
    const rookie = new World('s', eng1);
    (eng1 as unknown as { record: (e: SEvent) => void }).record = (e) => rookie.log(e);
    rookie.curse([{ id: 'cu', kind: '404', service: 'charge', rate: 1 }]);
    expect(await rookie.run('rookie')).toBe('failed');
    rookie.log({ type: 'order_failed', lane: '1', order: 'ord-0001', detail: { reason: 'x' } } as SEvent);
    expect(rookie.classes()).toEqual(['payment:reported']);

    let handled = 0;
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const e2 = engine();
      const w = new World(seed, e2);
      (e2 as unknown as { record: (e: SEvent) => void }).record = (e) => w.log(e);
      w.curse([{ id: 'cu', kind: '404', service: 'charge', rate: 0.5 }]);
      const result = await w.run('retrier');
      if (result === 'done' && w.msgs.some((m) => m.type === 'effect' && (m.detail as { kind: string }).kind === 'charge')) {
        w.log({ type: 'order_done', lane: '1', order: 'ord-0001', detail: {} } as SEvent);
        if (w.classes().length) { expect(w.classes().every((c) => c === 'payment:handled')).toBe(true); handled++; }
      }
    }
    expect(handled).toBeGreaterThan(0);
  });
});

describe('review, lap tracker and Casebook', () => {
  it('a swallowed answer caps the review at two stars and zeroes delivery, whatever else was good', () => {
    const base = { extra: {}, degraded: false, cancelled: false, baselineMs: 4000, lap: { ms: 4000, downtimeMs: 0, issues: [] } };
    expect(review(base).stars).toBe(5);
    const r = review({ ...base, swallowed: true });
    expect(r.stars).toBeLessThanOrEqual(2);
    expect(r.sub.delivery).toBe(1);
  });

  it('the lap tracker counts a swallowed answer as an issue of its order and lowers the review; a handled one costs nothing', () => {
    const ev = (type: string, ts: number, detail: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): SEvent => ({ type, ts, lane: '1', detail, ...extra } as SEvent);
    const run = (cls: string) => {
      const t = new LapTracker({ app: 'orders', pace: 1, speed: 1 });
      const out = [ev('order_start', 1000, { grabMs: 0 }, { order: 'ord-0001' }), ev('stage_start', 1100, {}, { order: 'ord-0001', stage: 'updates' }),
        ev('curse_response', 3000, { curse: '404', class: cls, order: 'ord-0001', stage: 'updates' }, { order: 'ord-0001', stage: 'updates' }),
        ev('stage_done', 3900, {}, { order: 'ord-0001', stage: 'updates' }), ev('order_done', 4000, {}, { order: 'ord-0001' })].flatMap((e) => t.process(e));
      return { stars: (out.find((e) => e.type === 'review')!.detail as { stars: number }).stars, issues: t.summary('1').issues };
    };
    expect(run('swallowed')).toMatchObject({ issues: 1 });
    expect(run('swallowed').stars).toBeLessThanOrEqual(2);
    expect(run('handled')).toMatchObject({ issues: 0, stars: 5 });
  });

  it('curse cases for the Casebook: handled is solved with a mechanism, reported is partly, swallowed and crashed are lost', () => {
    const e = (type: string, detail: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Ev => ({ type, lane: '2', detail, ...extra });
    const cases = laneCases([
      e('order_start', {}, { order: 'ord-0001' }), e('curse_response', { curse: 'slow', class: 'handled', stage: 'payment' }), e('order_done', {}, { order: 'ord-0001' }),
      e('order_start', {}, { order: 'ord-0002' }), e('curse_response', { curse: '404', class: 'reported', stage: 'payment' }), e('order_failed', {}, { order: 'ord-0002' }),
      e('order_start', {}, { order: 'ord-0003' }), e('curse_response', { curse: 'flaky500', class: 'crashed', stage: 'ship' }), e('order_done', {}, { order: 'ord-0003' }),
    ], 2, 1);
    expect(cases.map((c) => [c.signature, c.outcome, c.mechanism])).toEqual([
      ['payment + curse_slow + handled', 'solved', 'retry'], ['payment + curse_404 + reported', 'partly', 'none'], ['ship + curse_flaky500 + crashed', 'lost', 'none'],
    ].map((x) => x));
  });
});

describe('mock fixture curses-404', () => {
  const ev = FIXTURES['curses-404']!();

  it('is a valid stream: four lanes cursed, the classes of the table, curse_start before any response', () => {
    expect(validateEvents(ev)).toEqual([]);
    expect(ev.filter((e) => e.type === 'curse_start').map((e) => [e.lane, e.detail!.kind, e.detail!.endpoint])).toEqual([[1, '404', 'charge'], [2, '404', 'charge'], [3, '404', 'charge'], [4, '404', 'charge']]);
    const rows = curseTable(ev as never);
    expect(rows.map((r) => [r.lane, r.handled, r.reported, r.swallowed, r.crashed])).toEqual([[1, 0, 2, 0, 1], [2, 3, 0, 0, 0], [3, 2, 0, 1, 0], [4, 3, 0, 0, 0]]);
    expect(ev.findIndex((e) => e.type === 'curse_start')).toBeLessThan(ev.findIndex((e) => e.type === 'curse_response'));
  });

  it('the validator rejects a bad kind, a bad class and a curse_end for a curse that is not in force (rule 66)', () => {
    const run = (mut: (l: typeof ev) => void) => { const c = ev.map((x) => ({ ...x, detail: x.detail ? { ...x.detail } : x.detail })); mut(c); return validateEvents(c as never).map((v) => v.rule); };
    expect(run((l) => { l.find((x) => x.type === 'curse_start')!.detail!.kind = 'evil'; })).toContain('R66');
    expect(run((l) => { l.find((x) => x.type === 'curse_response')!.detail!.class = 'meh'; })).toContain('R66');
    expect(run((l) => { l.push({ seq: 99999, ts: l.at(-1)!.ts + 1, type: 'curse_end', wave: 1, lane: 1, detail: { id: 'nope' } } as never); })).toContain('R66');
  });
});
