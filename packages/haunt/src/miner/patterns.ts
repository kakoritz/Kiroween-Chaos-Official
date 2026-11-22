// Pattern miner (spec 8.1, TV3-C11): turns what a run left behind (events, ledger rows, laps, the Casebook's cases, outages, curse answers,
// journals) into patterns keyed by signature `stage + fault + consequence`, and keeps them in `.haunt/patterns.json` across runs and rounds.
// Rule-based and deterministic: the same events always mine the same patterns.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fnv1a32 } from '../shared/rng';
import { laneCases, normaliseFault, signatureOf, type Case } from '../tournament/signature';
import type { Ev } from '../tournament/rp';

export type PatternStatus = 'new' | 'suggested' | 'accepted' | 'applied' | 'verified' | 'rejected';
export type Shape = 'case' | 'hang' | 'retry_storm' | 'failure_rate' | 'curse' | 'outage';

/** Thresholds of spec 8.2: a count of 3, or any lost order, or more than 30 s of downtime. */
export const THRESHOLDS = { count: 3, lostOrders: 1, downtimeMs: 30_000 } as const;

export interface Ref { run: string; round?: number; order?: string; lane?: number }

export interface Evidence {
  run: string;
  round?: number;
  /** Event sequence numbers (or positions when the stream has no seq). */
  seq: number[];
  /** `path:line` references into lane journals. */
  journal: string[];
  /** A report link, e.g. `/api/waves/3/report`. */
  report?: string;
}

/** What one run's events say, before it is merged into the store. */
export interface MinedPattern {
  signature: string;
  stage: string;
  fault: string;
  consequence: string;
  shape: Shape;
  /** Occurrences that hurt: partly or lost cases, hangs, storms, failures. Solved cases are not counted. */
  count: number;
  lanes: number[];
  downtimeMs: number;
  lostOrders: number;
  repeats: number;
  points: number;
  firstSeen: Ref;
  evidence: Evidence;
  /** How the lanes that solved the same signature did it (the lessons that already cover it). */
  solvedBy: { lane: number; mechanism: string }[];
  unknown?: boolean;
  fingerprint?: string;
}

export interface Pattern {
  id: string;
  signature: string;
  stage: string;
  fault: string;
  consequence: string;
  shapes: Shape[];
  count: number;
  lanes: number[];
  downtimeMsTotal: number;
  lostOrders: number;
  repeats: number;
  points: number;
  firstSeen: Ref;
  lastSeen: Ref;
  status: PatternStatus;
  runs: string[];
  evidence: Evidence[];
  solvedBy: { lane: number; mechanism: string }[];
  unknown?: boolean;
  fingerprint?: string;
}

export const patternId = (signature: string): string => `p-${fnv1a32(signature).toString(16).padStart(8, '0')}`;

/** Does the pattern deserve a fix spec? */
export function qualifies(p: Pick<Pattern, 'count' | 'lostOrders' | 'downtimeMsTotal'>): boolean {
  return p.count >= THRESHOLDS.count || p.lostOrders >= THRESHOLDS.lostOrders || p.downtimeMsTotal > THRESHOLDS.downtimeMs;
}

/** Downtime cost, the sort key of a fix spec. */
export const costOf = (p: Pick<Pattern, 'downtimeMsTotal' | 'lostOrders' | 'repeats'>): number => p.downtimeMsTotal + p.lostOrders * 10_000 + p.repeats * 2_000;

export interface MineInput {
  run: string;
  round?: number;
  events: readonly Ev[];
  /** Journals of the lanes, for `path:line` evidence. */
  journals?: { lane: number; path: string }[];
  /** e.g. `/api/waves/3/report` */
  reportLink?: string;
  /** Cases already computed (the Casebook feed). Computed from the events when omitted. */
  cases?: readonly Case[];
}

const seqOf = (e: Ev, i: number): number => (typeof (e as { seq?: unknown }).seq === 'number' ? (e as { seq: number }).seq : i + 1);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function percentile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]! : 0;
}

/** Lines of a lane journal that mention the order and stage: `path:line`. */
export function journalRefs(path: string, order: string, stage: string, max = 3): string[] {
  if (!existsSync(path)) return [];
  const out: string[] = [];
  const lines = readFileSync(path, 'utf8').split('\n');
  for (let i = 0; i < lines.length && out.length < max; i++) {
    const l = lines[i]!;
    if (!l.includes(order) || !l.includes(stage)) continue;
    out.push(`${path.replace(/\\/g, '/')}:${i + 1}`);
  }
  return out;
}

export function minePatterns(input: MineInput): MinedPattern[] {
  const { run, round, events } = input;
  const out = new Map<string, MinedPattern>();
  const lanesIn = [...new Set(events.map((e) => e.lane).filter((l) => l !== undefined).map((l) => Number(l)))].filter((n) => Number.isInteger(n)).sort((a, b) => a - b);
  const journalFor = (lane: number, order: string, stage: string): string[] => (input.journals ?? []).filter((j) => j.lane === lane).flatMap((j) => journalRefs(j.path, order, stage));
  const add = (m: Omit<MinedPattern, 'signature' | 'evidence' | 'firstSeen' | 'solvedBy'> & { seq: number[]; first: Ref; journal?: string[] }): void => {
    const signature = signatureOf(m.stage, m.fault, m.consequence);
    const cur = out.get(signature);
    if (cur) {
      cur.count += m.count; cur.downtimeMs += m.downtimeMs; cur.lostOrders += m.lostOrders; cur.repeats += m.repeats; cur.points += m.points;
      cur.lanes = [...new Set([...cur.lanes, ...m.lanes])].sort((a, b) => a - b);
      cur.evidence.seq = [...new Set([...cur.evidence.seq, ...m.seq])].slice(0, 8);
      cur.evidence.journal = [...new Set([...cur.evidence.journal, ...(m.journal ?? [])])].slice(0, 6);
      if (m.unknown) { cur.unknown = true; cur.fingerprint = m.fingerprint; }
      return;
    }
    out.set(signature, {
      signature, stage: m.stage, fault: m.fault, consequence: m.consequence, shape: m.shape, count: m.count, lanes: m.lanes, downtimeMs: m.downtimeMs, lostOrders: m.lostOrders,
      repeats: m.repeats, points: m.points, firstSeen: m.first, solvedBy: [],
      evidence: { run, ...(round !== undefined ? { round } : {}), seq: m.seq.slice(0, 8), journal: (m.journal ?? []).slice(0, 6), ...(input.reportLink ? { report: input.reportLink } : {}) },
      ...(m.unknown ? { unknown: true, fingerprint: m.fingerprint } : {}),
    });
  };

  // ---- the Casebook's cases: the ones that hurt are patterns, the ones solved tell who already copes ----
  const cases = input.cases ?? lanesIn.flatMap((l) => laneCases(events, l, round ?? 1));
  const caseSeq = new Map<string, number[]>();
  // Evidence for a case: the chaos events of that fault on the lane, in the order's neighbourhood.
  events.forEach((e, i) => {
    if (e.type !== 'chaos') return;
    const f = normaliseFault(e.detail as Record<string, any>);
    const k = `${Number(e.lane)}|${f}`;
    caseSeq.set(k, [...(caseSeq.get(k) ?? []), seqOf(e, i)]);
  });
  const repeatSeq = new Map<string, number[]>();
  events.forEach((e, i) => { if (e.type === 'repeat') repeatSeq.set(`${Number(e.lane)}|${String(e.order)}`, [...(repeatSeq.get(`${Number(e.lane)}|${String(e.order)}`) ?? []), seqOf(e, i)]); });
  const failSeq = new Map<string, number[]>();
  events.forEach((e, i) => { if (e.type === 'order_failed' || e.type === 'stage_fail') failSeq.set(`${Number(e.lane)}|${String(e.order)}`, [...(failSeq.get(`${Number(e.lane)}|${String(e.order)}`) ?? []), seqOf(e, i)]); });
  for (const c of cases) {
    if (c.outcome === 'solved') continue;
    const seq = [...(caseSeq.get(`${c.lane}|${c.fault}`) ?? []).slice(0, 2), ...(repeatSeq.get(`${c.lane}|${c.order}`) ?? []).slice(0, 2), ...(failSeq.get(`${c.lane}|${c.order}`) ?? []).slice(0, 2)];
    add({
      stage: c.stage, fault: c.fault, consequence: c.consequence, shape: 'case', count: 1, lanes: [c.lane], downtimeMs: c.costMs, lostOrders: c.outcome === 'lost' ? 1 : 0,
      repeats: c.kinds?.length ?? 0, points: c.costPoints, first: { run, ...(round !== undefined ? { round } : {}), order: c.order, lane: c.lane }, seq, journal: journalFor(c.lane, c.order, c.stage),
      ...(c.unknown ? { unknown: true, fingerprint: c.fingerprint } : {}),
    });
  }
  for (const p of out.values()) {
    const solved = cases.filter((c) => c.signature === p.signature && c.outcome === 'solved' && c.mechanism !== 'none' && c.mechanism !== 'absorbed');
    p.solvedBy = [...new Map(solved.map((c) => [c.lane, { lane: c.lane, mechanism: c.mechanism }])).values()];
  }

  // ---- time shape: hangs (a stage stuck longer than its p95) ----
  const started = new Map<string, { ts: number; seq: number }>();
  const durs = new Map<string, { lane: number; order: string; ms: number; seq: number }[]>();
  events.forEach((e, i) => {
    if (typeof e.ts !== 'number' || typeof e.stage !== 'string') return;
    const k = `${Number(e.lane)}|${String(e.order)}|${e.stage}`;
    if (e.type === 'stage_start') started.set(k, { ts: e.ts, seq: seqOf(e, i) });
    else if (e.type === 'stage_done' && started.has(k) && !(e.detail as Record<string, any> | undefined)?.skipped) {
      const s = started.get(k)!;
      durs.set(e.stage, [...(durs.get(e.stage) ?? []), { lane: Number(e.lane), order: String(e.order), ms: e.ts - s.ts, seq: s.seq }]);
      started.delete(k);
    }
  });
  for (const [stage, list] of durs) {
    if (list.length < 8) continue;
    const ms = list.map((x) => x.ms);
    const p95 = percentile(ms, 0.95);
    const med = percentile(ms, 0.5);
    for (const x of list.filter((y) => y.ms > p95 && y.ms > 3 * med && y.ms > 2000)) {
      add({ stage, fault: 'hang', consequence: 'stuck', shape: 'hang', count: 1, lanes: [x.lane], downtimeMs: Math.round(x.ms - med), lostOrders: 0, repeats: 0, points: 0, first: { run, ...(round !== undefined ? { round } : {}), order: x.order, lane: x.lane }, seq: [x.seq], journal: journalFor(x.lane, x.order, stage) });
    }
  }

  // ---- time shape: retry storms (three failed attempts at one stage of one order) ----
  const fails = new Map<string, { lane: number; order: string; stage: string; n: number; seq: number[]; fault: string }>();
  const lastFault = new Map<number, string>();
  events.forEach((e, i) => {
    const lane = Number(e.lane);
    if (e.type === 'chaos') lastFault.set(lane, normaliseFault(e.detail as Record<string, any>));
    if (e.type !== 'stage_fail' || typeof e.stage !== 'string' || (e.detail as Record<string, any> | undefined)?.degraded) return;
    const k = `${lane}|${String(e.order)}|${e.stage}`;
    const cur = fails.get(k) ?? { lane, order: String(e.order), stage: e.stage, n: 0, seq: [], fault: lastFault.get(lane) ?? 'errors' };
    cur.n++; cur.seq.push(seqOf(e, i));
    fails.set(k, cur);
  });
  for (const f of fails.values()) {
    if (f.n < 3) continue;
    add({ stage: f.stage, fault: f.fault, consequence: 'retry_storm', shape: 'retry_storm', count: 1, lanes: [f.lane], downtimeMs: 0, lostOrders: 0, repeats: 0, points: 0, first: { run, ...(round !== undefined ? { round } : {}), order: f.order, lane: f.lane }, seq: f.seq, journal: journalFor(f.lane, f.order, f.stage) });
  }

  // ---- time shape: an endpoint that fails often (failed attempts over stage starts) ----
  const starts = new Map<string, number>();
  const failed = new Map<string, { n: number; seq: number[]; lanes: Set<number> }>();
  events.forEach((e, i) => {
    if (typeof e.stage !== 'string') return;
    if (e.type === 'stage_start') starts.set(e.stage, (starts.get(e.stage) ?? 0) + 1);
    if (e.type === 'stage_fail' && !(e.detail as Record<string, any> | undefined)?.degraded) {
      const cur = failed.get(e.stage) ?? { n: 0, seq: [], lanes: new Set<number>() };
      cur.n++; cur.seq.push(seqOf(e, i)); cur.lanes.add(Number(e.lane)); failed.set(e.stage, cur);
    }
  });
  for (const [stage, f] of failed) {
    const rate = f.n / Math.max(1, starts.get(stage) ?? 0);
    if (f.n < 3 || rate < 0.3) continue;
    add({ stage, fault: 'endpoint_failure_rate', consequence: 'degraded', shape: 'failure_rate', count: f.n, lanes: [...f.lanes], downtimeMs: 0, lostOrders: 0, repeats: 0, points: 0, first: { run, ...(round !== undefined ? { round } : {}), lane: [...f.lanes][0] }, seq: f.seq });
  }

  // ---- curse handling: answers that were swallowed or crashed ----
  events.forEach((e, i) => {
    if (e.type !== 'curse_response') return;
    const d = (e.detail ?? {}) as Record<string, any>;
    if (d.class !== 'swallowed' && d.class !== 'crashed') return;
    add({ stage: String(d.stage ?? e.stage ?? 'unknown'), fault: `curse_${String(d.curse ?? 'unknown')}`, consequence: d.class, shape: 'curse', count: 1, lanes: [Number(e.lane)], downtimeMs: 0, lostOrders: d.class === 'crashed' ? 1 : 0, repeats: 0, points: 0, first: { run, ...(round !== undefined ? { round } : {}), order: String(d.order ?? e.order ?? ''), lane: Number(e.lane) }, seq: [seqOf(e, i)] });
  });

  // ---- outage data: the windows the lanes sat through ----
  events.forEach((e, i) => {
    if (e.type !== 'outage') return;
    const d = (e.detail ?? {}) as Record<string, any>;
    add({ stage: String(e.stage ?? 'unknown'), fault: String(d.fault ?? 'endpoint_down'), consequence: 'outage', shape: 'outage', count: 1, lanes: [Number(e.lane)], downtimeMs: num(d.outageMs), lostOrders: 0, repeats: 0, points: 0, first: { run, ...(round !== undefined ? { round } : {}), lane: Number(e.lane) }, seq: [seqOf(e, i)] });
  });

  return [...out.values()].sort((a, b) => b.downtimeMs + b.lostOrders * 10_000 - (a.downtimeMs + a.lostOrders * 10_000) || a.signature.localeCompare(b.signature));
}

// ------------------------------------------------------------------------------------------------------------------ store

export interface PatternChange { pattern: Pattern; kind: 'new' | 'updated' | 'status' | 'regressed' }

/** `file` is a path, or an empty string for a store that lives in memory (the mock fixtures). */
export class PatternStore {
  private mem: Pattern[] = [];
  constructor(readonly file: string) {}

  list(): Pattern[] {
    if (this.file === '') return this.mem;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { patterns?: Pattern[] };
      return Array.isArray(raw.patterns) ? raw.patterns : [];
    } catch { return []; }
  }

  private save(ps: Pattern[]): void {
    if (this.file === '') { this.mem = ps; return; }
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify({ version: 1, patterns: ps }, null, 2) + '\n');
  }

  get(id: string): Pattern | undefined { return this.list().find((p) => p.id === id); }

  /** Merge one run's mined patterns. The same `runKey` is never counted twice. A verified pattern that shows up again is `new` again (regressed). */
  ingest(mined: readonly MinedPattern[], runKey: string): PatternChange[] {
    const ps = this.list();
    const changes: PatternChange[] = [];
    for (const m of mined) {
      const id = patternId(m.signature);
      const cur = ps.find((p) => p.id === id);
      const last: Ref = { ...m.firstSeen };
      if (!cur) {
        const p: Pattern = {
          id, signature: m.signature, stage: m.stage, fault: m.fault, consequence: m.consequence, shapes: [m.shape], count: m.count, lanes: [...m.lanes], downtimeMsTotal: m.downtimeMs,
          lostOrders: m.lostOrders, repeats: m.repeats, points: m.points, firstSeen: m.firstSeen, lastSeen: last, status: 'new', runs: [runKey], evidence: [m.evidence], solvedBy: m.solvedBy,
          ...(m.unknown ? { unknown: true, fingerprint: m.fingerprint } : {}),
        };
        ps.push(p); changes.push({ pattern: p, kind: 'new' });
        continue;
      }
      if (cur.runs.includes(runKey)) continue;
      cur.runs.push(runKey);
      cur.count += m.count; cur.downtimeMsTotal += m.downtimeMs; cur.lostOrders += m.lostOrders; cur.repeats += m.repeats; cur.points += m.points;
      cur.lanes = [...new Set([...cur.lanes, ...m.lanes])].sort((a, b) => a - b);
      cur.shapes = [...new Set([...cur.shapes, m.shape])];
      cur.lastSeen = last;
      cur.evidence = [...cur.evidence, m.evidence].slice(-6);
      cur.solvedBy = [...new Map([...cur.solvedBy, ...m.solvedBy].map((s) => [s.lane, s])).values()];
      let kind: PatternChange['kind'] = 'updated';
      if (cur.status === 'verified') { cur.status = 'new'; kind = 'regressed'; }
      changes.push({ pattern: cur, kind });
    }
    this.save(ps);
    return changes;
  }

  setStatus(id: string, status: PatternStatus): Pattern | undefined {
    const ps = this.list();
    const p = ps.find((x) => x.id === id);
    if (!p) return undefined;
    p.status = status;
    this.save(ps);
    return p;
  }

  setStatuses(ids: readonly string[], status: PatternStatus): Pattern[] {
    const ps = this.list();
    const hit = ps.filter((p) => ids.includes(p.id));
    for (const p of hit) p.status = status;
    this.save(ps);
    return hit;
  }

  reset(): void { this.save([]); }
}

/** The `pattern` event of V1_2 section 5/6. */
export const patternEvent = (p: Pattern, kind?: PatternChange['kind']): { type: 'pattern'; detail: Record<string, unknown> } => ({
  type: 'pattern',
  detail: {
    id: p.id, signature: p.signature, count: p.count, downtimeMsTotal: p.downtimeMsTotal, status: p.status, lostOrders: p.lostOrders, repeats: p.repeats, lanes: p.lanes,
    qualifies: qualifies(p), ...(kind ? { change: kind } : {}), ...(p.unknown ? { unknown: true, fingerprint: p.fingerprint } : {}),
  },
});
