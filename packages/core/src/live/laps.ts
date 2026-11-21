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

const ISSUE_TYPES = new Set(['stage_fail', 'process_dead', 'repeat', 'order_parked']);
const OUTCOMES: Record<string, string> = { order_start: 'active', order_resumed: 'active', order_done: 'done', order_failed: 'failed', order_parked: 'parked', order_quarantined: 'quarantined', order_abandoned: 'abandoned' };

interface StageAcc { stage: string; status: string; attempts: number; retries: number; recoverable: boolean; issues: number; downtimeMs: number; ms: number; recoveries: { startTs: number; endTs: number; ms: number; action: string; depth: number }[]; open?: number; failed: boolean }

/**
 * `GET /api/lane/:lane/order/:order` (contract/V1_1.md section 9): the order record, derived from the events of one
 * lane from the last `order_start` of the order up to its `review`. Returns `undefined` if the order never started.
 * Pure; the mock server uses the same function so the two agree.
 */
export function orderRecord(events: readonly HauntEvent[], lane: number, order: string, wave?: number) {
  const mineEvs = mine(events, lane, wave);
  let from = -1;
  mineEvs.forEach((e, i) => { if (e.type === 'order_start' && e.order === order) from = i; });
  if (from < 0) return undefined;
  const win: HauntEvent[] = [];
  for (let i = from; i < mineEvs.length; i++) {
    const e = mineEvs[i]!;
    if (i > from && e.type === 'order_start') break;
    win.push(e);
    if (e.type === 'review' && e.order === order) break;
  }
  let outcome = 'active';
  for (const e of mineEvs) if (e.order === order && OUTCOMES[e.type]) outcome = OUTCOMES[e.type]!;
  const end = win.find((e) => ENDS.has(e.type));
  const review = win.find((e) => e.type === 'review');
  const stages = new Map<string, StageAcc>();
  const get = (s: string) => {
    let r = stages.get(s);
    if (!r) { r = { stage: s, status: 'pending', attempts: 0, retries: 0, recoverable: false, issues: 0, downtimeMs: 0, ms: 0, recoveries: [], failed: false }; stages.set(s, r); }
    return r;
  };
  let cur: string | undefined;
  const pending: HauntEvent[] = [];
  for (const e of win) {
    const d = (e.detail ?? {}) as Record<string, any>;
    const s = e.stage ?? cur;
    if (e.type === 'stage_start' && e.stage) {
      const r = get(e.stage);
      r.attempts++; r.status = 'running'; r.open = e.ts ?? 0; cur = e.stage;
    } else if ((e.type === 'stage_done' || e.type === 'stage_fail') && e.stage) {
      const r = get(e.stage);
      if (r.open !== undefined) { r.ms += Math.max(0, (e.ts ?? 0) - r.open); r.open = undefined; }
      if (e.type === 'stage_done') { r.status = d.skipped ? 'skipped' : 'done'; if (r.failed) r.recoverable = true; }
      else { r.status = 'failed'; r.failed = true; }
      cur = e.stage;
    }
    if (s && ISSUE_TYPES.has(e.type)) get(s).issues++;
    if (s && e.type === 'breaker' && d.state === 'open') get(s).issues++;
    if (e.type === 'recover_start') pending.push(e);
    if (e.type === 'recover_done') {
      const st = pending.pop();
      const ms = d.ms ?? (st ? (e.ts ?? 0) - (st.ts ?? 0) : 0);
      const action = d.action ?? (st?.detail as any)?.action ?? 'unknown';
      if (s) {
        const r = get(s);
        r.recoveries.push({ startTs: (e.ts ?? 0) - ms, endTs: e.ts ?? 0, ms, action, depth: d.depth ?? 0 });
        r.downtimeMs += ms;
        if (action === 'retry' || action === 'backoff' || action === 'restart') r.retries++;
      }
    }
  }
  return {
    order, outcome, startTs: win[0]!.ts ?? 0, endTs: end ? (end.ts ?? 0) : null,
    lap: (end?.detail as any)?.lap ?? null, review: review?.detail ?? null,
    stages: [...stages.values()].map(({ open: _o, failed: _f, ...r }) => r),
  };
}
