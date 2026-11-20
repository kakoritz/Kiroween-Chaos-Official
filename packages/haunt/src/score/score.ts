// Score engine: a pure function of the event stream (design.md section 7, runtime.md section 8, property P7).

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
  failed: -50,
  quarantined: 30,
  resumedBonus: 40,
  halted: -200,
  attackPerDepth: 25,
  speed: 20,
  boss: 100,
} as const;

export const DEFAULT_BASELINE_MS = 7350;

interface OrderState {
  attacks: number[];
  extraRows: number;
  parked: boolean;
  resumed: boolean;
}

export class ScoreEngine {
  readonly totals = new Map<string, number>();
  readonly lanes = new Map<string, LaneCounts>();
  private readonly orders = new Map<string, OrderState>();
  private readonly repeatCounts = new Map<string, number>();
  private readonly bossLanesPaid = new Set<string>();
  private bossActive = false;
  private readonly baseline: number;
  private readonly speed: number;

  constructor(opts: ScoreOptions = {}) {
    this.baseline = opts.baselineMs ?? DEFAULT_BASELINE_MS;
    this.speed = opts.speed && opts.speed > 0 ? opts.speed : 1;
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

  private order(ev: HauntEvent): OrderState {
    const key = `${ev.lane}|${ev.order ?? ''}`;
    let s = this.orders.get(key);
    if (!s) {
      s = { attacks: [], extraRows: 0, parked: false, resumed: false };
      this.orders.set(key, s);
    }
    return s;
  }

  /** Feed one event, get the score deltas it causes (in order). */
  feed(ev: HauntEvent): ScoreDelta[] {
    const out: ScoreDelta[] = [];
    const lane = ev.lane;
    const d = ev.detail ?? {};
    const add = (delta: number, reason: string) => {
      if (!lane || delta === 0) return;
      const total = (this.totals.get(lane) ?? 0) + delta;
      this.totals.set(lane, total);
      out.push({ lane, order: ev.order, delta, total, reason });
    };
    switch (ev.type) {
      case 'boss_start':
        this.bossActive = true;
        this.bossLanesPaid.clear();
        break;
      case 'boss_end':
        this.bossActive = false;
        break;
      case 'chaos': {
        if (!lane) break;
        this.lane(lane);
        if (ev.order) this.order(ev).attacks.push(Number(d.depth) > 0 ? Number(d.depth) : 1);
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
      case 'order_done': {
        if (!lane) break;
        const c = this.lane(lane);
        const st = this.order(ev);
        c.completed++;
        const clean = st.extraRows === 0 && d.clean !== false;
        if (!clean) {
          c.repeated++;
          add(POINTS.withRepeat, 'completed with repeats');
          break;
        }
        add(POINTS.clean, 'order complete');
        if (st.resumed) {
          c.parkedResumed++;
          add(POINTS.resumedBonus, 'resilience bonus');
        } else {
          c.clean++;
          if (typeof d.ms === 'number' && d.ms <= (1.25 * this.baseline) / this.speed) add(POINTS.speed, 'speed bonus');
        }
        const attack = st.attacks.reduce((a, depth) => a + POINTS.attackPerDepth * depth, 0);
        if (attack > 0) add(attack, 'survived attack');
        if (this.bossActive && !this.bossLanesPaid.has(lane)) {
          this.bossLanesPaid.add(lane);
          add(POINTS.boss, 'boss survived');
        }
        break;
      }
      case 'order_failed':
        if (!lane) break;
        this.lane(lane).failed++;
        add(POINTS.failed, 'order failed');
        break;
      case 'order_parked':
        if (!lane) break;
        this.lane(lane).parked++;
        this.order(ev).parked = true;
        break;
      case 'order_resumed':
        if (!lane) break;
        this.lane(lane);
        this.order(ev).resumed = true;
        break;
      case 'order_quarantined':
        if (!lane) break;
        this.lane(lane).quarantined++;
        add(POINTS.quarantined, 'order quarantined');
        break;
      case 'order_abandoned':
        if (!lane) break;
        this.lane(lane).abandoned++;
        break;
      case 'lane_halted': {
        if (!lane) break;
        const c = this.lane(lane);
        if (!c.halted) {
          c.halted = true;
          add(POINTS.halted, 'lane halted');
        }
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
