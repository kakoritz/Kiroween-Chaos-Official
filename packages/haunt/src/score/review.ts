// Reviews and stars (playtest-v2 design section 6, contract/V1_1.md section 4). Pure and deterministic.

import { vocabOf } from '../shared/catalog';

export const RATINGS = ['Five-Star Crypt', 'Respectable', 'Spooky Service', 'Cursed'] as const;
export type Rating = (typeof RATINGS)[number];

/** Per-lane rating from the average stars (contract section 6). */
export const ratingFor = (avg: number): Rating => (avg >= 4.5 ? RATINGS[0] : avg >= 3.5 ? RATINGS[1] : avg >= 2.5 ? RATINGS[2] : RATINGS[3]);

export interface ReviewLap {
  ms: number;
  /** Real ms of downtime; normalised here with `paceFactor`. */
  downtimeMs: number;
  issues: { stage: string; count: number }[];
}

export interface ReviewInput {
  lap: ReviewLap;
  /** Ledger extra rows of the order by kind (charge, update, ...). */
  extra: Record<string, number>;
  degraded: boolean;
  /** A gremlin hit this order (spec 5.3). With a slow recovery the review cannot be 5.0. */
  gremlin?: boolean;
  /** A cursed answer was swallowed (the step was skipped silently): the worst reaction, a big penalty. */
  swallowed?: boolean;
  decision?: { choice: string; detectedAt?: string };
  cancelled: boolean;
  baselineMs: number;
  /** Speed times pace, so pace and speed never change a score. Default 1. */
  paceFactor?: number;
  /** App whose wording and double-effect kind apply. Default orders. */
  app?: string;
}

export interface ReviewSub {
  timeliness: number;
  delays: number;
  issues: number;
  delivery: number;
  ease: number;
}

export interface ReviewResult {
  stars: number;
  sub: ReviewSub;
  reasons: string[];
  text: string;
}

const SUBS = ['timeliness', 'delays', 'issues', 'delivery', 'ease'] as const;

export function review(inp: ReviewInput): ReviewResult {
  const v = vocabOf(inp.app);
  const dup = inp.extra[v.dupKind] ?? 0;
  if (inp.cancelled) {
    return { stars: 1, sub: { timeliness: 1, delays: 1, issues: 1, delivery: 1, ease: 1 }, reasons: [v.never], text: v.never };
  }
  const pace = inp.paceFactor && inp.paceFactor > 0 ? inp.paceFactor : 1;
  const r = inp.lap.ms / inp.baselineMs;
  const timeliness = r <= 1.25 ? 5 : r <= 1.6 ? 4 : r <= 2.2 ? 3 : r <= 3.0 ? 2 : 1;
  const d = inp.lap.downtimeMs / pace / 1000;
  const delays = d === 0 ? 5 : d <= 2 ? 4 : d <= 5 ? 3 : d <= 10 ? 2 : 1;
  const n = inp.lap.issues.reduce((s, x) => s + x.count, 0);
  const issues = n === 0 ? 5 : n === 1 ? 4 : n === 2 ? 3 : n <= 4 ? 2 : 1;
  const extraRows = Object.values(inp.extra).reduce((s, x) => s + x, 0);
  const choice = inp.decision?.choice;
  let delivery = 5;
  if (extraRows >= 2) delivery = Math.min(delivery, 1);
  else if (extraRows === 1 || inp.degraded) delivery = Math.min(delivery, 3);
  if (inp.swallowed) delivery = Math.min(delivery, 1);
  if (choice === 'discount') delivery = Math.min(delivery, 2);
  if (choice === 'redo') delivery = Math.min(delivery, 4);
  const front = inp.lap.issues.filter((x) => x.stage === 'create' || x.stage === 'confirmation').reduce((s, x) => s + x.count, 0);
  let ease = front === 0 ? 5 : front === 1 ? 4 : 3;
  if (choice === 'redo') ease = Math.min(ease, 2);
  if (choice === 'refund') ease = Math.min(ease, 1);
  const sub: ReviewSub = { timeliness, delays, issues, delivery, ease };
  let stars = Math.round(((timeliness + delays + issues + delivery + ease) / 5) * 2) / 2;
  if (dup > 0) stars = Math.min(stars, 2);
  if (choice === 'refund') stars = Math.min(stars, 2);
  if (choice === 'discount') stars = Math.min(stars, 3);
  if (choice === 'redo') stars = Math.min(stars, 4);
  // Never perfect (spec 5.3): a gremlin plus a slow recovery (over a second of normalised downtime) cannot give 5.0. A fast clean recovery can.
  if (inp.gremlin && d > 1) stars = Math.min(stars, 4.5);
  // Swallowed errors (spec 5.2): the customer never got a step and nobody was told. At most two stars, whatever else was good.
  if (inp.swallowed) stars = Math.min(stars, 2);
  stars = Math.max(1, stars);
  const lowDelivery = dup > 0 ? v.dupReason : choice === 'discount' ? v.wrong : inp.degraded ? 'Missing updates' : v.low.delivery;
  let reasons = SUBS.filter((k) => sub[k] <= 3).map((k) => (k === 'delivery' ? lowDelivery : v.low[k])).slice(0, 2);
  if (reasons.length === 0) {
    reasons = SUBS.map((k, i) => ({ k, i, v: sub[k] }))
      .sort((a, b) => b.v - a.v || a.i - b.i)
      .slice(0, 2)
      .sort((a, b) => a.i - b.i)
      .map((x) => v.high[x.k]);
  }
  return { stars, sub, reasons, text: reasons.join(' \u00b7 ') };
}

export interface ReviewCum {
  stars: number;
  max: number;
  count: number;
}

/** Per-lane running total for the `cum` field and the wave rating. */
export class StarTracker {
  private sum = 0;
  private count = 0;
  add(stars: number): ReviewCum {
    this.sum += stars;
    this.count++;
    return this.cum();
  }
  cum(): ReviewCum {
    return { stars: this.sum, max: 5 * this.count, count: this.count };
  }
  summary(): { sum: number; max: number; count: number; avg: number; rating: Rating } {
    const avg = this.count ? this.sum / this.count : 0;
    return { sum: this.sum, max: 5 * this.count, count: this.count, avg, rating: ratingFor(avg) };
  }
}

/** Score delta of a review: (stars - 3) x 40. */
export const reviewScore = (stars: number): number => (stars - 3) * 40;
