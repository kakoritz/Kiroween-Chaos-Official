// LapTracker (PT-C3, playtest-v2 design section 4, contract/V1_1.md sections 3, 4, 6).
// A pure function of one wave's event stream: feed every event in order through `process`. It returns the events to
// record: the event itself (with `detail.lap` added on `order_done` and `order_failed`) followed by the lane's `review`.
// `summary(lane)` gives the v1.1 wave summary fields for `wave_end`.
import { APPS, type AppId } from '@haunt/shared';
import { ratingFor, review, StarTracker, type ReviewResult } from '../../../haunt/src/score/review';
import { baselineMs } from '../sim/v11';
import type { HauntEvent } from '../../../haunt/src/score/score';

type Ev = HauntEvent;

interface Rec {
  order: string;
  startTs: number;
  grab: number;
  walks: number;
  attempts: number;
  retries: number;
  issues: Map<string, number>;
  recov: { stage: string; action: string; ms: number }[];
  ivs: [number, number][];
  open?: { start: number; idx: number };
  extra: Record<string, number>;
  degraded: boolean;
  /** A gremlin hit this order (spec 5.3): it counts as an issue and caps the review when recovery was slow. */
  gremlin?: boolean;
  /** A cursed answer was swallowed: the step was skipped silently (spec 5.2). Counts as an issue with a big review penalty. */
  swallowed?: boolean;
  decision?: { choice?: string; detectedAt?: string };
  stageCur?: string;
}

interface LaneAcc {
  rec?: Rec;
  recs: Map<string, Rec>;
  open?: string;
  stack: { action: string; ts: number; stage: string }[];
  stars: StarTracker;
  doneMs: number[];
  allMs: number[];
  retries: number;
  downtimeMs: number;
  issuesByStage: Record<string, number>;
  counts: { done: number; cancelled: number; quarantined: number; abandoned: number };
}

export interface LapTrackerOptions {
  app: AppId;
  /** Pace factor: 1 normal, 2 show, 3 slow. */
  pace: number;
  /** Engine speed (real ms are nominal ms divided by speed). */
  speed: number;
  now?: () => number;
}

export class LapTracker {
  private readonly stageIds: string[];
  private readonly base: number;
  private readonly normFactor: number;
  private readonly now: () => number;
  private readonly lanes = new Map<string, LaneAcc>();

  constructor(o: LapTrackerOptions) {
    this.stageIds = APPS[o.app].stages.map((s) => s.id);
    const speed = o.speed > 0 ? o.speed : 1;
    this.base = baselineMs(o.app, o.pace) / speed;
    this.normFactor = o.pace / speed;
    this.now = o.now ?? Date.now;
  }

  private acc(lane: string): LaneAcc {
    let a = this.lanes.get(lane);
    if (!a) {
      a = { recs: new Map(), stack: [], stars: new StarTracker(), doneMs: [], allMs: [], retries: 0, downtimeMs: 0, issuesByStage: {}, counts: { done: 0, cancelled: 0, quarantined: 0, abandoned: 0 } };
      this.lanes.set(lane, a);
    }
    return a;
  }

  private static union(ivs: [number, number][]): number {
    const s = [...ivs].sort((a, b) => a[0] - b[0]);
    let total = 0; let cs = -1; let ce = -1;
    for (const [a, b] of s) {
      if (cs < 0) { cs = a; ce = b; } else if (a <= ce) ce = Math.max(ce, b); else { total += ce - cs; cs = a; ce = b; }
    }
    return cs < 0 ? 0 : total + (ce - cs);
  }

  private bump(r: Rec, stage: string | undefined): void {
    if (stage) r.issues.set(stage, (r.issues.get(stage) ?? 0) + 1);
  }

  private openIv(r: Rec, t: number, idx: number): void {
    if (!r.open) r.open = { start: t, idx };
  }

  /** Feed one event. Returns the events to record in order (the input first, with the lap added where it applies). */
  process(ev: Ev): Ev[] {
    if (ev.lane === undefined) return [ev];
    const S = this.acc(String(ev.lane));
    const t = typeof ev.ts === 'number' ? ev.ts : this.now();
    const d = (ev.detail ?? {}) as Record<string, any>;
    const r = S.rec;
    const idxOf = (s: unknown): number => this.stageIds.indexOf(String(s));
    switch (ev.type) {
      case 'order_start': {
        const id = String(ev.order);
        let rec = S.recs.get(id);
        if (!rec) {
          rec = { order: id, startTs: t, grab: 0, walks: 0, attempts: 0, retries: 0, issues: new Map(), recov: [], ivs: [], extra: {}, degraded: false };
          S.recs.set(id, rec);
        }
        rec.grab += typeof d.grabMs === 'number' ? d.grabMs : 0;
        S.rec = rec; S.open = undefined; S.stack = [];
        break;
      }
      case 'order_resumed': {
        const rec = S.recs.get(String(ev.order));
        if (rec) { rec.retries++; S.rec = rec; }
        break;
      }
      case 'stage_start':
        if (r) { r.attempts++; r.stageCur = ev.stage; }
        S.open = ev.stage;
        break;
      case 'stage_fail':
        if (r) { r.attempts++; this.bump(r, ev.stage); this.openIv(r, t, idxOf(ev.stage)); if (d.degraded) r.degraded = true; }
        break;
      case 'process_dead':
        if (r) { const st = S.open ?? r.stageCur; this.bump(r, st); this.openIv(r, t, S.open ? idxOf(S.open) : 0); }
        break;
      case 'repeat':
        if (r) { this.bump(r, S.open ?? r.stageCur); const k = String(d.kind); r.extra[k] = (r.extra[k] ?? 0) + 1; }
        break;
      case 'breaker':
        if (r && d.state === 'open') this.bump(r, S.open ?? r.stageCur);
        break;
      case 'order_parked':
        if (r) { this.bump(r, d.stage ?? r.stageCur); this.openIv(r, t, idxOf(d.stage ?? r.stageCur)); }
        S.rec = undefined; S.open = undefined;
        break;
      case 'recover_start':
        if (r) {
          S.stack.push({ action: String(d.action), ts: t, stage: S.open ?? r.stageCur ?? this.stageIds[0]! });
          if (d.action === 'retry' || d.action === 'backoff' || d.action === 'restart') r.retries++;
        }
        break;
      case 'recover_done': {
        const top = S.stack.pop();
        if (r && top) r.recov.push({ stage: top.stage, action: top.action, ms: typeof d.ms === 'number' ? d.ms : t - top.ts });
        break;
      }
      case 'curse_response':
        if (r && (d.class === 'swallowed' || d.class === 'crashed')) { this.bump(r, ev.stage ?? S.open ?? r.stageCur ?? this.stageIds[0]); if (d.class === 'swallowed') r.swallowed = true; }
        break;
      case 'chaos':
        if (r && d.source === 'gremlin') { this.bump(r, ev.stage ?? S.open ?? r.stageCur ?? this.stageIds[0]); r.gremlin = true; }
        break;
      case 'decision_needed': if (r) r.decision = { detectedAt: d.detectedAt }; break;
      case 'decision_made': if (r) r.decision = { ...(r.decision ?? {}), choice: d.choice }; break;
      case 'order_quarantined': S.counts.quarantined++; S.rec = undefined; S.open = undefined; break;
      case 'order_abandoned': S.counts.abandoned++; break;
      default: break;
    }

    if (ev.type === 'stage_done' && r) {
      r.walks += typeof d.walkMs === 'number' ? d.walkMs : 0;
      S.open = undefined;
      if (!d.skipped && r.open && idxOf(ev.stage) >= r.open.idx) { r.ivs.push([r.open.start, t]); r.open = undefined; }
      return [ev];
    }

    if ((ev.type === 'order_done' || ev.type === 'order_failed') && r) {
      if (r.open) { r.ivs.push([r.open.start, t]); r.open = undefined; }
      const ms = Math.max(0, t - r.startTs);
      const downtimeMs = LapTracker.union(r.ivs);
      const issues = [...r.issues.entries()].map(([stage, count]) => ({ stage, count })).sort((a, b) => this.stageIds.indexOf(a.stage) - this.stageIds.indexOf(b.stage));
      const lap = { ms, workMs: Math.max(0, ms - r.grab - r.walks), attempts: r.attempts, retries: r.retries, downtimeMs, issues, recoveries: r.recov };
      const cancelled = ev.type === 'order_failed';
      const rv: ReviewResult = review({
        lap, extra: r.extra, degraded: r.degraded, gremlin: r.gremlin, swallowed: r.swallowed, cancelled, baselineMs: this.base, paceFactor: this.normFactor,
        decision: r.decision?.choice ? { choice: r.decision.choice, detectedAt: r.decision.detectedAt } : undefined,
      });
      const cum = S.stars.add(rv.stars);
      S.allMs.push(ms);
      if (cancelled) S.counts.cancelled++; else { S.counts.done++; S.doneMs.push(ms); }
      S.retries += r.retries; S.downtimeMs += downtimeMs;
      for (const it of issues) S.issuesByStage[it.stage] = (S.issuesByStage[it.stage] ?? 0) + it.count;
      S.recs.delete(r.order); S.rec = undefined; S.open = undefined; S.stack = [];
      const done: Ev = { ...ev, detail: { ...d, lap, ...(ev.type === 'order_done' && d.ms === undefined ? { ms } : {}) } };
      const rvEv: Ev = {
        ts: t, type: 'review', wave: ev.wave, lane: ev.lane, order: ev.order,
        detail: { order: ev.order, stars: rv.stars, sub: rv.sub, reasons: rv.reasons, text: rv.text, cum },
      } as Ev;
      return [done, rvEv];
    }
    return [ev];
  }

  /** v1.1 wave summary fields of one lane (contract/V1_1.md section 6). Merge into the lane's `wave_end` summary row. */
  summary(lane: string): Record<string, unknown> {
    const S = this.acc(lane);
    const st = S.stars.summary();
    const avg = Math.round(st.avg * 100) / 100;
    const n = S.doneMs.length;
    return {
      orders: { done: S.counts.done, cancelled: S.counts.cancelled, quarantined: S.counts.quarantined, abandoned: S.counts.abandoned },
      ...(n ? { bestMs: Math.min(...S.doneMs), slowestMs: Math.max(...S.doneMs), avgMs: Math.round(S.doneMs.reduce((a, b) => a + b, 0) / n) } : {}),
      totalMs: S.allMs.reduce((a, b) => a + b, 0),
      retries: S.retries,
      downtimeMs: S.downtimeMs,
      issuesByStage: S.issuesByStage,
      // Issues of the lane this wave (spec 5.3): finished orders plus the one in flight. P19: never zero.
      issues: Object.values(S.issuesByStage).reduce((a, b) => a + b, 0) + (S.rec ? [...S.rec.issues.values()].reduce((a, b) => a + b, 0) : 0),
      stars: { sum: st.sum, max: st.max, count: st.count, avg },
      ...(st.count ? { rating: ratingFor(avg) } : {}),
    };
  }
}
