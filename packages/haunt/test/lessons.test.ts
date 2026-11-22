// TV3-C8: lessons ledger and policy overlay (spec 4, V1_2 section 5).
import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST_ROUTES, Provider, type FaultSpec, type ProviderClock } from '../../core/src/provider';
import { ProcessKilled, Sdk, actionsFor, backoffRule, faultMatches, parsePolicy, type Host, type Policy, type Transport } from '../src/sdk';
import { Pipeline, generateOrders, tierById } from '../src/pipeline';
import { LessonsStore } from '../src/tournament/lessons-store';
import { emptyLessons, learnRound, lessonEvent, policyOf, suggestionFor } from '../src/tournament/lessons';
import { laneCases, signatureOf, type Case } from '../src/tournament/signature';
import type { Ev } from '../src/tournament/rp';
import { TIER_ORDER, TIERS } from '@haunt/shared';
import { validateEvents } from '../src/contract/validate';
import { mockTournament } from '../../core/src/sim/tournament-fixtures';

const e = (type: string, lane: number, detail: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Ev => ({ type, lane: String(lane), detail, ...extra });

describe('action sets by tier (spec 4)', () => {
  it('rookie none, retrier retry, journaler adds journal, reconciler adds idempotency, phoenix all', () => {
    const acts = (t: (typeof TIER_ORDER)[number]) => actionsFor(TIERS[t].parts);
    expect(acts('rookie')).toEqual([]);
    expect(acts('retrier')).toEqual(['retry_backoff']);
    expect(acts('journaler')).toEqual(['retry_backoff', 'journal_replay']);
    expect(acts('reconciler')).toEqual(['retry_backoff', 'journal_replay', 'idempotency_key']);
    expect(acts('phoenix')).toEqual(['retry_backoff', 'journal_replay', 'idempotency_key', 'breaker_park', 'hold_and_reroute']);
  });

  it('policy parsing keeps only well-formed rules; faults map to what the bot sees', () => {
    expect(parsePolicy({ version: 1, rules: [{ stage: 'payment', fault: 'timeout', action: 'retry_backoff' }, { nope: 1 }, { stage: 'x', fault: 'y', action: 'launch' }] }).rules).toHaveLength(1);
    expect(parsePolicy('junk').rules).toEqual([]);
    expect(faultMatches('endpoint_down', 503, 'x') && faultMatches('timeout', null, 'charge failed: client timeout') && faultMatches('http_404', 404, '')).toBe(true);
    expect(faultMatches('http_404', 500, '')).toBe(false);
    expect(backoffRule({ version: 1, rules: [{ stage: 'payment', fault: 'timeout', action: 'retry_backoff' }] }, 'ship', null, 'timeout')).toBeUndefined();
  });
});

describe('cases: the normalised signature stage + fault + consequence', () => {
  const orderEvents = (extra: Ev[]): Ev[] => [e('order_start', 2, {}, { order: 'ord-0001' }), e('stage_start', 2, {}, { order: 'ord-0001', stage: 'payment' }), ...extra];

  it('a timeout that repeated the charge is payment + timeout + duplicate_effect, partly solved', () => {
    const evs = orderEvents([e('chaos', 2, { fault: 'timeout' }), e('recover_start', 2, { action: 'retry' }), e('recover_done', 2, { action: 'retry', ms: 500 }), e('repeat', 2, { kind: 'charge' }), e('order_done', 2)]);
    const [c] = laneCases(evs, 2, 1);
    expect(c).toMatchObject({ signature: 'payment + timeout + duplicate_effect', outcome: 'partly', mechanism: 'retry', kinds: ['charge'], costMs: 500 });
  });

  it('recovered with a backoff and no repeat is solved, mechanism retry_backoff', () => {
    const evs = orderEvents([e('chaos', 2, { fault: 'endpoint_down' }), e('recover_start', 2, { action: 'backoff' }), e('recover_done', 2, { action: 'backoff', ms: 3500 }), e('order_done', 2), e('review', 2, { stars: 4 }, { order: 'ord-0001' })]);
    expect(laneCases(evs, 2, 1)[0]).toMatchObject({ signature: 'payment + endpoint_down + recovered', outcome: 'solved', mechanism: 'retry_backoff', costMs: 3500, stars: 4 });
  });

  it('a failed order is lost; a gremlin counts under its variant; the stage of a deferred fault is where it lands; absorbed faults are solved with no mechanism', () => {
    const lost = orderEvents([e('chaos', 2, { fault: 'endpoint_down', deferredTo: 'ship' }), e('order_failed', 2, { reason: 'x' })]);
    expect(laneCases(lost, 2, 1)[0]).toMatchObject({ signature: 'ship + endpoint_down + order_lost', outcome: 'lost', mechanism: 'none' });
    const gremlin = orderEvents([e('chaos', 2, { fault: 'gremlin', variant: 'http_500', source: 'gremlin' }), e('order_done', 2)]);
    expect(laneCases(gremlin, 2, 1)[0]).toMatchObject({ signature: 'payment + http_500 + absorbed', outcome: 'solved', mechanism: 'absorbed' });
    expect(signatureOf('a', 'b', 'c')).toBe('a + b + c');
  });

  it('an order lost with no fault of its own is blamed on the outage still in force from an earlier press, at the stage where it failed', () => {
    const evs = [
      ...orderEvents([e('chaos', 2, { fault: 'endpoint_down' }, { stage: 'payment' }), e('order_done', 2)]),
      e('order_start', 2, {}, { order: 'ord-0002' }), e('stage_start', 2, {}, { order: 'ord-0002', stage: 'ship' }), e('order_failed', 2, { reason: 'x' }, { order: 'ord-0002' }),
    ];
    const cases = laneCases(evs, 2, 1);
    expect(cases.map((c) => [c.order, c.signature, c.outcome])).toEqual([['ord-0001', 'payment + endpoint_down + absorbed', 'solved'], ['ord-0002', 'ship + endpoint_down + order_lost', 'lost']]);
  });

  it('ignores other lanes and flushes an order left open at the end of the wave as lost', () => {
    const evs = [...orderEvents([e('chaos', 2, { fault: 'timeout' })]), e('chaos', 3, { fault: 'timeout' })];
    const c = laneCases(evs, 2, 1);
    expect(c).toHaveLength(1);
    expect(c[0]!.outcome).toBe('lost');
  });
});

const caseOf = (o: Partial<Case>): Case => ({ signature: 'payment + timeout + duplicate_effect', stage: 'payment', fault: 'timeout', consequence: 'duplicate_effect', lane: 2, round: 1, order: 'ord-0001', outcome: 'lost', mechanism: 'none', costMs: 0, costPoints: 0, ...o });

describe('learning', () => {
  it('overcame (recovered, no repeat, a mechanism) becomes a lesson and earns the first-time bonus once', () => {
    const c = caseOf({ signature: 'payment + endpoint_down + recovered', fault: 'endpoint_down', consequence: 'recovered', outcome: 'solved', mechanism: 'retry_backoff' });
    const r1 = learnRound(emptyLessons(2, 'retrier'), [c], 1);
    expect(r1.newLessons).toEqual([expect.objectContaining({ signature: c.signature, via: 'overcame', action: 'retry_backoff', learnedRound: 1 })]);
    expect(r1.firstOvercome).toEqual([c.signature]);
    const r2 = learnRound(r1.next, [{ ...c, round: 2 }], 2);
    expect(r2.newLessons).toEqual([]);
    expect(r2.firstOvercome).toEqual([]);
  });

  it('absorbed faults teach nothing', () => {
    const r = learnRound(emptyLessons(2, 'retrier'), [caseOf({ outcome: 'solved', consequence: 'absorbed', mechanism: 'absorbed' })], 1);
    expect(r.newLessons).toEqual([]);
    expect(r.firstOvercome).toEqual([]);
  });

  it('a loss takes the reviewer rule proposal: a lesson when the tier has the part, a spec suggestion when it does not', () => {
    const lostTimeout = caseOf({ signature: 'payment + endpoint_down + order_lost', fault: 'endpoint_down', consequence: 'order_lost' });
    expect(suggestionFor(lostTimeout)).toEqual({ action: 'retry_backoff', part: 'retry', rule: 'R2' });
    const retrier = learnRound(emptyLessons(2, 'retrier'), [lostTimeout], 1);
    expect(retrier.newLessons[0]).toMatchObject({ via: 'suggested', action: 'retry_backoff', rule: { stage: 'payment', fault: 'endpoint_down', backoff: 'exp', maxAttempts: 5 } });
    const rookie = learnRound(emptyLessons(1, 'rookie'), [lostTimeout], 1);
    expect(rookie.newLessons).toEqual([]);
    expect(rookie.newSuggestions[0]).toMatchObject({ action: 'retry_backoff', part: 'retry', rule: 'R2' });
    // Duplicate charge: idempotency is a reconciler part, not a journaler one.
    const dup = caseOf({});
    expect(suggestionFor(dup)).toEqual({ action: 'idempotency_key', part: 'idempotency', rule: 'R1' });
    expect(learnRound(emptyLessons(3, 'journaler'), [dup], 1).newSuggestions).toHaveLength(1);
    expect(learnRound(emptyLessons(4, 'reconciler'), [dup], 1).newLessons[0]).toMatchObject({ action: 'idempotency_key', rule: { key: 'order-id' } });
  });

  it('a lesson is only learned once per signature and never beyond the tier', () => {
    const lost = caseOf({ signature: 'payment + endpoint_down + order_lost', fault: 'endpoint_down', consequence: 'order_lost' });
    const r1 = learnRound(emptyLessons(2, 'retrier'), [lost, lost], 1);
    expect(r1.newLessons).toHaveLength(1);
    expect(learnRound(r1.next, [lost], 2).newLessons).toEqual([]);
    for (const tier of TIER_ORDER) {
      const learned = learnRound(emptyLessons(1, tier), [lost, caseOf({}), caseOf({ signature: 'x + crash + order_lost', fault: 'crash', consequence: 'order_lost' })], 1).next.lessons;
      for (const l of learned) expect(actionsFor(TIERS[tier].parts)).toContain(l.action);
    }
  });

  it('the overlay carries lessons into the next round only, and the lesson event names signature, mechanism, round and via', () => {
    const r = learnRound(emptyLessons(2, 'retrier'), [caseOf({ signature: 'payment + endpoint_down + order_lost', fault: 'endpoint_down', consequence: 'order_lost' })], 1);
    expect(policyOf(r.next, 1).rules).toEqual([]);
    expect(policyOf(r.next, 2).rules).toHaveLength(1);
    expect(policyOf(r.next).rules).toHaveLength(1);
    expect(lessonEvent(2, r.newLessons[0]!)).toMatchObject({ type: 'lesson', lane: 2, stage: 'payment', detail: { lane: 2, signature: 'payment + endpoint_down + order_lost', mechanism: 'retry_backoff', round: 1, via: 'suggested' } });
  });
});

describe('store: lessons.json per lane and the overlay file the bot reads', () => {
  it('persists, writes and clears the overlay, and resets', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'haunt-lessons-')), 'lessons');
    const store = new LessonsStore(dir);
    const lost = caseOf({ signature: 'payment + endpoint_down + order_lost', fault: 'endpoint_down', consequence: 'order_lost' });
    expect(store.learn(2, 'retrier', [lost], 1).newLessons).toHaveLength(1);
    expect(new LessonsStore(dir).get(2, 'retrier').lessons).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(dir, '2.json'), 'utf8')).lessons[0].signature).toBe(lost.signature);
    expect(store.lanes()).toEqual([2]);
    const p = store.writePolicy(store.get(2, 'retrier'));
    expect(p.rules).toHaveLength(1);
    expect(parsePolicy(JSON.parse(readFileSync(store.policyFile(2), 'utf8'))).rules).toEqual(p.rules);
    expect(store.writePolicy(emptyLessons(2, 'retrier')).rules).toEqual([]);
    expect(existsSync(store.policyFile(2))).toBe(false);
    store.reset();
    expect(store.get(2, 'retrier').lessons).toEqual([]);
    expect(store.lanes()).toEqual([]);
  });
});

// ------------------------------------------------------------------------------- the effect is real

const LANE = '2';
const PATHS = Object.fromEntries(Object.entries(POST_ROUTES).map(([p, k]) => [k, p]));

class World {
  now = 0;
  readonly provider: Provider;
  readonly msgs: Ev[] = [];
  readonly orders = generateOrders('seed-1', 2);
  readonly journalPath = join(mkdtempSync(join(tmpdir(), 'haunt-learn-')), 'lane.journal.jsonl');
  constructor() {
    const clock: ProviderClock = { now: () => this.now, sleep: async () => {} };
    this.provider = new Provider({ clock });
  }
  host: Host = {
    now: () => this.now,
    sleep: async (ms) => { this.now += ms; },
    hook: async () => { /* no kills */ },
    emit: (m) => { this.msgs.push({ lane: LANE, ...(m as Ev) }); },
  };
  transport: Transport = {
    post: async (kind, body, o) => {
      const r = await this.provider.handle({ method: 'POST', path: PATHS[kind]!, body, headers: { ...(o.key ? { 'Idempotency-Key': o.key } : {}), 'X-Haunt-Phase': o.recovery ? 'recovery' : 'normal' } });
      if (r.drop) throw new Error('dropped');
      return { status: r.status, body: r.body, headers: r.headers };
    },
    lookup: async (kind, key) => (await this.provider.handle({ method: 'GET', path: '/lookup', query: { lane: LANE, kind, key } })).body as { found: boolean; row?: Record<string, unknown> },
  };
  fault(spec: Partial<FaultSpec>): void { this.provider.addFault({ lane: LANE, service: 'charge', mode: 'status', value: 503, ...spec } as FaultSpec); }
  async run(tierId: string, policy?: Policy): Promise<string> {
    const tier = tierById(tierId);
    const sdk = new Sdk({ tier: tier.id, lane: LANE, use: tier.use, host: this.host, transport: this.transport, journalPath: this.journalPath, ...(policy ? { policy } : {}) });
    await sdk.start();
    const p = new Pipeline({
      sdk, tier, seed: 'seed-1', lane: LANE, readOrder: async (id) => this.orders.find((o) => o.id === id)!,
      pollTracking: async (s) => ((await this.provider.handle({ method: 'GET', path: `/tracking/${s}`, query: { lane: LANE } })).body as { status?: string }).status === 'delivered',
      hook: async () => {}, emit: (m) => this.host.emit(m),
    });
    try { return await p.run('ord-0001'); } catch (err) { if (err instanceof ProcessKilled) return 'killed'; throw err; }
  }
  rows(): Record<string, number> { const o: Record<string, number> = {}; for (const r of this.provider.ledger(LANE)) o[r.kind] = (o[r.kind] ?? 0) + 1; return o; }
}

describe('a lesson measurably changes the next round (TV3-C8)', () => {
  /** Round 1 as the engine would record it: the order starts, the outage is pressed at Payment, then what the bot emitted. */
  const roundEvents = (w: World): Ev[] => [e('order_start', 2, {}, { order: 'ord-0001' }), e('chaos', 2, { fault: 'endpoint_down' }, { stage: 'payment' }), ...w.msgs.filter((m) => m.type !== 'order_start')];

  it('Retrier: a 3 s outage at Payment loses the order in round 1; after the loss it learns retry with backoff and the same outage is ridden out in round 2', async () => {
    const r1 = new World();
    r1.fault({ forMs: 3000 });
    expect(await r1.run('retrier')).toBe('failed');
    expect(r1.rows().charge).toBeUndefined();
    const store = new LessonsStore(join(mkdtempSync(join(tmpdir(), 'haunt-l2-')), 'l'));
    const learned = store.learn(2, 'retrier', laneCases(roundEvents(r1), 2, 1), 1);
    expect(learned.newLessons[0]).toMatchObject({ signature: 'payment + endpoint_down + order_lost', via: 'suggested', action: 'retry_backoff' });

    // Round 2, same storm: without the overlay it fails again, with it the order is done, with one charge.
    const again = new World(); again.fault({ forMs: 3000 });
    expect(await again.run('retrier')).toBe('failed');
    const policy = store.writePolicy(store.get(2, 'retrier'));
    const r2 = new World(); r2.fault({ forMs: 3000 });
    expect(await r2.run('retrier', policy)).toBe('done');
    expect(r2.rows()).toEqual({ account: 1, order: 1, charge: 1, email: 1, store: 2, dispatch: 1, notify: 2 });
    const actions = r2.msgs.filter((m) => m.type === 'recover_start').map((m) => (m.detail as { action: string }).action);
    expect(actions.length).toBeGreaterThan(2);
    expect(new Set(actions)).toEqual(new Set(['backoff']));
    // The lesson in round 2 is a case the lane overcame: it is recorded as solved.
    const c = laneCases([e('order_start', 2, {}, { order: 'ord-0001' }), e('chaos', 2, { fault: 'endpoint_down' }, { stage: 'payment' }), ...r2.msgs.filter((m) => m.type !== 'order_start'), e('order_done', 2)], 2, 2)[0]!;
    expect(c).toMatchObject({ outcome: 'solved', mechanism: 'retry_backoff', consequence: 'recovered' });
  });

  it('only for a tier that supports the action: the Rookie has no retry part, so the same overlay changes nothing', async () => {
    const policy: Policy = { version: 1, rules: [{ stage: 'payment', fault: 'endpoint_down', action: 'retry_backoff', backoff: 'exp', maxAttempts: 5 }] };
    const rookie = new World(); rookie.fault({ forMs: 3000 });
    expect(await rookie.run('rookie', policy)).toBe('failed');
    const journaler = new World(); journaler.fault({ forMs: 3000 });
    expect(await journaler.run('journaler', policy)).toBe('done');
    const without = new World(); without.fault({ forMs: 3000 });
    expect(await without.run('journaler')).toBe('failed');
  });

  it('the overlay is scoped to its stage and fault: another stage keeps the default retry', async () => {
    const policy: Policy = { version: 1, rules: [{ stage: 'confirmation', fault: 'endpoint_down', action: 'retry_backoff', maxAttempts: 5 }] };
    const w = new World(); w.fault({ forMs: 3000 });
    expect(await w.run('retrier', policy)).toBe('failed');
  });
});

describe('lesson events in the mock tournament', () => {
  it('lesson events are valid, follow round_end and only name live lanes', () => {
    const ev = mockTournament({ upTo: 2 });
    expect(validateEvents(ev)).toEqual([]);
    const lessons = ev.filter((x) => x.type === 'lesson');
    expect(lessons.length).toBeGreaterThan(0);
    for (const l of lessons) expect(['overcame', 'suggested']).toContain(l.detail!.via);
    const end = ev.find((x) => x.type === 'round_end')!;
    expect((end.detail!.lessons as unknown[]).length).toBeGreaterThan(0);
    expect(ev.findIndex((x) => x.type === 'lesson')).toBeGreaterThan(ev.findIndex((x) => x.type === 'round_end'));
  });

  it('the validator rejects a lesson with a bad signature or a lane that was not live', () => {
    const ev = mockTournament({ upTo: 2 });
    const run = (mut: (l: typeof ev) => void) => { const c = ev.map((x) => ({ ...x, detail: x.detail ? { ...x.detail } : x.detail })); mut(c); return validateEvents(c as never).map((v) => v.rule); };
    expect(run((l) => { l.find((x) => x.type === 'lesson')!.detail!.signature = 'payment timeout'; })).toContain('R62');
    expect(run((l) => { l.find((x) => x.type === 'lesson')!.detail!.via = 'dreamt'; })).toContain('R62');
  });
});
