// Contract v1.1 decorator for generated fixtures (contract/V1_1.md, playtest-v2 design sections 1, 3 to 6).
// Takes one planned wave (the v1.0 events of the lane planner or of a fixture script) and adds, per lane:
//   travel gaps (rule 40), `lap` (rule 41), `review` (rule 42), the wave summary fields (rule 43),
//   downtime scores (rule 45), cancelled -300, halt -400 and review scores of scoring v2.
// The decorator only moves a lane's own events later (never earlier, never out of order), so every causal
// relation the planner established inside a lane is kept. The engine itself gets the same behaviour in PT-C2 to PT-C6.
import { APPS, type AppId, type HauntEvent } from '@haunt/shared';

export interface Travel { walkMs: number; grabMs: number; ceremonyMs: number; returnMs: number; cancelMs: number }

/** Base values at 1x of contract/V1_1.md section 1, times the pace factor (speed is 1 in fixtures). */
export const travelFor = (factor: number): Travel => ({
  walkMs: 400 * factor, grabMs: 500 * factor, ceremonyMs: 1600 * factor, returnMs: 1800 * factor, cancelMs: 900 * factor,
});

export const RATINGS = ['Five-Star Crypt', 'Respectable', 'Spooky Service', 'Cursed'] as const;
export const ratingFor = (avg: number): (typeof RATINGS)[number] => (avg >= 4.5 ? RATINGS[0] : avg >= 3.5 ? RATINGS[1] : avg >= 2.5 ? RATINGS[2] : RATINGS[3]);

export interface ReviewInput {
  lap: { ms: number; downtimeMs: number; issues: { stage: string; count: number }[] };
  extra: Record<string, number>;
  degraded: boolean;
  decision?: { choice: string; detectedAt?: string };
  cancelled: boolean;
  baselineMs: number;
  paceFactor: number;
}

export interface ReviewResult {
  stars: number;
  sub: { timeliness: number; delays: number; issues: number; delivery: number; ease: number };
  reasons: string[];
  text: string;
}

const LOW: Record<string, string> = {
  timeliness: 'Took forever to arrive', delays: 'Kept me waiting', issues: 'So many hiccups', delivery: 'Wrong order', ease: 'Hard to order',
};
const HIGH: Record<string, string> = {
  timeliness: 'Lightning fast', delays: 'No waiting around', issues: 'Smooth as a ghost', delivery: 'Everything arrived right', ease: 'Easy to order',
};
const SUBS = ['timeliness', 'delays', 'issues', 'delivery', 'ease'] as const;

/** playtest-v2 design section 6. Pure and deterministic. */
export function reviewOf(inp: ReviewInput): ReviewResult {
  if (inp.cancelled) {
    return { stars: 1, sub: { timeliness: 1, delays: 1, issues: 1, delivery: 1, ease: 1 }, reasons: ['Never arrived'], text: 'Never arrived' };
  }
  const r = inp.lap.ms / inp.baselineMs;
  const timeliness = r <= 1.25 ? 5 : r <= 1.6 ? 4 : r <= 2.2 ? 3 : r <= 3.0 ? 2 : 1;
  const d = inp.lap.downtimeMs / inp.paceFactor / 1000;
  const delays = d === 0 ? 5 : d <= 2 ? 4 : d <= 5 ? 3 : d <= 10 ? 2 : 1;
  const n = inp.lap.issues.reduce((s, x) => s + x.count, 0);
  const issues = n === 0 ? 5 : n === 1 ? 4 : n === 2 ? 3 : n <= 4 ? 2 : 1;
  const extraRows = Object.values(inp.extra).reduce((s, x) => s + x, 0);
  const choice = inp.decision?.choice;
  let delivery = 5;
  if (extraRows >= 2) delivery = Math.min(delivery, 1);
  else if (extraRows === 1 || inp.degraded) delivery = Math.min(delivery, 3);
  if (choice === 'discount') delivery = Math.min(delivery, 2);
  if (choice === 'redo') delivery = Math.min(delivery, 4);
  const front = inp.lap.issues.filter((x) => x.stage === 'intake' || x.stage === 'confirmation').reduce((s, x) => s + x.count, 0);
  let ease = front === 0 ? 5 : front === 1 ? 4 : 3;
  if (choice === 'redo') ease = Math.min(ease, 2);
  if (choice === 'refund') ease = Math.min(ease, 1);
  const sub = { timeliness, delays, issues, delivery, ease };
  let stars = Math.round(((timeliness + delays + issues + delivery + ease) / 5) * 2) / 2;
  if ((inp.extra.charge ?? 0) > 0) stars = Math.min(stars, 2);
  if (choice === 'refund') stars = Math.min(stars, 2);
  if (choice === 'discount') stars = Math.min(stars, 3);
  if (choice === 'redo') stars = Math.min(stars, 4);
  stars = Math.max(1, stars);
  const lowDelivery = (inp.extra.charge ?? 0) > 0 ? 'Charged twice!' : choice === 'discount' ? 'Wrong order' : inp.degraded ? 'Missing updates' : LOW.delivery;
  let reasons = SUBS.filter((k) => sub[k] <= 3).map((k) => (k === 'delivery' ? lowDelivery : LOW[k])).slice(0, 2);
  if (reasons.length === 0) {
    reasons = SUBS.map((k, i) => ({ k, i, v: sub[k] })).sort((a, b) => b.v - a.v || a.i - b.i).slice(0, 2).sort((a, b) => a.i - b.i).map((x) => HIGH[x.k]);
  }
  return { stars, sub, reasons, text: reasons.join(' \u00b7 ') };
}

/** Nominal first-attempt duration of an order: stage midpoints times pace, seven walks and the grab. */
export function baselineMs(app: AppId, factor: number): number {
  const t = travelFor(factor);
  const stages = APPS[app].stages;
  return stages.reduce((s, d) => s + ((d.min + d.max) / 2) * factor, 0) + (stages.length - 1) * t.walkMs + t.grabMs;
}

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
  decision?: { choice?: string; detectedAt?: string };
  stageCur?: string;
  penalty: number;
}

interface Acc {
  ready: boolean;
  score: number;
  rec?: Rec;
  recs: Map<string, Rec>;
  open?: string;
  stack: { action: string; ts: number; stage: string }[];
  stars: { sum: number; count: number };
  doneMs: number[];
  allMs: number[];
  retries: number;
  downtimeMs: number;
  issuesByStage: Record<string, number>;
  counts: { done: number; cancelled: number; quarantined: number; abandoned: number };
  bossOn: boolean;
  bossPen: number;
}

export interface DecorateOptions {
  /** Pace factor: 1 normal, 2 show, 3 slow. */
  pace: number;
  /** Apply the money changes of scoring v2 (cancelled -300, halt -400, downtime, review). Default true. */
  scoring?: boolean;
}

/**
 * Returns a new event list (seq is left as it is, call `assignSeq`). The input must be one wave, sorted by ts.
 */
export function decorateV11(input: HauntEvent[], o: DecorateOptions): HauntEvent[] {
  const f = o.pace;
  const T = travelFor(f);
  const scoring = o.scoring !== false;
  const evs: HauntEvent[] = input.map((e) => ({ ...e, ...(e.detail ? { detail: { ...e.detail } } : {}) }));
  const ws = evs.find((e) => e.type === 'wave_start');
  const app: AppId = (ws?.detail?.app as AppId) ?? 'orders';
  const stageIds = APPS[app].stages.map((s) => s.id);
  const lastIdx = stageIds.length - 1;
  const base = baselineMs(app, f);

  // ---------------------------------------------------------------- pass 1: timing
  interface LS { shift: number; grab?: { ts: number; ms: number }; walk?: { ts: number; ms: number }; gap?: { ts: number; ms: number }; resume: boolean }
  const ls = new Map<number, LS>();
  const get = (n: number): LS => { let s = ls.get(n); if (!s) { s = { shift: 0, resume: false }; ls.set(n, s); } return s; };
  const newTs: number[] = new Array(evs.length);
  evs.forEach((e, i) => {
    if (e.lane === undefined) {
      const shifts = [...ls.values()].map((s) => s.shift);
      const lo = shifts.length ? Math.min(...shifts) : 0;
      const hi = shifts.length ? Math.max(...shifts) : 0;
      newTs[i] = e.ts + (e.type === 'boss_warning' || e.type === 'boss_start' ? lo : e.type === 'boss_end' || e.type === 'wave_end' ? hi : 0);
      return;
    }
    const L = get(e.lane);
    const d = (e.detail ??= {});
    let t = e.ts + L.shift;
    const need = (to: number): void => { if (t < to) { L.shift += to - t; t = to; } };
    switch (e.type) {
      case 'order_start':
        if (L.gap) need(L.gap.ts + L.gap.ms);
        L.gap = undefined; L.walk = undefined;
        if (L.resume) { L.resume = false; L.grab = undefined; } else { d.grabMs = T.grabMs; L.grab = { ts: t, ms: T.grabMs }; }
        break;
      case 'order_resumed':
        L.resume = true;
        break;
      case 'stage_start':
        if (L.grab) need(L.grab.ts + L.grab.ms);
        if (L.walk) need(L.walk.ts + L.walk.ms);
        L.grab = undefined; L.walk = undefined;
        break;
      case 'stage_done':
        if (!d.skipped && stageIds.indexOf(e.stage as string) < lastIdx) { d.walkMs = T.walkMs; L.walk = { ts: t, ms: T.walkMs }; } else L.walk = undefined;
        break;
      case 'recover_start': case 'process_dead':
        L.walk = undefined; L.grab = undefined;
        break;
      case 'order_done':
        d.ceremonyMs = T.ceremonyMs; d.returnMs = T.returnMs;
        L.gap = { ts: t, ms: T.ceremonyMs + T.returnMs }; L.walk = undefined; L.grab = undefined;
        break;
      case 'order_failed':
        d.cancelMs = T.cancelMs; d.returnMs = T.returnMs;
        if (d.outcome === undefined) d.outcome = 'cancelled';
        L.gap = { ts: t, ms: T.cancelMs + T.returnMs }; L.walk = undefined; L.grab = undefined;
        break;
      case 'order_quarantined': case 'order_parked':
        L.walk = undefined; L.grab = undefined;
        break;
      default:
    }
    newTs[i] = t;
  });

  // ---------------------------------------------------------------- pass 2: laps, reviews, scores
  const idxs = evs.map((_, i) => i).sort((a, b) => newTs[a] - newTs[b] || a - b);
  const acc = new Map<number, Acc>();
  const A = (n: number): Acc => {
    let a = acc.get(n);
    if (!a) {
      a = { ready: false, score: 0, recs: new Map(), stack: [], stars: { sum: 0, count: 0 }, doneMs: [], allMs: [], retries: 0, downtimeMs: 0, issuesByStage: {}, counts: { done: 0, cancelled: 0, quarantined: 0, abandoned: 0 }, bossOn: false, bossPen: 0 };
      acc.set(n, a);
    }
    return a;
  };
  const out: HauntEvent[] = [];
  const mk = (src: HauntEvent, type: string, ts: number, detail: Record<string, any>, order?: string): HauntEvent => ({
    seq: 0, ts, type, wave: src.wave, lane: src.lane, ...(order ? { order } : {}), detail,
  });
  const union = (ivs: [number, number][]): number => {
    const s = [...ivs].sort((a, b) => a[0] - b[0]);
    let total = 0; let cs = -1; let ce = -1;
    for (const [a, b] of s) {
      if (cs < 0) { cs = a; ce = b; } else if (a <= ce) ce = Math.max(ce, b); else { total += ce - cs; cs = a; ce = b; }
    }
    return cs < 0 ? 0 : total + (ce - cs);
  };
  const bump = (r: Rec, stage: string | undefined): void => { if (stage) r.issues.set(stage, (r.issues.get(stage) ?? 0) + 1); };
  const openIv = (r: Rec, t: number, idx: number): void => { if (!r.open) r.open = { start: t, idx }; };

  for (const i of idxs) {
    const e = evs[i];
    const t = newTs[i];
    const ev: HauntEvent = { ...e, ts: t };
    if (ev.lane === undefined) {
      if (ev.type === 'boss_start') for (const a of acc.values()) { a.bossOn = true; a.bossPen = 0; }
      out.push(ev);
      continue;
    }
    const S = A(ev.lane);
    const d = (ev.detail ??= {});
    const r = S.rec;
    let partner: HauntEvent | undefined;
    switch (ev.type) {
      case 'lane_ready': S.ready = true; break;
      case 'order_start': {
        const id = ev.order as string;
        let rec = S.recs.get(id);
        if (!rec) {
          rec = { order: id, startTs: t, grab: 0, walks: 0, attempts: 0, retries: 0, issues: new Map(), recov: [], ivs: [], extra: {}, degraded: false, penalty: 0 };
          S.recs.set(id, rec);
        }
        rec.grab += (d.grabMs as number | undefined) ?? 0;
        S.rec = rec; S.open = undefined;
        break;
      }
      case 'order_resumed': {
        const rec = S.recs.get(ev.order as string);
        if (rec) rec.retries++;
        break;
      }
      case 'stage_start':
        if (r) { r.attempts++; r.stageCur = ev.stage; }
        S.open = ev.stage;
        break;
      case 'stage_fail':
        if (r) { r.attempts++; bump(r, ev.stage); openIv(r, t, stageIds.indexOf(ev.stage as string)); if (d.degraded) r.degraded = true; }
        break;
      case 'process_dead':
        if (r) { const st = S.open ?? r.stageCur; bump(r, st); openIv(r, t, S.open ? stageIds.indexOf(S.open) : 0); }
        break;
      case 'repeat':
        if (r) { bump(r, S.open ?? r.stageCur); const k = String(d.kind); r.extra[k] = (r.extra[k] ?? 0) + 1; }
        break;
      case 'order_parked':
        if (r) { bump(r, d.stage as string); openIv(r, t, stageIds.indexOf(d.stage as string)); S.rec = undefined; S.open = undefined; }
        break;
      case 'recover_start':
        if (r) {
          S.stack.push({ action: String(d.action), ts: t, stage: S.open ?? r.stageCur ?? stageIds[0] });
          if (d.action === 'retry' || d.action === 'backoff' || d.action === 'restart') r.retries++;
        }
        break;
      case 'recover_done': {
        const top = S.stack.pop();
        if (r && top) r.recov.push({ stage: top.stage, action: top.action, ms: typeof d.ms === 'number' ? d.ms : t - top.ts });
        break;
      }
      case 'decision_needed': if (r) r.decision = { detectedAt: d.detectedAt as string }; break;
      case 'decision_made': if (r) r.decision = { ...(r.decision ?? {}), choice: d.choice as string }; break;
      case 'order_quarantined': S.counts.quarantined++; S.rec = undefined; S.open = undefined; break;
      case 'order_abandoned': S.counts.abandoned++; break;
      case 'score': {
        if (scoring && d.reason === 'order failed') { d.delta = -300; d.reason = 'order cancelled'; }
        if (scoring && d.reason === 'lane halted') d.delta = -400;
        if (scoring && d.reason === 'boss survived') {
          d.delta = 150; d.reason = 'boss recovered';
          partner = mk(ev, 'score', t, { delta: S.bossPen, total: 0, reason: 'boss downtime refund' });
          S.bossPen = 0; S.bossOn = false;
        }
        break;
      }
      default:
    }

    if (ev.type === 'stage_done' && r) {
      r.walks += (d.walkMs as number | undefined) ?? 0;
      S.open = undefined;
      out.push(ev);
      const idx = stageIds.indexOf(ev.stage as string);
      if (!d.skipped && r.open && idx >= r.open.idx) {
        const iv: [number, number] = [r.open.start, t];
        r.ivs.push(iv); r.open = undefined;
        if (scoring) {
          const raw = Math.round((2 * ((iv[1] - iv[0]) / f)) / 1000);
          const delta = -Math.min(raw, 300 - r.penalty);
          if (delta < 0) {
            r.penalty += -delta;
            if (S.bossOn) S.bossPen += -delta;
            out.push(mk(ev, 'score', t, { delta, total: 0, reason: 'downtime' }, ev.order));
          }
        }
      }
      continue;
    }

    if ((ev.type === 'order_done' || ev.type === 'order_failed') && r) {
      if (r.open) { r.ivs.push([r.open.start, t]); r.open = undefined; }
      const ms = t - r.startTs;
      const downtimeMs = union(r.ivs);
      const issues = [...r.issues.entries()].map(([stage, count]) => ({ stage, count })).sort((a, b) => stageIds.indexOf(a.stage) - stageIds.indexOf(b.stage));
      const lap = { ms, workMs: Math.max(0, ms - r.grab - r.walks), attempts: r.attempts, retries: r.retries, downtimeMs, issues, recoveries: r.recov };
      d.lap = lap;
      if (ev.type === 'order_done') d.ms = ms;
      const cancelled = ev.type === 'order_failed';
      const rv = reviewOf({ lap, extra: r.extra, degraded: r.degraded, decision: r.decision?.choice ? { choice: r.decision.choice, detectedAt: r.decision.detectedAt } : undefined, cancelled, baselineMs: base, paceFactor: f });
      S.stars.sum += rv.stars; S.stars.count++;
      S.allMs.push(ms);
      if (cancelled) S.counts.cancelled++; else { S.counts.done++; S.doneMs.push(ms); }
      S.retries += r.retries; S.downtimeMs += downtimeMs;
      for (const it of issues) S.issuesByStage[it.stage] = (S.issuesByStage[it.stage] ?? 0) + it.count;
      out.push(ev);
      out.push(mk(ev, 'review', t, {
        order: ev.order, stars: rv.stars, sub: rv.sub, reasons: rv.reasons, text: rv.text,
        cum: { stars: S.stars.sum, max: 5 * S.stars.count, count: S.stars.count },
      }, ev.order));
      if (scoring && rv.stars !== 3) out.push(mk(ev, 'score', t, { delta: (rv.stars - 3) * 40, total: 0, reason: 'review' }, ev.order));
      S.rec = undefined; S.open = undefined; S.stack = [];
      continue;
    }
    out.push(ev);
    if (partner) out.push(partner);
  }

  // ---------------------------------------------------------------- pass 3: score chains and wave_end
  const run = new Map<number, number>();
  for (const ev of out) {
    if (ev.type === 'score' && ev.lane !== undefined) {
      const total = (run.get(ev.lane) ?? 0) + (ev.detail!.delta as number);
      ev.detail!.total = total; run.set(ev.lane, total);
    }
  }
  const end = out.find((e) => e.type === 'wave_end');
  if (end) {
    const sum: Record<string, any> = { ...(end.detail!.summary as Record<string, any>) };
    for (const key of Object.keys(sum)) {
      const n = Number(key);
      const S = A(n);
      const old = sum[key];
      const st = S.stars;
      const avg = st.count ? Math.round((st.sum / st.count) * 100) / 100 : 0;
      const doneN = S.doneMs.length;
      sum[key] = {
        ...old,
        score: run.get(n) ?? old.score,
        orders: { done: S.counts.done, cancelled: S.counts.cancelled, parked: old.parked ?? 0, quarantined: S.counts.quarantined, abandoned: S.counts.abandoned },
        ...(doneN ? { bestMs: Math.min(...S.doneMs), slowestMs: Math.max(...S.doneMs), avgMs: Math.round(S.doneMs.reduce((a, b) => a + b, 0) / doneN) } : {}),
        totalMs: S.allMs.reduce((a, b) => a + b, 0),
        retries: S.retries,
        downtimeMs: S.downtimeMs,
        issuesByStage: S.issuesByStage,
        stars: { sum: st.sum, max: 5 * st.count, count: st.count, avg },
        rating: ratingFor(avg),
      };
    }
    end.detail = { ...end.detail, summary: sum };
  }
  const hello = out.find((e) => e.type === 'hello');
  if (hello) hello.contractMinor = 1;
  const bs = out.find((e) => e.type === 'boss_start');
  const be = out.find((e) => e.type === 'boss_end');
  if (bs && be) be.detail = { ...be.detail, durationMs: be.ts - bs.ts };
  return out;
}
