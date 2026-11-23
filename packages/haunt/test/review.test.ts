import { describe, expect, it } from 'vitest';
import { INBOX_SUB_LABELS, StarTracker, ratingFor, review, reviewScore, type ReviewInput } from '../src/score/review';

const base: ReviewInput = { lap: { ms: 10000, downtimeMs: 0, issues: [] }, extra: {}, degraded: false, cancelled: false, baselineMs: 10000 };
const mk = (o: Omit<Partial<ReviewInput>, 'lap'> & { lap?: Partial<ReviewInput['lap']> } = {}): ReviewInput => ({ ...base, ...o, lap: { ...base.lap, ...(o.lap ?? {}) } });

describe('review sub-scores', () => {
  it('perfect order is 5 stars', () => {
    const r = review(base);
    expect(r.sub).toEqual({ timeliness: 5, delays: 5, issues: 5, delivery: 5, ease: 5 });
    expect(r.stars).toBe(5);
    expect(r.reasons).toEqual(['Lightning fast', 'No waiting around']);
  });
  it.each([[1.25, 5], [1.26, 4], [1.6, 4], [1.61, 3], [2.2, 3], [2.21, 2], [3.0, 2], [3.01, 1]])('timeliness r=%s is %s', (r, s) => {
    expect(review(mk({ lap: { ms: r * 10000 } })).sub.timeliness).toBe(s);
  });
  it.each([[0, 5], [1, 4], [2, 4], [3, 3], [5, 3], [6, 2], [10, 2], [11, 1]])('delays %s s is %s', (sec, s) => {
    expect(review(mk({ lap: { downtimeMs: sec * 1000 } })).sub.delays).toBe(s);
  });
  it('delays are normalised by pace', () => {
    expect(review(mk({ lap: { downtimeMs: 20000 }, paceFactor: 10 })).sub.delays).toBe(4);
  });
  it.each([[0, 5], [1, 4], [2, 3], [3, 2], [4, 2], [5, 1], [9, 1]])('issues n=%s is %s', (n, s) => {
    const issues = n ? [{ stage: 'charge', count: n }] : [];
    expect(review(mk({ lap: { issues } })).sub.issues).toBe(s);
  });
  it('delivery: extra rows, degraded, discount, redo', () => {
    expect(review(mk({ extra: { update: 1 } })).sub.delivery).toBe(3);
    expect(review(mk({ extra: { charge: 1, update: 1 } })).sub.delivery).toBe(1);
    expect(review(mk({ degraded: true })).sub.delivery).toBe(3);
    expect(review(mk({ decision: { choice: 'discount' } })).sub.delivery).toBe(2);
    expect(review(mk({ decision: { choice: 'redo' } })).sub.delivery).toBe(4);
  });
  it('ease counts create and confirmation issues, typo decisions lower it', () => {
    const at = (stage: string, count: number) => review(mk({ lap: { issues: [{ stage, count }] } })).sub.ease;
    expect(at('create', 1)).toBe(4);
    expect(at('confirmation', 2)).toBe(3);
    expect(at('charge', 3)).toBe(5);
    expect(review(mk({ decision: { choice: 'redo' } })).sub.ease).toBe(2);
    expect(review(mk({ decision: { choice: 'refund' } })).sub.ease).toBe(1);
  });
});

describe('review stars, caps and reasons', () => {
  it('stars are in 0.5 steps from 1 to 5', () => {
    for (const ms of [8000, 14000, 20000, 28000, 40000]) {
      for (const dt of [0, 3000, 8000, 20000]) {
        const s = review(mk({ lap: { ms, downtimeMs: dt, issues: [{ stage: 'create', count: 2 }] } })).stars;
        expect(s * 2).toBe(Math.round(s * 2));
        expect(s).toBeGreaterThanOrEqual(1);
        expect(s).toBeLessThanOrEqual(5);
      }
    }
  });
  it('is deterministic', () => {
    const i = mk({ lap: { ms: 17000, downtimeMs: 4000, issues: [{ stage: 'create', count: 1 }] } });
    expect(review(i)).toEqual(review(i));
  });
  it('caps: charge 2, refund 2, discount 3, redo 4', () => {
    expect(review(mk({ extra: { charge: 1 } })).stars).toBeLessThanOrEqual(2);
    expect(review(mk({ decision: { choice: 'refund' } })).stars).toBeLessThanOrEqual(2);
    expect(review(mk({ decision: { choice: 'discount' } })).stars).toBeLessThanOrEqual(3);
    expect(review(mk({ decision: { choice: 'redo' } })).stars).toBeLessThanOrEqual(4);
  });
  it('cancelled is exactly 1 star, Never arrived', () => {
    const r = review(mk({ cancelled: true }));
    expect(r.stars).toBe(1);
    expect(r.sub).toEqual({ timeliness: 1, delays: 1, issues: 1, delivery: 1, ease: 1 });
    expect(r.text).toBe('Never arrived');
  });
  it('keeps the first two low reasons in order, with delivery phrases', () => {
    const r = review(mk({ lap: { ms: 30000, downtimeMs: 12000, issues: [{ stage: 'charge', count: 6 }] }, extra: { charge: 1 } }));
    expect(r.reasons).toEqual(['Took forever to arrive', 'Kept me waiting']);
    expect(r.text).toBe('Took forever to arrive \u00b7 Kept me waiting');
    expect(review(mk({ extra: { charge: 1 } })).reasons).toEqual(['Charged twice!']);
    expect(review(mk({ degraded: true })).reasons).toEqual(['Missing updates']);
    expect(review(mk({ decision: { choice: 'discount' } })).reasons[0]).toBe('Wrong order');
  });
});

describe('star tracker, rating and score', () => {
  it('cum follows the contract: 5/5, 6/10, 8/15', () => {
    const t = new StarTracker();
    expect(t.add(5)).toEqual({ stars: 5, max: 5, count: 1 });
    expect(t.add(1)).toEqual({ stars: 6, max: 10, count: 2 });
    expect(t.add(2)).toEqual({ stars: 8, max: 15, count: 3 });
    expect(t.summary().rating).toBe(ratingFor(8 / 3));
  });
  it.each([[5, 'Five-Star Crypt'], [4.5, 'Five-Star Crypt'], [4.4, 'Respectable'], [3.5, 'Respectable'], [3.4, 'Spooky Service'], [2.5, 'Spooky Service'], [2.4, 'Cursed'], [1, 'Cursed']])('avg %s is %s', (a, r) => {
    expect(ratingFor(a)).toBe(r);
  });
  it('score is (stars - 3) x 40', () => {
    expect(reviewScore(5)).toBe(80);
    expect(reviewScore(1)).toBe(-80);
    expect(reviewScore(3)).toBe(0);
  });
});

describe('Ticket Desk CSAT review', () => {
  const lap = { ms: 8000, downtimeMs: 0, issues: [] };
  const desk = { firstResponseMs: 2000, resolveMs: 6000, reassignments: 0, slaBreached: false };
  const inbox = (d: Partial<typeof desk>, extra: Record<string, number> = {}, cancelled = false) =>
    review({ ...base, lap, extra, cancelled, inbox: true, desk: { ...desk, ...d } });

  it('a fast, clean ticket is five stars, with the requester praising the first reply and the SLA', () => {
    const r = inbox({});
    expect(r.stars).toBe(5);
    expect(r.sub).toEqual({ timeliness: 5, delays: 5, issues: 5, delivery: 5, ease: 5 });
    expect(r.text).toMatch(/^“.+”$/);
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it('a breached SLA caps the stars at 3 and the text says so', () => {
    const r = inbox({ slaBreached: true });
    expect(r.stars).toBeLessThanOrEqual(3);
    expect(r.sub.delivery).toBe(2);
    expect(r.reasons).toContain('Missed the SLA');
    expect(r.text).toContain('deadline');
  });

  it('a ticket passed between queues scores the reassignment slot', () => {
    const r = inbox({ reassignments: 2 });
    expect(r.sub.issues).toBe(2);
    expect(r.reasons).toContain('Passed around');
  });

  it('duplicate notices (extra ledger rows) cap the stars and are named', () => {
    const r = inbox({}, { notify: 2 });
    expect(r.stars).toBeLessThanOrEqual(3);
    expect(r.reasons).toContain('Duplicate notices');
  });

  it('slow first response and slow resolution lose their slots', () => {
    const r = inbox({ firstResponseMs: 13000, resolveMs: 25000 });
    expect(r.sub).toMatchObject({ timeliness: 1, delays: 1 });
    expect(r.stars).toBeLessThanOrEqual(3);
  });

  it('a cancelled ticket is one star in the requester voice, and the slot labels are the desk ones', () => {
    const r = inbox({}, {}, true);
    expect(r.stars).toBe(1);
    expect(r.text).toContain('vanished');
    expect(INBOX_SUB_LABELS).toEqual({ timeliness: 'First response', delays: 'Resolution time', issues: 'Reassignments', delivery: 'SLA', ease: 'Ease' });
  });

  it('the orders review is unchanged when inbox is off', () => {
    expect(review({ ...base, lap, extra: {}, cancelled: false, desk }).sub).toEqual(review({ ...base, lap, extra: {}, cancelled: false }).sub);
  });
});
