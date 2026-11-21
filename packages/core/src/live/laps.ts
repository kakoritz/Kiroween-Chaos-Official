// Lap and star queries over the live event log (contract/V1_1.md section 9). Pure functions of the events.
import type { HauntEvent } from '../../../haunt/src/score/score';

const ENDS = new Set(['order_done', 'order_failed']);
const mine = (events: readonly HauntEvent[], lane: number, wave?: number): HauntEvent[] =>
  events.filter((e) => e.lane !== undefined && Number(e.lane) === lane && (wave === undefined || e.wave === wave));

/** `GET /api/lane/:lane/laps`: one row per finished order of the wave. */
export function laneLaps(events: readonly HauntEvent[], lane: number, wave?: number) {
  const evs = mine(events, lane, wave);
  const reviews = new Map<string, unknown>();
  for (const e of evs) if (e.type === 'review' && e.order) reviews.set(e.order, e.detail);
  const out: { order: string; outcome: string; lap: unknown; review: unknown }[] = [];
  for (const e of evs) {
    if (!ENDS.has(e.type) || !e.order) continue;
    out.push({ order: e.order, outcome: e.type === 'order_done' ? 'done' : 'cancelled', lap: (e.detail as any)?.lap ?? null, review: reviews.get(e.order) ?? null });
  }
  return out;
}

const lanesOf = (events: readonly HauntEvent[]): number[] =>
  [...new Set(events.filter((e) => e.lane !== undefined).map((e) => Number(e.lane)))].sort((a, b) => a - b);

/** `GET /api/waves/:n/laps`. `events` are the events of that wave. */
export function waveLaps(events: readonly HauntEvent[], tiers: ReadonlyMap<number, string>) {
  return { lanes: lanesOf(events).map((lane) => ({ lane, tier: tiers.get(lane) ?? `lane-${lane}`, laps: laneLaps(events, lane) })) };
}

/** `GET /api/waves/:n/stars`. */
export function waveStars(events: readonly HauntEvent[]) {
  return {
    lanes: lanesOf(events).map((lane) => ({
      lane,
      series: mine(events, lane).filter((e) => e.type === 'review').map((e) => {
        const d = (e.detail ?? {}) as Record<string, any>;
        return { order: e.order, stars: d.stars, cumStars: d.cum?.stars, cumMax: d.cum?.max };
      }),
    })),
  };
}
