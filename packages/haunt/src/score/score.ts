// Score engine v2: a pure function of the event stream (playtest-v2 design.md section 5, properties P7, P14, P16).

export interface HauntEvent {
  seq?: number;
  ts?: number;
  type: string;
  wave?: number;
  lane?: string;
  order?: string;
  stage?: string;
  detail?: Record<string, any>;
}

export interface ScoreOptions {
  /** Baseline sum of stage times for one order at 1x, in ms. */
  baselineMs?: number;
  /** Speed multiplier; real time limits scale by 1 / speed. */
  speed?: number;
  /** Pace factor of the run (1 = normal). Downtime is normalised by speed / paceFactor. */
  paceFactor?: number;
}

export interface LaneCounts {
  completed: number;
  failed: number;
  parked: number;
  quarantined: number;
  abandoned: number;
  halted: boolean;
  repeats: number;
  /** Completed with zero extra ledger rows and never parked. */
  clean: number;
  /** Parked, resumed, then completed clean. */
  parkedResumed: number;
  /** Completed with at least one repeat. */
  repeated: number;
}

export interface ScoreDelta {
  lane: string;
  order?: string;
  delta: number;
  total: number;
  reason: string;
}

export const POINTS = {
  clean: 100,
  withRepeat: 40,
  repeatRow: -150,
  cancelled: -300,
  quarantined: 30,
  resumedBonus: 40,
  halted: -400,
  abandoned: -150,
  attackPerDepth: 25,
  speed: 20,
  speedSlackMs: 600,
  downtimePerSecond: -2,
  downtimeCapPerOrder: -300,
  reviewPerStar: 40,
  bossRecovered: 150,
  refund: -150,
  discount: -60,
} as const;

/** Baseline of one order at speed 1 and normal pace, with travel (design section 5 worked examples). */
export const DEFAULT_BASELINE_MS = 10650;

interface OrderState {
  attacks: number[];
  extraRows: number;
  parked: boolean;
  resumed: boolean;
  refunded: boolean;
  downStart?: number;
  downtimeScore: number;
}

/** Round half away from zero. */
const roundAway = (x: number): number => (x < 0 ? -Math.round(-x) : Math.round(x));

export class ScoreEngine {
  readonly totals = new Map<string, number>();
  readonly lanes = new Map<string, LaneCounts>();
  private readonly orders = new Map<string, OrderState>();
  private readonly repeatCounts = new Map<string, number>();
  private readonly inFlight = new Map<string, string>();
  private readonly bossOrder = new Map<string, string>();
  private readonly bossDowntime = new Map<string, number>();
  private readonly baseline: number;
  private readonly speed: number;
  private readonly pace: number;

  constructor(opts: ScoreOptions = {}) {
    this.baseline = opts.baselineMs ?? DEFAULT_BASELINE_MS;
    this.speed = opts.speed && opts.speed > 0 ? opts.speed : 1;
    this.pace = opts.paceFactor && opts.paceFactor > 0 ? opts.paceFactor : 1;
  }

  lane(lane: string): LaneCounts {
    let c = this.lanes.get(lane);
    if (!c) {
      c = { completed: 0, failed: 0, parked: 0, quarantined: 0, abandoned: 0, halted: false, repeats: 0, clean: 0, parkedResumed: 0, repeated: 0 };
      this.lanes.set(lane, c);
      this.totals.set(lane, 0);
    }
    return c;
  }

  private orderOf(lane: string, order: string): OrderState {
    const key = `${lane}|${order}`;
    let s = this.orders.get(key);
    if (!s) {
      s = { attacks: [], extraRows: 0, parked: false, resumed: false, refunded: false, downtimeScore: 0 };
      this.orders.set(key, s);
    }
    return s;
  }

  private order(ev: HauntEvent): OrderState {
    return this.orderOf(ev.lane ?? '', ev.order ?? '');
  }

  /** Feed one event, get the score deltas it causes (in order). */
  feed(ev: HauntEvent): ScoreDelta[] {
    const out: ScoreDelta[] = [];
    const lane = ev.lane;
    const d = ev.detail ?? {};
    const add = (delta: number, reason: string, order: string | undefined = ev.order) => {
      if (!lane || delta === 0) return;
      const total = (this.totals.get(lane) ?? 0) + delta;
      this.totals.set(lane, total);
      out.push({ lane, order, delta, total, reason });
    };
    /** Start a downtime interval on the lane's order in flight (intervals merge, never nest). */
    const downBegin = () => {
      if (!lane || typeof ev.ts !== 'number') return;
      const o = ev.order ?? this.inFlight.get(lane);
      if (o === undefined) return;
      const st = this.orderOf(lane, o);
      if (st.downStart === undefined) st.downStart = ev.ts;
    };
    /** Drop an open interval without a penalty (terminal event or halt). */
    const downDrop = (o: string | undefined) => {
      if (lane && o !== undefined) this.orderOf(lane, o).downStart = undefined;
    };
    switch (ev.type) {
      case 'boss_start':
        this.bossOrder.clear();
        this.bossDowntime.clear();
        for (const [l, o] of this.inFlight) this.bossOrder.set(l, o);
        break;
      case 'order_start':
        if (!lane) break;
        this.lane(lane);
        if (ev.order !== undefined) this.inFlight.set(lane, ev.order);
        break;
      case 'chaos': {
        if (!lane) break;
        this.lane(lane);
        if (ev.order) this.order(ev).attacks.push(Number(d.depth) > 0 ? Number(d.depth) : 1);
        break;
      }
      case 'stage_fail':
      case 'process_dead':
        downBegin();
        break;
      case 'stage_done': {
        if (!lane) break;
        this.lane(lane);
        const o = ev.order ?? this.inFlight.get(lane);
        if (o === undefined) break;
        const st = this.orderOf(lane, o);
        if (st.downStart === undefined || typeof ev.ts !== 'number') break;
        const ms1x = ((ev.ts - st.downStart) * this.speed) / this.pace;
        st.downStart = undefined;
        const raw = roundAway((ms1x / 1000) * POINTS.downtimePerSecond);
        const room = POINTS.downtimeCapPerOrder - st.downtimeScore;
        const delta = Math.max(raw, room);
        if (delta < 0) {
          st.downtimeScore += delta;
          this.bossDowntime.set(lane, (this.bossDowntime.get(lane) ?? 0) + delta);
          add(delta, 'downtime', o);
        }
        break;
      }
      case 'repeat': {
        if (!lane) break;
        const c = this.lane(lane);
        const key = `${lane}|${ev.order ?? ''}|${d.kind}|${d.key}`;
        const prev = this.repeatCounts.get(key) ?? 1;
        const count = Number(d.count) || prev + 1;
        const extra = Math.max(0, count - prev);
        this.repeatCounts.set(key, Math.max(count, prev));
        if (extra > 0) {
          c.repeats += extra;
          if (ev.order) this.order(ev).extraRows += extra;
          add(POINTS.repeatRow * extra, `duplicate ${d.kind}`);
        }
        break;
      }
      case 'decision_made': {
        if (!lane) break;
        this.lane(lane);
        const o = typeof d.order === 'string' ? d.order : ev.order;
        if (d.choice === 'refund') {
          if (o !== undefined) this.orderOf(lane, o).refunded = true;
          add(POINTS.refund, 'refund', o);
        } else if (d.choice === 'discount') add(POINTS.discount, 'discount', o);
        break;
      }
      case 'order_done': {
        if (!lane) break;
        const c = this.lane(lane);
        const st = this.order(ev);
        c.completed++;
        downDrop(ev.order);
        if (this.inFlight.get(lane) === ev.order) this.inFlight.delete(lane);
        const clean = st.extraRows === 0 && d.clean !== false;
        if (!clean) {
          c.repeated++;
          add(POINTS.withRepeat, 'order with repeats');
        } else {
          add(POINTS.clean, 'order clean');
          if (st.resumed) {
            c.parkedResumed++;
            add(POINTS.resumedBonus, 'parked then resumed');
          } else {
            c.clean++;
            const ms = typeof d.lap?.ms === 'number' ? d.lap.ms : d.ms;
            if (typeof ms === 'number' && ms <= (1.25 * this.baseline + POINTS.speedSlackMs) / this.speed) add(POINTS.speed, 'speed bonus');
          }
          for (const depth of st.attacks) add(POINTS.attackPerDepth * depth, `survived depth ${depth}`);
        }
        if (ev.order !== undefined && this.bossOrder.get(lane) === ev.order) {
          this.bossOrder.delete(lane);
          add(POINTS.bossRecovered, 'boss recovered');
          const back = -(this.bossDowntime.get(lane) ?? 0);
          if (back > 0) add(back, 'boss downtime refund');
        }
        break;
      }
      case 'order_failed': {
        if (!lane) break;
        const st = this.order(ev);
        this.lane(lane).failed++;
        downDrop(ev.order);
        if (this.inFlight.get(lane) === ev.order) this.inFlight.delete(lane);
        if (ev.order !== undefined && this.bossOrder.get(lane) === ev.order) this.bossOrder.delete(lane);
        if (!st.refunded) add(POINTS.cancelled, 'order cancelled');
        break;
      }
      case 'order_parked':
        if (!lane) break;
        this.lane(lane).parked++;
        this.order(ev).parked = true;
        downBegin();
        break;
      case 'order_resumed':
        if (!lane) break;
        this.lane(lane);
        this.order(ev).resumed = true;
        break;
      case 'order_quarantined':
        if (!lane) break;
        this.lane(lane).quarantined++;
        downDrop(ev.order);
        if (this.inFlight.get(lane) === ev.order) this.inFlight.delete(lane);
        add(POINTS.quarantined, 'order quarantined');
        break;
      case 'order_abandoned':
        if (!lane) break;
        this.lane(lane).abandoned++;
        add(POINTS.abandoned, 'order abandoned');
        break;
      case 'lane_halted': {
        if (!lane) break;
        const c = this.lane(lane);
        downDrop(this.inFlight.get(lane));
        if (!c.halted) {
          c.halted = true;
          add(POINTS.halted, 'lane halted');
        }
        break;
      }
      case 'review': {
        if (!lane) break;
        this.lane(lane);
        const stars = Number(d.stars);
        if (Number.isFinite(stars)) add(roundAway((stars - 3) * POINTS.reviewPerStar), 'review', typeof d.order === 'string' ? d.order : ev.order);
        break;
      }
      default:
        break;
    }
    return out;
  }
}

export interface ScoredRun {
  /** Input events with a `score` event inserted right after each causing event (no seq or ts assigned). */
  events: HauntEvent[];
  totals: Record<string, number>;
  lanes: Record<string, LaneCounts>;
}

/** Replay a stream and compute everything. Existing `score` events in the input are dropped. */
export function scoreEvents(events: readonly HauntEvent[], opts: ScoreOptions = {}): ScoredRun {
  const eng = new ScoreEngine(opts);
  const out: HauntEvent[] = [];
  for (const ev of events) {
    if (ev.type === 'score') continue;
    out.push(ev);
    for (const s of eng.feed(ev)) {
      out.push({ type: 'score', wave: ev.wave, lane: s.lane, order: s.order, detail: { delta: s.delta, total: s.total, reason: s.reason } });
    }
  }
  return { events: out, totals: Object.fromEntries(eng.totals), lanes: Object.fromEntries(eng.lanes) };
}
