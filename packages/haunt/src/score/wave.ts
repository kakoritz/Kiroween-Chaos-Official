// Wave manager: wave numbering, event stamping, scoring, wave_end summary and per-lane wave grade.
import { EventLog } from '../events/eventlog';
import { laneGrade, worstGrade, type Grade } from './grade';
import { ScoreEngine, type HauntEvent, type ScoreOptions } from './score';

export interface WaveRecord {
  n: number;
  startedAt: number;
  endedAt?: number;
  score: number;
  grade?: Grade;
  grades?: Record<string, Grade>;
}

export interface WaveStartOptions extends ScoreOptions {
  /** Lane id to number of orders given to it. */
  lanes: Record<string, number>;
  /** Free-form fields copied into the `wave_start` detail (app, seed, mode). */
  info?: Record<string, unknown>;
}

export class WaveManager {
  readonly waves: WaveRecord[] = [];
  private current?: { rec: WaveRecord; engine: ScoreEngine; orders: Record<string, number> };

  constructor(readonly log: EventLog) {}

  get n(): number {
    return this.current?.rec.n ?? this.waves.at(-1)?.n ?? 0;
  }

  get active(): boolean {
    return this.current !== undefined;
  }

  start(opts: WaveStartOptions): number {
    if (this.current) throw new Error('wave already running');
    const n = (this.waves.at(-1)?.n ?? 0) + 1;
    const ev = this.log.emit({ type: 'wave_start', wave: n, detail: { lanes: Object.keys(opts.lanes), orders: opts.lanes, ...opts.info } });
    const rec: WaveRecord = { n, startedAt: ev.ts, score: 0 };
    this.waves.push(rec);
    this.current = { rec, engine: new ScoreEngine(opts), orders: opts.lanes };
    return n;
  }

  /** Stamp the wave, append to the log, then append any `score` events the event causes. Returns the stamped events. */
  record(ev: HauntEvent): HauntEvent[] {
    const cur = this.current;
    if (!cur) throw new Error('no wave running');
    const first = this.log.emit({ ...ev, wave: cur.rec.n });
    const out: HauntEvent[] = [first];
    for (const s of cur.engine.feed(first)) {
      out.push(this.log.emit({ type: 'score', wave: cur.rec.n, lane: s.lane, order: s.order, detail: { delta: s.delta, total: s.total, reason: s.reason } }));
    }
    return out;
  }

  summary(): Record<string, { score: number; completed: number; failed: number; parked: number; quarantined: number; repeats: number; grade: Grade }> {
    const cur = this.current;
    if (!cur) return {};
    const res: Record<string, any> = {};
    for (const lane of Object.keys(cur.orders)) {
      const c = cur.engine.lane(lane);
      res[lane] = {
        score: cur.engine.totals.get(lane) ?? 0,
        completed: c.completed,
        failed: c.failed,
        parked: c.parked,
        quarantined: c.quarantined,
        repeats: c.repeats,
        grade: laneGrade(c, cur.orders[lane]).grade,
      };
    }
    return res;
  }

  /** `extend` adds fields to each lane's summary row (the v1.1 lap fields, contract section 6). */
  end(stopped = false, extend?: (lane: string, row: Record<string, any>) => Record<string, unknown>): WaveRecord {
    const cur = this.current;
    if (!cur) throw new Error('no wave running');
    const base = this.summary();
    const summary = extend ? (Object.fromEntries(Object.entries(base).map(([k, v]) => [k, { ...v, ...extend(k, v) }])) as typeof base) : base;
    const ev = this.log.emit({ type: 'wave_end', wave: cur.rec.n, detail: { summary, ...(stopped ? { stopped: true } : {}) } });
    cur.rec.endedAt = ev.ts;
    cur.rec.score = Object.values(summary).reduce((a, s) => a + s.score, 0);
    cur.rec.grades = Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, v.grade]));
    cur.rec.grade = worstGrade(Object.values(cur.rec.grades));
    this.current = undefined;
    return cur.rec;
  }
}
