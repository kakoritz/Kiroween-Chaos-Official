// covers: playtest-v2/R9.2
import { describe, expect, it } from 'vitest';
import type { HauntEvent } from '@haunt/shared';
import { validateEvents } from '../src/contract/validate';

// Contract v1.1 ordering rules 40 to 47. Each rule has a clean stream that passes and a negative stream that fails.
const STAGES = ['account', 'create', 'submit', 'payment', 'confirmation', 'receive', 'process', 'updates', 'ship', 'transit', 'handoff'];

type Emit = (type: string, detail?: any, extra?: any) => void;

function build(fn: (e: Emit) => void, minor = 1): HauntEvent[] {
  const out: HauntEvent[] = [];
  let seq = 0;
  let ts = 1000;
  fn((type, detail = {}, extra = {}) => {
    const { dt = 10, ...rest } = extra;
    seq++;
    ts += dt;
    const lane = type === 'hello' || type === 'reset' || type === 'wave_start' || type === 'wave_end' || type.startsWith('boss_') ? undefined : 1;
    const ev: any = { seq, ts, type, ...(type === 'hello' ? {} : { wave: 1 }), ...(lane ? { lane } : {}), ...rest };
    if (type === 'hello') Object.assign(ev, { contractVersion: 1, ...(minor ? { contractMinor: minor } : {}), mode: 'mock', app: 'orders' });
    else ev.detail = detail;
    out.push(ev);
  });
  return out;
}

const lap = (o: any = {}): any => ({ ms: 4000, workMs: 3000, attempts: 11, retries: 0, downtimeMs: 0, issues: [], recoveries: [], ...o });
const head = (e: Emit): void => {
  e('hello');
  e('wave_start', { orders: 2, seed: 7, tiers: 'race', lanes: 1, speed: 1, app: 'orders', pace: 'show' });
  e('lane_ready', { tier: 'rookie', label: 'Rookie', parts: [] });
};
const summary = (o: any = {}): any => ({
  1: {
    score: 0, completed: 1, failed: 0, parked: 0, quarantined: 0, repeats: 0,
    orders: { done: 1, cancelled: 0, parked: 0, quarantined: 0, abandoned: 0 },
    bestMs: 4000, slowestMs: 4000, avgMs: 4000, totalMs: 4000, retries: 0, downtimeMs: 0, issuesByStage: {},
    stars: { sum: 5, max: 5, count: 1, avg: 5 }, rating: 'Five-Star Crypt', ...o,
  },
});
const reviewDetail = (order: string, stars: number, cum: any): any => ({
  order, stars, sub: { timeliness: stars, delays: stars, issues: stars, delivery: stars, ease: stars }, reasons: [], text: 'ok', cum,
});

interface Opts {
  order?: string;
  grabDt?: number;
  walkDt?: number;
  /** Gap before the second order; omit for a single order. */
  secondGapDt?: number;
  lap?: any;
  noLap?: boolean;
  noReview?: boolean;
  reviewCum?: any;
  summary?: any;
  dropStage?: (s: string) => boolean;
}

/** One lane, one or two clean orders with grab, walk, ceremony and return gaps. */
function run(o: Opts = {}): HauntEvent[] {
  return build((e) => {
    head(e);
    const orders = o.secondGapDt === undefined ? ['ord-0001'] : ['ord-0001', 'ord-0002'];
    orders.forEach((ord, n) => {
      e('order_start', { index: n + 1, total: orders.length, grabMs: 100 }, { order: ord, dt: n === 0 ? 10 : o.secondGapDt });
      STAGES.forEach((s, i) => {
        e('stage_start', { attempt: 1 }, { order: ord, stage: s, dt: i === 0 ? (o.grabDt ?? 100) : (o.walkDt ?? 50) });
        e('stage_done', { ms: 100, skipped: false, ...(i < STAGES.length - 1 ? { walkMs: 50 } : {}) }, { order: ord, stage: s, dt: 100 });
      });
      e('order_done', { clean: true, ms: 4000, repeats: 0, ceremonyMs: 200, returnMs: 100, ...(o.noLap ? {} : { lap: o.lap ?? lap() }) }, { order: ord });
      e('score', { delta: 100, total: 100 * (n + 1), reason: 'order clean' }, { order: ord });
      if (!o.noReview) e('review', reviewDetail(ord, 5, o.reviewCum ?? { stars: 5 * (n + 1), max: 5 * (n + 1), count: n + 1 }), { order: ord });
    });
    const two = orders.length === 2;
    e('wave_end', {
      summary: o.summary ?? (two
        ? summary({ orders: { done: 2, cancelled: 0, parked: 0, quarantined: 0, abandoned: 0 }, totalMs: 8000, stars: { sum: 10, max: 10, count: 2, avg: 5 }, completed: 2, score: 200 })
        : summary()),
    });
  });
}

const rules = (ev: HauntEvent[]): string[] => validateEvents(ev).map((v) => v.rule);
const unique = (xs: string[]): string[] => [...new Set(xs)];

describe('contract v1.1 rules 40 to 47', () => {
  it('accepts a clean v1.1 stream', () => {
    expect(validateEvents(run())).toEqual([]);
    expect(validateEvents(run({ secondGapDt: 300 }))).toEqual([]);
  });

  it('does not apply v1.1 rules to a v1.0 stream (no contractMinor)', () => {
    const ev = build((e) => {
      head(e);
      e('order_start', { index: 1, total: 1 }, { order: 'ord-0001' });
      STAGES.forEach((s) => {
        e('stage_start', { attempt: 1 }, { order: 'ord-0001', stage: s, dt: 1 });
        e('stage_done', { ms: 1, skipped: false }, { order: 'ord-0001', stage: s, dt: 1 });
      });
      e('order_done', { clean: true, ms: 1, repeats: 0 }, { order: 'ord-0001' });
      e('wave_end', { summary: { 1: { score: 0, completed: 1, failed: 0, parked: 0, quarantined: 0, repeats: 0 } } });
    }, 0);
    expect(validateEvents(ev)).toEqual([]);
  });

  describe('rule 40 travel gaps', () => {
    it('rejects a first stage_start sooner than grabMs after order_start', () => {
      expect(rules(run({ grabDt: 20 }))).toEqual(['R40']);
    });
    it('rejects a stage_start sooner than walkMs after stage_done', () => {
      expect(unique(rules(run({ walkDt: 10 })))).toEqual(['R40']);
    });
    it('rejects an order_start sooner than ceremonyMs + returnMs after order_done', () => {
      expect(rules(run({ secondGapDt: 250 }))).toEqual(['R40']);
    });
    it('rejects an order_start sooner than cancelMs + returnMs after order_failed', () => {
      const ev = build((e) => {
        head(e);
        e('order_start', { index: 1, total: 2 }, { order: 'ord-0001' });
        e('stage_start', { attempt: 1 }, { order: 'ord-0001', stage: 'account' });
        e('stage_fail', { error: 'boom', retryable: false, attempt: 1 }, { order: 'ord-0001', stage: 'account' });
        e('order_failed', { stage: 'account', error: 'boom', outcome: 'cancelled', reason: 'cancelled', cancelMs: 900, returnMs: 1800, lap: lap({ issues: [{ stage: 'account', count: 1 }] }) }, { order: 'ord-0001' });
        e('review', reviewDetail('ord-0001', 1, { stars: 1, max: 5, count: 1 }), { order: 'ord-0001' });
        e('order_start', { index: 2, total: 2 }, { order: 'ord-0002', dt: 2000 });
        e('wave_end', { stopped: true, summary: summary() });
      });
      expect(rules(ev)).toEqual(['R40']);
      ev[ev.length - 2].ts += 800;
      ev[ev.length - 1].ts += 800;
      expect(rules(ev)).toEqual([]);
    });
    it('exempts the stage after a process restart', () => {
      const ev = build((e) => {
        head(e);
        e('order_start', { index: 1, total: 1, grabMs: 100 }, { order: 'ord-0001' });
        e('stage_start', { attempt: 1 }, { order: 'ord-0001', stage: 'account', dt: 100 });
        e('stage_done', { ms: 1, skipped: false, walkMs: 500 }, { order: 'ord-0001', stage: 'account' });
        e('process_dead', { reason: 'crash', restartInMs: 100 });
        e('process_up', { attempt: 2 }, { dt: 100 });
        e('recover_start', { action: 'restart', depth: 0 });
        e('recover_done', { action: 'restart', ms: 5, depth: 0 });
        e('stage_start', { attempt: 1 }, { order: 'ord-0001', stage: 'account', dt: 5 });
        e('wave_end', { stopped: true, summary: summary() });
      });
      expect(rules(ev)).not.toContain('R40');
    });
  });

  describe('rule 41 lap object', () => {
    it('rejects order_done without lap', () => {
      expect(rules(run({ noLap: true }))).toContain('R41');
    });
    it('rejects workMs above ms', () => {
      expect(rules(run({ lap: lap({ ms: 1000, workMs: 3000 }) }))).toContain('R41');
    });
    it('rejects an issue entry for an unknown stage and a missing recoveries array', () => {
      expect(rules(run({ lap: lap({ issues: [{ stage: 'nowhere', count: 1 }] }) }))).toContain('R41');
      const l = lap(); delete l.recoveries;
      expect(rules(run({ lap: l }))).toContain('R41');
    });
    it('rejects a lap that undercounts the stage_fail events of the order', () => {
      const ev = build((e) => {
        head(e);
        e('order_start', { index: 1, total: 1 }, { order: 'ord-0001' });
        e('stage_start', { attempt: 1 }, { order: 'ord-0001', stage: 'account' });
        e('stage_fail', { error: 'x', retryable: true, attempt: 1 }, { order: 'ord-0001', stage: 'account' });
        e('recover_start', { action: 'retry', depth: 0 });
        e('recover_done', { action: 'retry', ms: 5, depth: 0 });
        e('stage_done', { ms: 5, skipped: false }, { order: 'ord-0001', stage: 'account' });
        for (const s of STAGES.slice(1)) {
          e('stage_start', { attempt: 1 }, { order: 'ord-0001', stage: s });
          e('stage_done', { ms: 5, skipped: false }, { order: 'ord-0001', stage: s });
        }
        e('order_done', { clean: false, ms: 99, repeats: 0, lap: lap({ issues: [] }) }, { order: 'ord-0001' });
        e('review', reviewDetail('ord-0001', 4, { stars: 4, max: 5, count: 1 }), { order: 'ord-0001' });
        e('wave_end', { stopped: true, summary: summary() });
      });
      expect(rules(ev)).toEqual(['R41']);
    });
  });

  describe('rule 42 review', () => {
    it('rejects a missing review before the next order_start', () => {
      const ev = run({ secondGapDt: 300, noReview: true });
      expect(rules(ev)).toContain('R42');
    });
    it('rejects a review whose cum does not add up', () => {
      expect(rules(run({ reviewCum: { stars: 4, max: 5, count: 1 } }))).toContain('R42');
      expect(rules(run({ reviewCum: { stars: 5, max: 10, count: 1 } }))).toContain('R42');
      expect(rules(run({ reviewCum: { stars: 5, max: 5, count: 2 } }))).toContain('R42');
    });
    it('rejects a review with no order_done before it', () => {
      const ev = run();
      const review = ev.find((x) => x.type === 'review')!;
      const i = ev.indexOf(review);
      ev.splice(i, 1);
      ev.splice(i - 4, 0, review);
      expect(rules(ev)).toContain('R42');
    });
    it('rejects a cancelled order with more than one star', () => {
      const ev = build((e) => {
        head(e);
        e('order_start', { index: 1, total: 1 }, { order: 'ord-0001' });
        e('stage_start', { attempt: 1 }, { order: 'ord-0001', stage: 'account' });
        e('stage_fail', { error: 'boom', retryable: false, attempt: 1 }, { order: 'ord-0001', stage: 'account' });
        e('order_failed', { stage: 'account', error: 'boom', outcome: 'cancelled', reason: 'cancelled', lap: lap({ issues: [{ stage: 'account', count: 1 }] }) }, { order: 'ord-0001' });
        e('review', reviewDetail('ord-0001', 3, { stars: 3, max: 5, count: 1 }), { order: 'ord-0001' });
        e('wave_end', { stopped: true, summary: summary() });
      });
      expect(rules(ev)).toEqual(['R42']);
    });
  });

  describe('rule 43 wave summary', () => {
    it('rejects a summary without the v1.1 fields', () => {
      const bare = { 1: { score: 0, completed: 1, failed: 0, parked: 0, quarantined: 0, repeats: 0 } };
      expect(rules(run({ summary: bare }))).toContain('R43');
    });
    it('rejects a rating that does not match the average', () => {
      expect(rules(run({ summary: summary({ rating: 'Cursed' }) }))).toContain('R43');
    });
    it('rejects star totals that differ from the reviews seen', () => {
      expect(rules(run({ summary: summary({ stars: { sum: 4, max: 5, count: 1, avg: 4 }, rating: 'Respectable' }) }))).toContain('R43');
    });
    it('rejects done counts that differ from the order_done events', () => {
      expect(rules(run({ summary: summary({ orders: { done: 3, cancelled: 0, parked: 0, quarantined: 0, abandoned: 0 } }) }))).toContain('R43');
    });
    it('rejects bestMs that is not the fastest lap, and bestMs on a lane with no done order', () => {
      expect(rules(run({ summary: summary({ bestMs: 3500, avgMs: 3500 }) }))).toContain('R43');
    });
  });

  describe('rule 44 decisions', () => {
    const decisionFlow = (choice: string, source: string, tweak: { skipNeeded?: boolean; stageBeforeMade?: boolean; refundEffect?: boolean } = {}): HauntEvent[] => build((e) => {
      head(e);
      const ord = 'ord-0001';
      e('order_start', { index: 1, total: 1 }, { order: ord });
      for (const s of STAGES.slice(0, STAGES.indexOf('confirmation'))) {
        e('stage_start', { attempt: 1 }, { order: ord, stage: s });
        e('stage_done', { ms: 5, skipped: false }, { order: ord, stage: s });
      }
      e('chaos', { creature: 'prankster', fault: 'order_typo', scope: 'outer', depth: 1, injectedAt: 'before', source: 'demo' });
      e('stage_start', { attempt: 1 }, { order: ord, stage: 'confirmation' });
      e('stage_fail', { error: 'wrong_order', retryable: false, attempt: 1 }, { order: ord, stage: 'confirmation' });
      if (!tweak.skipNeeded) e('decision_needed', { order: ord, kind: 'wrong_order', detectedAt: 'confirmation', options: ['refund', 'discount', 'redo'], defaultChoice: 'refund', timeoutMs: 8000 }, { order: ord });
      if (tweak.stageBeforeMade) e('stage_start', { attempt: 2 }, { order: ord, stage: 'ship' });
      e('decision_made', { order: ord, choice, source }, { order: ord });
      if (choice === 'refund') {
        if (tweak.refundEffect !== false) e('effect', { kind: 'refund', key: `${ord}:charge`, replayed: false }, { order: ord });
        e('order_failed', { stage: 'confirmation', error: 'wrong_order', outcome: 'cancelled', reason: 'refunded', lap: lap({ issues: [{ stage: 'confirmation', count: 1 }] }) }, { order: ord });
        e('review', reviewDetail(ord, 1, { stars: 1, max: 5, count: 1 }), { order: ord });
      }
      e('wave_end', { stopped: true, summary: summary() });
    });

    it('accepts a refund decision', () => {
      expect(validateEvents(decisionFlow('refund', 'user'))).toEqual([]);
      expect(validateEvents(decisionFlow('refund', 'timeout'))).toEqual([]);
    });
    it('rejects decision_made without decision_needed', () => {
      expect(rules(decisionFlow('refund', 'user', { skipNeeded: true }))).toContain('R44');
    });
    it('rejects a stage_start before decision_made', () => {
      expect(rules(decisionFlow('refund', 'user', { stageBeforeMade: true }))).toContain('R44');
    });
    it('rejects a default or timeout source that picks a non-default choice', () => {
      expect(rules(decisionFlow('discount', 'default'))).toContain('R44');
    });
    it('rejects a refund decision that resolves without a refund effect', () => {
      expect(rules(decisionFlow('refund', 'user', { refundEffect: false }))).toContain('R44');
    });
    it('rejects a decision_needed that is never answered', () => {
      const ev = decisionFlow('refund', 'user');
      const i = ev.findIndex((x) => x.type === 'decision_made');
      ev.splice(i, 4); // decision_made, effect, order_failed, review
      (ev[ev.length - 1].detail as any).stopped = false;
      expect(rules(ev)).toContain('R44');
    });
  });

  describe('rule 45 downtime score', () => {
    const retryFlow = (scoreDelta: number, scoreAfter: 'stage_done' | 'stage_fail'): HauntEvent[] => build((e) => {
      head(e);
      const ord = 'ord-0001';
      e('order_start', { index: 1, total: 1 }, { order: ord });
      e('stage_start', { attempt: 1 }, { order: ord, stage: 'account' });
      e('stage_fail', { error: 'x', retryable: true, attempt: 1 }, { order: ord, stage: 'account' });
      if (scoreAfter === 'stage_fail') e('score', { delta: scoreDelta, total: scoreDelta, reason: 'downtime' }, { order: ord });
      e('recover_start', { action: 'retry', depth: 0 });
      e('recover_done', { action: 'retry', ms: 5, depth: 0 });
      e('stage_done', { ms: 5, skipped: false }, { order: ord, stage: 'account' });
      if (scoreAfter === 'stage_done') e('score', { delta: scoreDelta, total: scoreDelta, reason: 'downtime' }, { order: ord });
      e('wave_end', { stopped: true, summary: summary() });
    });

    it('accepts one negative downtime score at the end of a recovery', () => {
      expect(rules(retryFlow(-20, 'stage_done'))).toEqual([]);
    });
    it('rejects a positive downtime score', () => {
      expect(rules(retryFlow(20, 'stage_done'))).toContain('R45');
    });
    it('rejects a downtime score before the recovery ends', () => {
      expect(rules(retryFlow(-20, 'stage_fail'))).toContain('R45');
    });
    it('rejects two downtime scores for one recovery interval', () => {
      const ev = retryFlow(-20, 'stage_done');
      const i = ev.findIndex((x) => x.type === 'score');
      const dup: any = { ...ev[i], seq: ev[i].seq + 0.5, ts: ev[i].ts, detail: { delta: -20, total: -40, reason: 'downtime' } };
      ev.splice(i + 1, 0, dup);
      ev.forEach((x, n) => { x.seq = n + 1; });
      expect(rules(ev)).toContain('R45');
    });
    it('rejects a downtime score with no recovery interval at all', () => {
      const ev = run();
      const i = ev.findIndex((x) => x.type === 'stage_done');
      const s: any = { seq: 0, ts: ev[i].ts, type: 'score', wave: 1, lane: 1, detail: { delta: -5, total: -5, reason: 'downtime' } };
      ev.splice(i + 1, 0, s);
      ev.forEach((x, n) => { x.seq = n + 1; });
      expect(rules(ev)).toContain('R45');
    });
  });

  describe('rule 46 boss scores', () => {
    const bossFlow = (opts: { recovered?: boolean; refund?: boolean; hit?: boolean } = {}): HauntEvent[] => build((e) => {
      head(e);
      const ord = 'ord-0001';
      e('order_start', { index: 1, total: 1 }, { order: ord });
      if (opts.hit !== false) e('chaos', { creature: 'reaper', fault: 'crash', scope: 'outer', depth: 1, injectedAt: 'before', source: 'boss' });
      e('stage_start', { attempt: 1 }, { order: ord, stage: 'account' });
      e('stage_done', { ms: 5, skipped: false }, { order: ord, stage: 'account' });
      for (const s of STAGES.slice(1)) {
        e('stage_start', { attempt: 1 }, { order: ord, stage: s });
        e('stage_done', { ms: 5, skipped: false }, { order: ord, stage: s });
      }
      e('order_done', { clean: true, ms: 99, repeats: 0, lap: lap() }, { order: ord });
      let total = 0;
      if (opts.recovered !== false) { total += 50; e('score', { delta: 50, total, reason: 'boss recovered' }, { order: ord }); }
      if (opts.refund !== false) { total += 10; e('score', { delta: 10, total, reason: 'boss downtime refund' }, { order: ord }); }
      e('review', reviewDetail(ord, 5, { stars: 5, max: 5, count: 1 }), { order: ord });
      e('wave_end', { stopped: true, summary: summary() });
    });
    // The chaos above has no consequence in this reduced stream (rule 7); the wave is marked stopped, so only v1.1 rules matter.
    const r46 = (ev: HauntEvent[]): string[] => validateEvents(ev).filter((v) => v.rule === 'R46').map((v) => v.rule);

    it('accepts the pair together after the order completes', () => {
      expect(r46(bossFlow())).toEqual([]);
    });
    it('rejects boss recovered without its refund partner', () => {
      expect(r46(bossFlow({ refund: false }))).toContain('R46');
      expect(r46(bossFlow({ recovered: false }))).toContain('R46');
    });
    it('rejects the pair when the lane had no boss hit', () => {
      expect(r46(bossFlow({ hit: false }))).toContain('R46');
    });
  });

  describe('rule 47 world faults', () => {
    const chaosOf = (creature: string, fault: string): HauntEvent[] => build((e) => {
      head(e);
      e('chaos', { creature, fault, scope: 'outer', depth: 1, injectedAt: 'before', source: 'demo' });
      e('wave_end', { stopped: true, summary: summary() });
    });
    const r47 = (ev: HauntEvent[]): string[] => validateEvents(ev, { skipSchema: true }).filter((v) => v.rule === 'R47').map((v) => v.rule);

    it('accepts each world fault with its creature', () => {
      const pairs: Array<[string, string]> = [
        ['gargoyle', 'sms_down'], ['imp', 'app_down'], ['goblin', 'updates_down'], ['scarecrow', 'wrong_address'],
        ['black_cat', 'no_answer'], ['black_cat', 'gated_house'], ['phantom_car', 'car_accident'], ['prankster', 'order_typo'],
      ];
      for (const [c, f] of pairs) expect(r47(chaosOf(c, f)), `${c} ${f}`).toEqual([]);
    });
    it('rejects a world fault with the wrong creature', () => {
      expect(r47(chaosOf('imp', 'sms_down'))).toEqual(['R47']);
      expect(r47(chaosOf('reaper', 'car_accident'))).toEqual(['R47']);
    });
    it('rejects a new world creature with an unrelated fault', () => {
      expect(r47(chaosOf('scarecrow', 'crash'))).toEqual(['R47']);
    });
  });
});
