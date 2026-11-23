// PT-C9 / TV3: engine properties P9 to P12, P14, P15 (ledger exemption lives in core/test/wrong-order-provider.test.ts), P16 (score.test.ts),
// P18 and P19 (never-perfect.test.ts), with fast-check. P13 is in travel.test.ts. Spec: .kiro/specs/playtest-v2/design.md section 9.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { LapTracker } from '../../core/src/live/lap-tracker';
import { DecisionBroker, type DecisionEvent } from '../src/runner/decisions';
import { StarTracker, ratingFor, review, reviewScore, type ReviewInput } from '../src/score/review';
import { scoreEvents, type HauntEvent } from '../src/score';
import { DECISION_CHOICES } from '../src/shared/catalog';

const LANE = '1';
const ev = (type: string, ts: number, extra: Partial<HauntEvent> = {}): HauntEvent => ({ type, lane: LANE as never, order: 'o1', ts, wave: 1, ...extra } as HauntEvent);

/**
 * One order of one lane: `episodes` of trouble, each a stage_fail at the start of its window with recoveries nested inside it (depth 1 to 3), closed by the
 * stage_done of that stage. The gaps and window lengths are random. Returns the events, the expected union of the windows and the sum of recovery ms.
 */
const episodesArb = fc.array(
  fc.record({ gap: fc.integer({ min: 0, max: 300 }), len: fc.integer({ min: 1, max: 900 }), depth: fc.integer({ min: 1, max: 3 }), actions: fc.array(fc.constantFrom('retry', 'backoff', 'restart', 'reconcile'), { minLength: 3, maxLength: 3 }) }),
  { minLength: 0, maxLength: 6 },
);

function run(episodes: { gap: number; len: number; depth: number; actions: string[] }[]) {
  const t = new LapTracker({ app: 'orders', pace: 1, speed: 1, now: () => 0 });
  const out: HauntEvent[] = [];
  const feed = (e: HauntEvent) => out.push(...t.process(e));
  let now = 1000;
  const start = now;
  feed(ev('order_start', now));
  let windows = 0;
  episodes.forEach((ep, i) => {
    now += ep.gap;
    const stage = i % 2 === 0 ? 'payment' : 'receive';
    feed(ev('stage_start', now, { stage }));
    const t0 = now;
    feed(ev('stage_fail', now, { stage, detail: { attempt: 1 } }));
    // nested recoveries: all open at t0, each closes at a decreasing time, the outermost at t0 + len
    for (let d = 0; d < ep.depth; d++) feed(ev('recover_start', now, { stage, detail: { action: ep.actions[d] } }));
    for (let d = ep.depth; d > 0; d--) {
      const at = t0 + Math.round((ep.len * d) / ep.depth);
      now = Math.max(now, at);
      feed(ev('recover_done', now, { stage, detail: { action: ep.actions[d - 1] } }));
    }
    now = t0 + ep.len;
    feed(ev('stage_done', now, { stage }));
    windows += ep.len;
  });
  now += 50;
  feed(ev('order_done', now, { detail: { clean: true } }));
  return { out, start, end: now, windows };
}

const lapOf = (out: HauntEvent[]) => (out.find((e) => e.type === 'order_done')!.detail as { lap: { ms: number; downtimeMs: number; recoveries: { ms: number }[] } }).lap;

describe('P9 downtime is the union of intervals', () => {
  it('nested and overlapping recoveries never double count: downtimeMs is the sum of the windows, and at most the sum of recovery ms', () => {
    fc.assert(fc.property(episodesArb, (eps) => {
      const { out, windows } = run(eps);
      const lap = lapOf(out);
      expect(lap.downtimeMs).toBe(windows);
      expect(lap.recoveries.reduce((s, r) => s + r.ms, 0)).toBeGreaterThanOrEqual(lap.downtimeMs);
    }), { numRuns: 200 });
  });

  it('overlapping windows of two stages count once', () => {
    const t = new LapTracker({ app: 'orders', pace: 1, speed: 1, now: () => 0 });
    const out: HauntEvent[] = [];
    for (const e of [ev('order_start', 0), ev('stage_fail', 100, { stage: 'payment' }), ev('stage_fail', 300, { stage: 'payment' }), ev('stage_done', 700, { stage: 'payment' }), ev('order_done', 800)]) out.push(...t.process(e));
    expect(lapOf(out).downtimeMs).toBe(600);
  });
});

describe('P10 lap.ms is the timestamp difference', () => {
  it('equals order_done.ts minus order_start.ts', () => {
    fc.assert(fc.property(episodesArb, (eps) => {
      const { out, start, end } = run(eps);
      expect(lapOf(out).ms).toBe(end - start);
    }), { numRuns: 200 });
  });
});

const reviewArb: fc.Arbitrary<ReviewInput> = fc.record({
  lap: fc.record({
    ms: fc.integer({ min: 0, max: 200_000 }), downtimeMs: fc.integer({ min: 0, max: 60_000 }),
    issues: fc.array(fc.record({ stage: fc.constantFrom('account', 'create', 'submit', 'payment', 'confirmation', 'receive', 'process', 'updates', 'ship', 'transit', 'handoff'), count: fc.integer({ min: 1, max: 5 }) }), { maxLength: 6 }),
  }),
  extra: fc.dictionary(fc.constantFrom('charge', 'order', 'store', 'notify', 'dispatch'), fc.integer({ min: 1, max: 3 }), { maxKeys: 3 }),
  degraded: fc.boolean(), gremlin: fc.boolean(), swallowed: fc.boolean(),
  decision: fc.option(fc.record({ choice: fc.constantFrom(...DECISION_CHOICES) }), { nil: undefined }),
  cancelled: fc.boolean(),
  baselineMs: fc.integer({ min: 1000, max: 40_000 }),
  paceFactor: fc.constantFrom(1, 2, 3, 4),
});

describe('P11 review is pure, in half-star steps, and the caps hold', () => {
  it('same input, same result; stars in {1, 1.5, ..., 5}', () => {
    fc.assert(fc.property(reviewArb, (inp) => {
      const a = review(inp);
      expect(review(JSON.parse(JSON.stringify(inp)))).toEqual(a);
      expect(a.stars).toBeGreaterThanOrEqual(1);
      expect(a.stars).toBeLessThanOrEqual(5);
      expect(Number.isInteger(a.stars * 2)).toBe(true);
      expect(a.reasons.length).toBeGreaterThan(0);
    }), { numRuns: 400 });
  });

  it('caps: cancelled is 1; a repeated charge, a refund or a swallowed answer is at most 2; a discount at most 3; a redo at most 4', () => {
    fc.assert(fc.property(reviewArb, (inp) => {
      const s = review(inp).stars;
      if (inp.cancelled) expect(s).toBe(1);
      else {
        if ((inp.extra.charge ?? 0) > 0) expect(s).toBeLessThanOrEqual(2);
        if (inp.swallowed) expect(s).toBeLessThanOrEqual(2);
        if (inp.decision?.choice === 'refund') expect(s).toBeLessThanOrEqual(2);
        if (inp.decision?.choice === 'discount') expect(s).toBeLessThanOrEqual(3);
        if (inp.decision?.choice === 'redo') expect(s).toBeLessThanOrEqual(4);
      }
    }), { numRuns: 400 });
  });

  it('a perfect 5.0 needs a clean lap: no gremlin with slow recovery, no issue, no extra row', () => {
    fc.assert(fc.property(reviewArb, (inp) => {
      if (review(inp).stars !== 5) return;
      expect(inp.cancelled).toBe(false);
      expect(inp.swallowed).toBe(false);
      expect(Object.values(inp.extra).reduce((s, x) => s + x, 0)).toBe(0);
      expect(inp.decision).toBeUndefined();
      expect(inp.lap.issues.reduce((s, x) => s + x.count, 0)).toBe(0);
    }), { numRuns: 600 });
  });
});

describe('P12 the running star total', () => {
  it('cum.stars is the sum of the stars so far and cum.max is 5 times the count', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 2, max: 10 }).map((n) => n / 2), { minLength: 1, maxLength: 30 }), (stars) => {
      const t = new StarTracker();
      let sum = 0;
      stars.forEach((s, i) => {
        sum += s;
        const c = t.add(s);
        expect(c).toEqual({ stars: sum, max: 5 * (i + 1), count: i + 1 });
      });
      expect(t.summary().rating).toBe(ratingFor(sum / stars.length));
    }), { numRuns: 200 });
  });

  it('the LapTracker emits the same running total in its review events', () => {
    fc.assert(fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }), (cancels) => {
      const t = new LapTracker({ app: 'orders', pace: 1, speed: 1, now: () => 0 });
      const reviews: { stars: number; cum: { stars: number; max: number } }[] = [];
      cancels.forEach((c, i) => {
        for (const e of [ev('order_start', i * 100, { order: `o${i}` }), ev(c ? 'order_failed' : 'order_done', i * 100 + 50, { order: `o${i}`, detail: { clean: true } })]) {
          for (const o of t.process(e)) if (o.type === 'review') reviews.push(o.detail as never);
        }
      });
      let sum = 0;
      reviews.forEach((r, i) => { sum += r.stars; expect(r.cum.stars).toBe(sum); expect(r.cum.max).toBe(5 * (i + 1)); });
      expect(reviewScore(5)).toBe(80);
    }), { numRuns: 100 });
  });
});

describe('P14 scoring replay', () => {
  const kinds = ['order_start', 'order_done', 'order_failed', 'chaos', 'repeat', 'order_parked', 'order_resumed', 'order_quarantined', 'order_abandoned', 'lane_halted', 'stage_fail', 'stage_done', 'decision_made'] as const;
  const eventArb = fc.record({ type: fc.constantFrom(...kinds), gap: fc.integer({ min: 0, max: 2000 }), n: fc.integer({ min: 1, max: 3 }) });
  it('the sum of all score.delta of a lane equals the last score.total', () => {
    fc.assert(fc.property(fc.array(eventArb, { minLength: 1, maxLength: 40 }), (xs) => {
      let ts = 0;
      const evs: HauntEvent[] = xs.map((x, i) => {
        ts += x.gap;
        const detail: Record<string, unknown> =
          x.type === 'chaos' ? { depth: x.n }
          : x.type === 'repeat' ? { kind: 'charge', key: `k${i}`, count: 2 }
          : x.type === 'order_done' ? { clean: x.n === 1, ms: 5000 + x.gap, lap: { ms: 5000 + x.gap } }
          : x.type === 'decision_made' ? { order: 'o1', choice: DECISION_CHOICES[x.n - 1] }
          : {};
        return ev(x.type, ts, { detail } as never);
      });
      const run = scoreEvents(evs);
      const scores = run.events.filter((e) => e.type === 'score' && String(e.lane) === LANE);
      const sum = scores.reduce((s, e) => s + Number((e.detail as { delta: number }).delta), 0);
      const last = scores.length ? Number((scores[scores.length - 1]!.detail as { total: number }).total) : 0;
      expect(sum).toBe(last);
      expect(run.totals[LANE] ?? 0).toBe(last);
    }), { numRuns: 200 });
  });
});

describe('P18 a decision is made exactly once', () => {
  it('any mix of asks, restarts that ask again, user answers and timeouts gives one decision_needed and one decision_made per order', async () => {
    await fc.assert(fc.asyncProperty(
      fc.record({ asks: fc.integer({ min: 1, max: 5 }), answer: fc.option(fc.constantFrom(...DECISION_CHOICES), { nil: undefined }), alive: fc.array(fc.boolean(), { minLength: 5, maxLength: 5 }) }),
      async ({ asks, answer, alive }) => {
        const emitted: DecisionEvent[] = [];
        let fire: (() => void) | null = null;
        const broker = new DecisionBroker({ emit: (_l, e) => { emitted.push(e); }, timeoutMs: () => 10_000, setTimer: (fn) => { fire = fn; return 1; }, clearTimer: () => { fire = null; } });
        const answers: Promise<unknown>[] = [];
        for (let i = 0; i < asks; i++) {
          answers.push(broker.ask('1', { order: 'o1', detectedAt: 'handoff', defaultChoice: 'redo' }, () => alive[i]!));
        }
        // The bot restarted `asks - 1` times while the decision was open; now the user answers, or the timer runs out.
        if (answer) expect(broker.answer('1', 'o1', answer)).toBe('ok');
        else (fire as (() => void) | null)?.();
        const got = await Promise.all(answers) as { choice: string }[];
        expect(emitted.filter((e) => e.type === 'decision_needed')).toHaveLength(1);
        expect(emitted.filter((e) => e.type === 'decision_made')).toHaveLength(1);
        expect(new Set(got.map((g) => g.choice)).size).toBe(1);
      },
    ), { numRuns: 100 });
  });
});
