// Event stream validator: contract/events.schema.json plus every ordering rule of contract/PROTOCOL.md.
// Used by `npm run validate:events`, the contract test suite (mock and live) and the fixture generator.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
import Ajv2020 from 'ajv/dist/2020.js';
import { APPS, ALL_TYPES, GLOBAL_TYPES, type AppId, type HauntEvent } from '@haunt/shared';

/** The orders stage ids before v1.2 (V1_2.md section 1). A recorded stream that uses them is checked against this list. */
export const LEGACY_ORDERS_STAGE_IDS: readonly string[] = ['intake', 'account', 'payment', 'confirmation', 'dispatch', 'updates', 'tracking', 'handoff'];

/** Stage ids a stream is checked against: the hello's `stages` list when present, the legacy list for an old orders stream, else the app's list. */
function stageIdsFor(events: readonly HauntEvent[], app: AppId): string[] {
  const hello = events.find((e) => e.type === 'hello') as (HauntEvent & { stages?: unknown }) | undefined;
  if (Array.isArray(hello?.stages) && hello!.stages.length > 0) return hello!.stages.map((s: { id?: unknown }) => String(s?.id));
  if (app === 'orders' && events.some((e) => e.stage === 'intake')) return [...LEGACY_ORDERS_STAGE_IDS];
  return APPS[app].stages.map((s) => s.id);
}

export interface Violation {
  rule: string;
  seq: number;
  type: string;
  message: string;
}

export interface ValidateOptions {
  /** Require the stream to end with `wave_end` (fixtures do; a live capture taken mid-wave does not). */
  requireWaveEnd?: boolean;
  /** Skip the schema pass (only ordering rules). */
  skipSchema?: boolean;
}

export function findRepoRoot(start = process.cwd()): string {
  let dir = resolve(start);
  for (let i = 0; i < 8; i++) {
    if (existsSync(resolve(dir, 'contract', 'events.schema.json'))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error(`could not find contract/events.schema.json above ${start}`);
}

let cached: ((ev: unknown) => boolean) & { errors?: any } | null = null;
const perType = new Map<string, ((ev: unknown) => boolean) & { errors?: any }>();

function ajvFor(): any {
  const schema = JSON.parse(readFileSync(resolve(findRepoRoot(), 'contract', 'events.schema.json'), 'utf8'));
  const Ctor: any = (Ajv2020 as any).default ?? Ajv2020;
  const ajv = new Ctor({ allErrors: false, strict: true, strictRequired: false });
  ajv.addSchema(schema);
  return { ajv, schema };
}

/** Validates one event against the schema. Returns an empty array when valid. */
export function schemaErrors(ev: unknown): string[] {
  if (!cached) {
    const { ajv, schema } = ajvFor();
    cached = ajv.getSchema(schema.$id);
    for (const t of ALL_TYPES) {
      const v = ajv.getSchema(`${schema.$id}#/$defs/${t}`);
      if (v) perType.set(t, v);
    }
  }
  const type = (ev as any)?.type;
  const v = perType.get(type);
  if (!v) return [`unknown event type ${JSON.stringify(type)}`];
  if (v(ev)) return [];
  return (v.errors ?? []).map((e: any) => `${e.instancePath || '(root)'} ${e.message}`);
}

/** Full-oneOf check (slower, used by tests to prove each event matches exactly one definition). */
export function matchesOneOf(ev: unknown): boolean {
  schemaErrors({ type: 'hello' });
  return cached!(ev);
}

const IGNORABLE = new Set(['score', 'effect', 'repeat', 'chaos', 'chaos_absorbed', 'breaker', 'outage', 'curse_start', 'curse_end', 'curse_response']);
const CLOSERS = new Set(['chaos_absorbed', 'stage_fail', 'process_dead', 'recover_start', 'lane_halted', 'order_parked', 'order_failed', 'order_quarantined', 'order_abandoned']);

type LaneState = 'idle' | 'running' | 'failed' | 'degraded_failed' | 'continuing' | 'dead' | 'halted';

interface Lane {
  ready: boolean;
  state: LaneState;
  order?: string;
  doneIdx: number;
  open?: { stage: string; idx: number; killed: boolean };
  expect?: 'order_done' | 'recover' | 'order_start_same' | 'stage_start_next';
  expectOrder?: string;
  stack: string[];
  pendingChaos: number;
  parked: Set<string>;
  parkedIdx: Map<string, number>;
  finished: Set<string>;
  score: number;
  prev?: HauntEvent;
  prevSig?: HauntEvent;
  dead?: { ts: number; restartInMs: number };
  breaker: Map<string, string>;
  bossChaos: number;
  stageStarts: Map<string, number>;
  halted: boolean;
  // Contract v1.1 state.
  walk?: { ts: number; ms: number };
  grab?: { ts: number; ms: number };
  gap?: { ts: number; ms: number };
  awaitReview?: { order: string; cancelled: boolean };
  rv: { count: number; sum: number };
  counts: { done: number; cancelled: number; quarantined: number; abandoned: number };
  doneMs: number[];
  fails: Map<string, number>;
  orderStartTs: number;
  decision?: { order: string; options: string[]; defaultChoice: string };
  res?: { choice: string; effects: Set<string> };
  /** Open recovery intervals: order to the index of the stage that failed first. Closed by a real completion of that stage or a later one. */
  ivals: Map<string, number>;
  closedInterval: boolean;
  bossHalf?: string;
}

const newLane = (): Lane => ({
  ready: false, state: 'idle', doneIdx: -1, stack: [], pendingChaos: 0, parked: new Set(), parkedIdx: new Map(), finished: new Set(), score: 0,
  breaker: new Map(), bossChaos: 0, stageStarts: new Map(), halted: false,
  rv: { count: 0, sum: 0 }, counts: { done: 0, cancelled: 0, quarantined: 0, abandoned: 0 }, doneMs: [], fails: new Map(),
  orderStartTs: 0, ivals: new Map(), closedInterval: false,
});

/** Contract v1.1 section 8: fault id to creature. */
const WORLD_FAULTS: Record<string, string> = {
  sms_down: 'gargoyle', app_down: 'imp', updates_down: 'goblin', wrong_address: 'scarecrow', delay: 'scarecrow', weather: 'storm_crow', road_hazard: 'pothole_imp', out_of_gas: 'fuel_wraith', not_on_truck: 'lost_parcel_ghoul',
  no_answer: 'black_cat', gated_house: 'black_cat', car_accident: 'phantom_car', order_typo: 'prankster',
};
const WORLD_CREATURES = new Set(['scarecrow', 'black_cat', 'phantom_car', 'prankster', 'storm_crow', 'pothole_imp', 'fuel_wraith', 'lost_parcel_ghoul']);
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
/** Timestamps are whole ms, so gaps may be off by one. */
const TOL = 1;

export function validateEvents(events: HauntEvent[], opts: ValidateOptions = {}): Violation[] {
  const out: Violation[] = [];
  const bad = (rule: string, ev: HauntEvent, message: string): void => {
    if (out.length < 500) out.push({ rule, seq: ev?.seq ?? -1, type: ev?.type ?? '?', message });
  };

  if (events.length === 0) return [{ rule: 'R1', seq: -1, type: '-', message: 'empty stream' }];

  let waveNo = 0;
  let waveOpen = false;
  let app: AppId = 'orders';
  let lanes = new Map<number, Lane>();
  let lastSeq = -1;
  let lastTs = -1;
  let boss: { fault: string; warnTs: number; startsInMs: number; started: boolean; startTs: number } | null = null;
  let stageIds: string[] = stageIdsFor(events, 'orders');
  let sawWaveStart = false;
  let minor = 0;
  // Tournament state (V1_2 sections 2 and 3, rules 57 to 61).
  let tourneyRound = 0;
  let tourneyLanes = new Set<number>();
  let eliminatedNow = new Set<number>();
  const fallenLanes = new Set<number>();
  const cursesOpen = new Set<string>();
  let awaiting = false;

  /** Rule 41: the lap object of order_done and order_failed. */
  const checkLap = (ev: HauntEvent, d: Record<string, any>, l: Lane): void => {
    const lap = d.lap;
    if (!lap || typeof lap !== 'object') { bad('R41', ev, `${ev.type} without detail.lap`); return; }
    for (const k of ['ms', 'workMs', 'downtimeMs']) if (!num(lap[k]) || lap[k] < 0) bad('R41', ev, `lap.${k} is missing or negative`);
    for (const k of ['attempts', 'retries']) if (!Number.isInteger(lap[k]) || lap[k] < 0) bad('R41', ev, `lap.${k} is missing or not a non-negative integer`);
    if (num(lap.ms) && num(lap.workMs) && lap.workMs > lap.ms + TOL) bad('R41', ev, `lap.workMs ${lap.workMs} is above lap.ms ${lap.ms}`);
    if (!Array.isArray(lap.issues)) { bad('R41', ev, 'lap.issues must be an array'); }
    if (!Array.isArray(lap.recoveries)) bad('R41', ev, 'lap.recoveries must be an array');
    const order = ev.order as string;
    if (Array.isArray(lap.issues)) {
      const seen = new Set<string>();
      for (const it of lap.issues) {
        if (!it || !stageIds.includes(it.stage) || !Number.isInteger(it.count) || it.count < 1) { bad('R41', ev, `lap.issues entry ${JSON.stringify(it)} needs a known stage and a count of 1 or more`); continue; }
        if (seen.has(it.stage)) bad('R41', ev, `lap.issues lists stage ${it.stage} twice`);
        seen.add(it.stage);
      }
      for (const [k, n] of l.fails) {
        const [o, s] = k.split('|');
        if (o !== order) continue;
        const got = lap.issues.find((it: any) => it?.stage === s)?.count ?? 0;
        if (got < n) bad('R41', ev, `lap.issues counts ${got} at ${s} but ${n} stage_fail events happened there`);
      }
    }
    if (num(lap.attempts)) {
      let starts = 0;
      for (const [k, n] of l.stageStarts) if (k.startsWith(`${order}|`)) starts += n;
      if (lap.attempts < starts) bad('R41', ev, `lap.attempts ${lap.attempts} is below the ${starts} stage_start events of the order`);
    }
    if (Array.isArray(lap.recoveries)) {
      for (const r of lap.recoveries) if (!r || typeof r.action !== 'string' || !num(r.ms) || r.ms < 0 || !stageIds.includes(r.stage)) bad('R41', ev, `lap.recoveries entry ${JSON.stringify(r)} is malformed`);
    }
  };

  /** Rule 43: the v1.1 wave summary of one lane. */
  const checkSummary = (ev: HauntEvent, n: number, l: Lane, s: any, stopped: boolean): void => {
    if (!s || typeof s !== 'object') return;
    const need = (k: string, ok: boolean): boolean => { if (!ok) bad('R43', ev, `lane ${n} summary.${k} is missing or invalid`); return ok; };
    const o = s.orders;
    const okOrders = need('orders', !!o && ['done', 'cancelled', 'parked', 'quarantined', 'abandoned'].every((k) => Number.isInteger(o[k]) && o[k] >= 0));
    need('totalMs', num(s.totalMs) && s.totalMs >= 0);
    need('avgMs', s.avgMs === undefined || num(s.avgMs));
    need('retries', Number.isInteger(s.retries) && s.retries >= 0);
    need('downtimeMs', num(s.downtimeMs) && s.downtimeMs >= 0);
    need('issuesByStage', !!s.issuesByStage && typeof s.issuesByStage === 'object' && Object.entries(s.issuesByStage).every(([k, v]) => stageIds.includes(k) && Number.isInteger(v) && (v as number) >= 0));
    const st = s.stars;
    const okStars = need('stars', !!st && num(st.sum) && num(st.max) && Number.isInteger(st.count) && num(st.avg));
    need('rating', ['Five-Star Crypt', 'Respectable', 'Spooky Service', 'Cursed'].includes(s.rating));
    if (okOrders) {
      const done = o.done as number;
      if (done > 0) {
        need('bestMs', num(s.bestMs));
        need('slowestMs', num(s.slowestMs));
        need('avgMs', num(s.avgMs));
        if (num(s.bestMs) && num(s.slowestMs) && s.bestMs > s.slowestMs) bad('R43', ev, `lane ${n} bestMs ${s.bestMs} is above slowestMs ${s.slowestMs}`);
        if (num(s.bestMs) && num(s.avgMs) && num(s.slowestMs) && (s.avgMs < s.bestMs - TOL || s.avgMs > s.slowestMs + TOL)) bad('R43', ev, `lane ${n} avgMs ${s.avgMs} is outside bestMs..slowestMs`);
      } else if (s.bestMs !== undefined || s.slowestMs !== undefined) {
        bad('R43', ev, `lane ${n} has bestMs/slowestMs but no completed order`);
      }
      if (!stopped) {
        if (o.done !== l.counts.done) bad('R43', ev, `lane ${n} summary.orders.done ${o.done} but ${l.counts.done} order_done events`);
        if (o.cancelled !== l.counts.cancelled) bad('R43', ev, `lane ${n} summary.orders.cancelled ${o.cancelled} but ${l.counts.cancelled} order_failed events`);
        if (o.quarantined !== l.counts.quarantined) bad('R43', ev, `lane ${n} summary.orders.quarantined ${o.quarantined} but ${l.counts.quarantined} order_quarantined events`);
        if (o.abandoned !== l.counts.abandoned) bad('R43', ev, `lane ${n} summary.orders.abandoned ${o.abandoned} but ${l.counts.abandoned} order_abandoned events`);
        if (done > 0 && l.doneMs.length) {
          if (num(s.bestMs) && s.bestMs !== Math.min(...l.doneMs)) bad('R43', ev, `lane ${n} bestMs ${s.bestMs} is not the fastest done lap ${Math.min(...l.doneMs)}`);
          if (num(s.slowestMs) && s.slowestMs !== Math.max(...l.doneMs)) bad('R43', ev, `lane ${n} slowestMs ${s.slowestMs} is not the slowest done lap ${Math.max(...l.doneMs)}`);
        }
      }
    }
    if (okStars) {
      if (st.sum > st.max) bad('R43', ev, `lane ${n} stars.sum ${st.sum} is above stars.max ${st.max}`);
      if (st.max !== 5 * st.count) bad('R43', ev, `lane ${n} stars.max ${st.max} should be 5 x count ${st.count}`);
      if (st.count > 0) {
        const avg = st.sum / st.count;
        if (Math.abs(st.avg - avg) > 0.05) bad('R43', ev, `lane ${n} stars.avg ${st.avg} should be ${avg.toFixed(2)}`);
        const want = avg >= 4.5 ? 'Five-Star Crypt' : avg >= 3.5 ? 'Respectable' : avg >= 2.5 ? 'Spooky Service' : 'Cursed';
        if (s.rating !== want) bad('R43', ev, `lane ${n} rating ${s.rating} should be ${want} for avg ${avg.toFixed(2)}`);
      }
      if (!stopped && (st.count !== l.rv.count || st.sum !== l.rv.sum)) bad('R43', ev, `lane ${n} stars ${st.sum}/${st.count} do not match the reviews seen ${l.rv.sum}/${l.rv.count}`);
    }
  };

  const lane = (n: number): Lane => {
    let l = lanes.get(n);
    if (!l) { l = newLane(); lanes.set(n, l); }
    return l;
  };

  events.forEach((ev, i) => {
    if (!opts.skipSchema) {
      for (const m of schemaErrors(ev)) bad('schema', ev, m);
    }
    if (typeof ev.seq === 'number') {
      if (ev.seq <= lastSeq) bad('seq', ev, `seq ${ev.seq} does not increase (previous ${lastSeq})`);
      lastSeq = ev.seq;
    }
    if (typeof ev.ts === 'number') {
      if (ev.ts < lastTs) bad('ts', ev, `ts ${ev.ts} goes back from ${lastTs}`);
      lastTs = Math.max(lastTs, ev.ts);
    }
    const t = ev.type;
    const d = (ev.detail ?? {}) as Record<string, any>;

    // Rule 1 and 16: stream and envelope.
    if (i === 0 && t !== 'hello') bad('R1', ev, 'first event must be hello');
    if (i > 0 && t === 'hello') bad('R1', ev, 'hello only once, as the first event');
    if (!ALL_TYPES.includes(t)) return;
    const isGlobal = (GLOBAL_TYPES as readonly string[]).includes(t);
    if (isGlobal && ev.lane !== undefined) bad('R16', ev, 'global events must not carry lane');
    if (!isGlobal && ev.lane === undefined) { bad('R16', ev, 'lane event without lane'); return; }
    if (t !== 'hello' && t !== 'reset' && t !== 'intensity' && ev.wave === undefined) bad('R16', ev, 'missing wave');

    switch (t) {
      case 'hello': minor = num((ev as any).contractMinor) ? (ev as any).contractMinor : 0; return;
      case 'reset':
        lanes = new Map(); waveOpen = false; boss = null;
        return;
      case 'wave_start': {
        if (waveOpen) bad('R1', ev, 'wave_start while the previous wave has not ended');
        waveOpen = true; sawWaveStart = true; awaiting = false;
        waveNo = ev.wave ?? waveNo + 1;
        app = (d.app as AppId) in APPS ? (d.app as AppId) : 'orders';
        stageIds = stageIdsFor(events, app);
        lanes = new Map();
        boss = null;
        return;
      }
      case 'wave_end': {
        if (!waveOpen) { bad('R1', ev, 'wave_end without wave_start'); return; }
        if (ev.wave !== waveNo) bad('R1', ev, `wave_end carries wave ${ev.wave}, expected ${waveNo}`);
        for (const [n, l] of lanes) {
          if (!d.stopped) {
            if (l.pendingChaos > 0) bad('R7', ev, `lane ${n} has ${l.pendingChaos} chaos event(s) with no consequence before wave_end`);
            if (l.state === 'dead') bad('R6', ev, `lane ${n} is still dead at wave_end`);
            if (l.stack.length) bad('R13', ev, `lane ${n} has unclosed recover_start at wave_end: ${l.stack.join(',')}`);
            if (l.order && l.state !== 'halted') bad('R4', ev, `lane ${n} still has order ${l.order} in flight at wave_end`);
          }
        }
        for (const n of lanes.keys()) if (d.summary && d.summary[n] === undefined && d.summary[String(n)] === undefined) bad('R1', ev, `wave_end summary misses lane ${n}`);
        if (minor >= 1) {
          for (const [n, l] of lanes) {
            if (!d.stopped && l.awaitReview) bad('R42', ev, `lane ${n} never got a review for ${l.awaitReview.order}`);
            if (!d.stopped && l.decision) bad('R44', ev, `lane ${n} has an unanswered decision_needed for ${l.decision.order}`);
            if (!d.stopped && l.bossHalf) bad('R46', ev, `lane ${n} has "${l.bossHalf}" without its partner score`);
            checkSummary(ev, n, l, d.summary?.[n] ?? d.summary?.[String(n)], !!d.stopped);
          }
        }
        waveOpen = false;
        return;
      }
      case 'boss_warning':
        if (!waveOpen) bad('R10', ev, 'boss_warning outside a wave');
        boss = { fault: d.boss, warnTs: ev.ts, startsInMs: d.startsInMs ?? 0, started: false, startTs: 0 };
        return;
      case 'boss_start': {
        if (!boss || boss.fault !== d.boss) { bad('R10', ev, 'boss_start without a matching boss_warning'); return; }
        if (ev.ts - boss.warnTs < boss.startsInMs * 0.95 - 5) bad('R10', ev, `boss_start came ${ev.ts - boss.warnTs} ms after the warning, expected about ${boss.startsInMs}`);
        boss.started = true; boss.startTs = ev.ts;
        for (const l of lanes.values()) l.bossChaos = 0;
        return;
      }
      case 'boss_end': {
        if (!boss || !boss.started || boss.fault !== d.boss) { bad('R10', ev, 'boss_end without boss_start'); return; }
        for (const [n, l] of lanes) {
          const hit = l.bossChaos;
          if (hit !== 1 && !(l.halted || l.state === 'halted')) bad('R10', ev, `lane ${n} received ${hit} boss chaos events, expected 1`);
          if (l.pendingChaos > 0 || l.state === 'dead' || l.stack.length) bad('R10', ev, `boss_end before lane ${n} settled`);
        }
        boss = null;
        return;
      }
      case 'intensity': {
        // V1_2 section 5: the dial can move at any time, also between waves. Level 1 to 11.
        if (!(Number.isInteger(d.level) && d.level >= 1 && d.level <= 11)) bad('R56', ev, `intensity level ${d.level} is not an integer from 1 to 11`);
        return;
      }
      case 'pattern': {
        // Rule 64 (V1_2 section 5): a pattern names its signature, a count and one of the six statuses.
        if (typeof d.id !== 'string' || typeof d.signature !== 'string' || d.signature.split(' + ').length !== 3) bad('R64', ev, 'pattern needs an id and a signature "stage + fault + consequence"');
        if (!['new', 'suggested', 'accepted', 'applied', 'verified', 'rejected'].includes(d.status)) bad('R64', ev, 'pattern status ' + d.status + ' is not one of the six');
        if (!Number.isInteger(d.count) || d.count < 0 || typeof d.downtimeMsTotal !== 'number') bad('R64', ev, 'pattern needs a count and downtimeMsTotal');
        return;
      }
      case 'spec_written': {
        if (typeof d.runId !== 'string' || typeof d.path !== 'string' || !Array.isArray(d.patterns)) bad('R65', ev, 'spec_written needs runId, path and patterns[]');
        return;
      }
      case 'round_start': {
        // V1_2 section 2: round_start comes once per round, inside its wave, naming the live lanes.
        if (!Number.isInteger(d.round) || d.round < 1) bad('R57', ev, 'round_start needs a round number');
        if (!Array.isArray(d.lanes) || d.lanes.length === 0) bad('R57', ev, 'round_start needs the live lanes');
        else if (d.lanes.some((n: unknown) => !Number.isInteger(n) || (n as number) < 1 || (n as number) > 5)) bad('R57', ev, 'round_start lanes must be 1 to 5');
        if (d.round <= tourneyRound) bad('R57', ev, 'round_start round ' + d.round + ' does not follow round ' + tourneyRound);
        tourneyRound = d.round;
        tourneyLanes = new Set<number>(Array.isArray(d.lanes) ? d.lanes : []);
        return;
      }
      case 'round_end': {
        if (d.round !== tourneyRound) bad('R57', ev, 'round_end for round ' + d.round + ' but round ' + tourneyRound + ' is running');
        const st = Array.isArray(d.standings) ? d.standings : [];
        if (st.length === 0) bad('R58', ev, 'round_end needs standings');
        for (const s of st) {
          if (!Number.isInteger(s?.lane) || typeof s?.rp !== 'number' || !Number.isInteger(s?.rank)) bad('R58', ev, 'standing ' + JSON.stringify(s) + ' needs lane, rp and rank');
          else if (!tourneyLanes.has(s.lane)) bad('R58', ev, 'standing for lane ' + s.lane + ' which is not live in round ' + tourneyRound);
        }
        const ranks = st.map((s: { rank: number }) => s.rank).sort((a: number, b: number) => a - b);
        if (ranks.some((r: number, i: number) => r !== i + 1)) bad('R58', ev, 'standing ranks must be 1..n');
        if (d.eliminated !== undefined) {
          if (!tourneyLanes.has(d.eliminated)) bad('R59', ev, 'eliminated lane ' + d.eliminated + ' was not live');
          eliminatedNow = new Set<number>(Array.isArray(d.eliminatedLanes) ? d.eliminatedLanes : [d.eliminated]);
          for (const n of eliminatedNow) { if (fallenLanes.has(n)) bad('R59', ev, 'lane ' + n + ' was eliminated twice'); fallenLanes.add(n); }
        }
        if (!Array.isArray(d.lessons) || !Array.isArray(d.cases)) bad('R58', ev, 'round_end carries lessons[] and cases[]');
        awaiting = false;
        return;
      }
      case 'lane_eliminated': {
        if (!eliminatedNow.has(d.lane)) bad('R59', ev, 'lane_eliminated for lane ' + d.lane + ' that round_end did not drop');
        if (typeof d.stage !== 'string' || typeof d.epitaph !== 'string') bad('R59', ev, 'lane_eliminated needs stage and epitaph');
        return;
      }
      case 'curse_start': {
        // Rule 66 (V1_2 section 5): a curse names its id, one of the five kinds and an endpoint; a curse_end names a curse that was started.
        if (typeof d.id !== 'string' || !['404', 'slow', 'flaky500', 'clock_skew', 'rate_limit'].includes(d.kind) || typeof d.endpoint !== 'string') bad('R66', ev, 'curse_start needs an id, a kind (404, slow, flaky500, clock_skew, rate_limit) and an endpoint');
        else cursesOpen.add(String(ev.lane) + '|' + d.id);
        return;
      }
      case 'curse_end': {
        if (!cursesOpen.delete(String(ev.lane) + '|' + d.id)) bad('R66', ev, 'curse_end for a curse that is not in force');
        return;
      }
      case 'curse_response': {
        if (!['handled', 'reported', 'swallowed', 'crashed'].includes(d.class)) bad('R66', ev, 'curse_response class must be handled, reported, swallowed or crashed');
        if (!['404', 'slow', 'flaky500', 'clock_skew', 'rate_limit'].includes(d.curse) || typeof d.order !== 'string' || typeof d.stage !== 'string') bad('R66', ev, 'curse_response needs the curse kind, the order and the stage');
        return;
      }
      case 'case': {
        // Rule 63: a case is one lane meeting one edge case. Its outcome is solved, partly or lost.
        if (typeof d.signature !== 'string' || d.signature.split(' + ').length !== 3) bad('R63', ev, 'case signature must be "stage + fault + consequence"');
        if (!['solved', 'partly', 'lost'].includes(d.outcome)) bad('R63', ev, 'case outcome must be solved, partly or lost');
        if (!Number.isInteger(d.round) || typeof d.order !== 'string' || typeof d.costMs !== 'number' || typeof d.costPoints !== 'number') bad('R63', ev, 'case needs round, order, costMs and costPoints');
        if (tourneyLanes.size && !tourneyLanes.has(d.lane)) bad('R63', ev, 'case for lane ' + d.lane + ' which was not live in round ' + tourneyRound);
        return;
      }
      case 'lesson': {
        // V1_2 section 5, rule 62: a lesson names its lane, a signature of the form "stage + fault + consequence", a mechanism and how it was learned.
        if (typeof d.signature !== 'string' || d.signature.split(' + ').length !== 3) bad('R62', ev, 'lesson signature must be "stage + fault + consequence"');
        if (d.via !== 'overcame' && d.via !== 'suggested') bad('R62', ev, 'lesson via must be overcame or suggested');
        if (typeof d.mechanism !== 'string' || !Number.isInteger(d.round)) bad('R62', ev, 'lesson needs a mechanism and a round');
        if (tourneyLanes.size && !tourneyLanes.has(d.lane)) bad('R62', ev, 'lesson for lane ' + d.lane + ' which was not live in round ' + tourneyRound);
        return;
      }
      case 'corpse': {
        if (d.kind !== 'eliminated' && d.kind !== 'wall') bad('R59', ev, 'corpse kind must be eliminated or wall');
        if (typeof d.epitaph !== 'string' || d.round !== tourneyRound) bad('R59', ev, 'corpse needs an epitaph and the current round');
        return;
      }
      case 'awaiting_next': {
        // Rule 49: after a round the server waits. No order event may follow until the next round_start.
        if (d.round !== tourneyRound) bad('R60', ev, 'awaiting_next for round ' + d.round + ' but round ' + tourneyRound + ' just ended');
        awaiting = true;
        return;
      }
      case 'tournament_end': {
        if (!Number.isInteger(d.champion) || fallenLanes.has(d.champion)) bad('R61', ev, 'the champion must be a lane that was never eliminated');
        return;
      }
      case 'hardening_spec':
      case 'fix_applied':
        if (ev.wave === undefined || ev.wave > waveNo) bad('R26', ev, `${t} carries wave ${ev.wave}, expected a wave up to ${waveNo}`);
        return;
      default:
    }

    // Rule 60 (V1_2 rule 49): while the server waits for Next, no order work happens; rule 50: fallen lanes emit no order events.
    if (awaiting && (t === 'order_start' || t === 'stage_start')) bad('R60', ev, t + ' while awaiting_next');
    if (fallenLanes.has(Number(ev.lane)) && (t === 'order_start' || t === 'stage_start' || t === 'order_done')) bad('R59', ev, 'fallen lane ' + ev.lane + ' emits ' + t);
    if (t === 'wave_start') awaiting = false;

    // Lane events from here on.
    if (!sawWaveStart) { bad('R1', ev, `${t} before wave_start`); return; }
    const laneNo = ev.lane as number;
    if (!waveOpen && t !== 'part_added') { bad('R1', ev, `${t} after wave_end`); return; }
    if (waveOpen && ev.wave !== waveNo) bad('R16', ev, `wave ${ev.wave} does not match the open wave ${waveNo}`);
    if (t === 'part_added') {
      if (!waveOpen && (ev.wave === undefined || ev.wave > waveNo)) bad('R26', ev, 'part_added after a wave must carry that wave number');
      return;
    }
    const L = lane(laneNo);
    if (t === 'lane_ready') {
      if (L.ready) bad('R1', ev, `second lane_ready for lane ${laneNo}`);
      L.ready = true;
      return;
    }
    if (!L.ready) bad('R1', ev, `lane ${laneNo} event before its lane_ready`);

    // Stage and order checks use these.
    const stageId = ev.stage;
    if (stageId !== undefined && !stageIds.includes(stageId)) bad('R19', ev, `stage ${stageId} is not a stage of app ${app}`);
    const idx = stageId !== undefined ? stageIds.indexOf(stageId) : -1;

    if (minor >= 1) {
      // Rule 42: a review follows its order_done/order_failed before any other event of the lane (accounting events aside).
      if (L.awaitReview && t !== 'review' && !IGNORABLE.has(t)) {
        bad('R42', ev, `${t} came before the review of ${L.awaitReview.order}`);
        L.awaitReview = undefined;
      }
      // Rule 46: the two boss scores come together.
      if (L.bossHalf && !(t === 'score' && ((L.bossHalf === 'boss recovered' && d.reason === 'boss downtime refund') || (L.bossHalf === 'boss downtime refund' && d.reason === 'boss recovered')))) {
        bad('R46', ev, `"${L.bossHalf}" must be followed directly by its partner score`);
        L.bossHalf = undefined;
      }
      // Rule 44: nothing starts while a decision is open.
      if (L.decision && t === 'order_start' && !(d.redo && L.res)) bad('R44', ev, `order_start while the decision for ${L.decision.order} is open`);
    }

    // Pending expectation (rules 3, 5, 6, 23).
    if (L.expect && !IGNORABLE.has(t)) {
      const exp = L.expect;
      const ok =
        (exp === 'order_done' && t === 'order_done') ||
        (exp === 'recover' && (t === 'recover_start' || t === 'process_dead')) ||
        (exp === 'order_start_same' && t === 'order_start' && ev.order === L.expectOrder) ||
        (exp === 'stage_start_next' && (t === 'stage_start' || t === 'process_dead'));
      if (!ok) bad(exp === 'order_done' ? 'R5' : exp === 'recover' ? 'R6' : exp === 'order_start_same' ? 'R23' : 'R25', ev, `expected ${exp} next, got ${t}`);
      L.expect = undefined;
    }

    const closeChaos = (): void => { L.pendingChaos = 0; };
    const needAlive = (): boolean => {
      if (L.state === 'dead') { bad('R6', ev, `${t} while lane ${laneNo} is dead`); return false; }
      if (L.state === 'halted') { bad('R4', ev, `${t} after lane_halted`); return false; }
      return true;
    };

    switch (t) {
      case 'order_start': {
        if (!needAlive()) break;
        const isRedo = minor >= 1 && !!d.redo && L.res?.choice === 'redo';
        if (L.order && !isRedo) bad('R4', ev, `order_start while ${L.order} is still in flight`);
        const o = ev.order as string;
        if (minor >= 1) {
          if (L.gap && ev.ts - L.gap.ts < L.gap.ms - TOL) bad('R40', ev, `order_start came ${ev.ts - L.gap.ts} ms after the previous order ended, expected at least ${L.gap.ms} (ceremony or cancel plus return)`);
          L.gap = undefined; L.walk = undefined;
          L.grab = num(d.grabMs) && d.grabMs > 0 ? { ts: ev.ts, ms: d.grabMs } : undefined;
          L.orderStartTs = ev.ts;
          if (isRedo) {
            for (const k of [...L.stageStarts.keys()]) if (k.startsWith(`${o}|`)) L.stageStarts.delete(k);
            for (const k of [...L.fails.keys()]) if (k.startsWith(`${o}|`)) L.fails.delete(k);
            L.res = undefined; L.decision = undefined;
          }
        }
        if (L.parked.has(o) && L.expectOrder !== o) bad('R23', ev, `parked order ${o} restarted without order_resumed`);
        // A resumed order continues where it parked. A fresh order and a duplicate pass start at stage 1.
        L.doneIdx = L.parked.has(o) ? (L.parkedIdx.get(o) ?? -1) : -1;
        L.parked.delete(o);
        L.order = o; L.state = 'running'; L.open = undefined; L.stack = []; L.expectOrder = undefined;
        break;
      }
      case 'stage_start': {
        if (!needAlive()) break;
        if (!L.order || L.order !== ev.order) { bad('R2', ev, 'stage_start outside its order'); break; }
        if (minor >= 1) {
          if (L.decision) bad('R44', ev, `stage_start before decision_made for ${L.decision.order}`);
          if (L.grab && ev.ts - L.grab.ts < L.grab.ms - TOL) bad('R40', ev, `first stage_start came ${ev.ts - L.grab.ts} ms after order_start, expected at least grabMs ${L.grab.ms}`);
          if (L.walk && ev.ts - L.walk.ts < L.walk.ms - TOL) bad('R40', ev, `stage_start came ${ev.ts - L.walk.ts} ms after stage_done, expected at least walkMs ${L.walk.ms}`);
          L.grab = undefined; L.walk = undefined;
        }
        if (L.state === 'failed' || L.state === 'continuing') bad('R34', ev, 'stage_start after stage_fail: an in-stage retry continues the same stage');
        if (L.open && !L.open.killed) bad('R2', ev, `stage_start ${stageId} while ${L.open.stage} is still open`);
        if (idx > L.doneIdx + 1) bad('R2', ev, `stage ${stageId} starts before stage ${stageIds[L.doneIdx + 1]} is done`);
        const key = `${ev.order}|${stageId}`;
        const n = (L.stageStarts.get(key) ?? 0) + 1;
        L.stageStarts.set(key, n);
        if (d.attempt !== n) bad('R29', ev, `attempt ${d.attempt} should be ${n}`);
        L.open = { stage: stageId as string, idx, killed: false };
        L.state = 'running';
        break;
      }
      case 'stage_progress': {
        if (!L.open || L.open.killed || L.open.stage !== stageId) bad('R2', ev, 'stage_progress outside its open stage');
        else if (L.state === 'failed' || L.state === 'degraded_failed') bad('R3', ev, 'stage_progress right after stage_fail');
        break;
      }
      case 'stage_done': {
        if (!L.open || L.open.killed || L.open.stage !== stageId) { bad('R2', ev, 'stage_done without its open stage'); break; }
        if (L.state === 'failed') bad('R3', ev, 'stage_done right after stage_fail with no recovery');
        if (d.skipped) {
          const p = L.prevSig;
          if (!p || p.type !== 'stage_start' || p.stage !== stageId) bad('R27', ev, 'skipped stage_done must directly follow its stage_start');
        }
        L.doneIdx = Math.max(L.doneIdx, L.open.idx);
        L.open = undefined; L.state = 'running';
        if (idx === stageIds.length - 1 && !d.skipped) L.expect = 'order_done';
        if (minor >= 1) {
          L.walk = num(d.walkMs) && d.walkMs > 0 && !d.skipped ? { ts: ev.ts, ms: d.walkMs } : undefined;
          const iv = L.ivals.get(ev.order as string);
          L.closedInterval = false;
          if (!d.skipped && iv !== undefined && idx >= iv) { L.closedInterval = true; L.ivals.delete(ev.order as string); }
        }
        break;
      }
      case 'stage_fail': {
        if (!L.open || L.open.killed || L.open.stage !== stageId) { bad('R2', ev, 'stage_fail without its open stage'); break; }
        closeChaos();
        if (minor >= 1) {
          const fk = `${ev.order}|${stageId}`;
          L.fails.set(fk, (L.fails.get(fk) ?? 0) + 1);
          if (!L.ivals.has(ev.order as string)) L.ivals.set(ev.order as string, idx);
        }
        if (d.degraded) { L.state = 'degraded_failed'; L.expect = 'stage_start_next'; L.doneIdx = Math.max(L.doneIdx, L.open.idx); L.open = undefined; }
        else L.state = 'failed';
        break;
      }
      case 'recover_start': {
        if (L.state === 'dead') { bad('R6', ev, 'recover_start while dead'); break; }
        closeChaos();
        const a = d.action as string;
        if (minor >= 1) { L.walk = undefined; L.grab = undefined; }
        if (a === 'retry' || a === 'backoff') {
          if (L.state !== 'failed') bad('R3', ev, `${a} recovery must follow a stage_fail`);
          L.state = 'continuing';
          // mark so recover_done keeps the same stage open
        } else if (a === 'restart') { L.doneIdx = -1; }
        L.stack.push(a);
        break;
      }
      case 'recover_done': {
        const top = L.stack.pop();
        if (top !== d.action) bad('R13', ev, `recover_done ${d.action} does not match the open recover_start ${top ?? '(none)'}`);
        break;
      }
      case 'process_dead': {
        if (L.state === 'dead') { bad('R6', ev, 'process_dead while already dead'); break; }
        closeChaos();
        if (minor >= 1) { L.walk = undefined; L.grab = undefined; if (L.order && !L.ivals.has(L.order)) L.ivals.set(L.order, L.open ? L.open.idx : 0); }
        L.dead = { ts: ev.ts, restartInMs: d.restartInMs ?? 0 };
        L.state = 'dead'; L.stack = [];
        if (L.open) L.open.killed = true;
        break;
      }
      case 'process_up': {
        if (L.state !== 'dead' || !L.dead) { bad('R6', ev, 'process_up without process_dead'); break; }
        if (ev.ts - L.dead.ts < L.dead.restartInMs * 0.9 - 5) bad('R6', ev, `process_up after ${ev.ts - L.dead.ts} ms, restartInMs was ${L.dead.restartInMs}`);
        L.dead = undefined;
        L.state = 'running';
        if (L.order) L.expect = 'recover';
        break;
      }
      case 'chaos': {
        if (L.state === 'halted') bad('R4', ev, 'chaos on a halted lane');
        {
          const want = WORLD_FAULTS[d.fault as string];
          if (want && d.creature !== want) bad('R47', ev, `chaos fault ${d.fault} must carry creature ${want}, got ${d.creature}`);
          if (!want && WORLD_CREATURES.has(d.creature as string)) bad('R47', ev, `creature ${d.creature} only appears with a world fault, got fault ${d.fault}`);
        }
        L.pendingChaos++;
        if (d.source === 'boss') L.bossChaos++;
        break;
      }
      case 'chaos_absorbed': closeChaos(); break;
      case 'effect': {
        if (L.state === 'dead') bad('R6', ev, 'effect while dead');
        if (L.res) L.res.effects.add(d.kind as string);
        break;
      }
      case 'repeat': {
        const p = L.prev;
        if (!p || p.type !== 'effect' || p.detail?.kind !== d.kind || p.detail?.key !== d.key) bad('R8', ev, 'repeat must immediately follow the effect that caused it');
        break;
      }
      case 'breaker': {
        const from = L.breaker.get(d.service) ?? 'closed';
        const to = d.state as string;
        const okMoves: Record<string, string[]> = { closed: ['open'], open: ['half_open'], half_open: ['closed', 'open'] };
        if (!okMoves[from]?.includes(to)) bad('R-breaker', ev, `breaker ${d.service} goes ${from} to ${to}`);
        L.breaker.set(d.service, to);
        break;
      }
      case 'score': {
        const expected = L.score + d.delta;
        if (d.total !== expected) bad('R9', ev, `score.total ${d.total} should be ${expected}`);
        L.score = d.total;
        if (typeof d.reason === 'string' && d.reason.startsWith('duplicate ') && L.prev?.type !== 'repeat') bad('R9', ev, 'a duplicate score must follow its repeat');
        if (minor >= 1) {
          if (d.reason === 'downtime') {
            if (!(d.delta < 0)) bad('R45', ev, `downtime score must be negative, got ${d.delta}`);
            if (L.prevSig?.type !== 'stage_done' || !L.closedInterval) bad('R45', ev, 'downtime score must be emitted once, right after the stage that ends a recovery interval');
            L.closedInterval = false;
          }
          if (d.reason === 'boss recovered' || d.reason === 'boss downtime refund') {
            const partner = d.reason === 'boss recovered' ? 'boss downtime refund' : 'boss recovered';
            const p = L.prev;
            if (L.bossHalf === partner && p?.type === 'score') {
              L.bossHalf = undefined;
            } else {
              if (L.bossHalf) bad('R46', ev, `second "${d.reason}" without its partner`);
              L.bossHalf = d.reason as string;
              if (L.prevSig?.type !== 'order_done' && L.prevSig?.type !== 'review') bad('R46', ev, `${d.reason} must follow the completion of the in-flight order`);
              if (L.bossChaos < 1) bad('R46', ev, `${d.reason} without a boss hit on this lane`);
            }
            if (d.reason === 'boss recovered' && !(d.delta > 0)) bad('R46', ev, `boss recovered must be positive, got ${d.delta}`);
            if (d.reason === 'boss downtime refund' && !(d.delta >= 0)) bad('R46', ev, `boss downtime refund must not be negative, got ${d.delta}`);
          }
        }
        break;
      }
      case 'order_done': {
        if (!L.order || L.order !== ev.order) { bad('R5', ev, 'order_done outside its order'); break; }
        if (L.open) bad('R5', ev, 'order_done while a stage is open');
        if (L.state === 'failed') bad('R3', ev, 'order_done right after stage_fail');
        if (minor >= 1) {
          checkLap(ev, d, L);
          if (num(d.lap?.ms)) L.doneMs.push(d.lap.ms);
          L.counts.done++;
          L.awaitReview = { order: L.order, cancelled: false };
          L.gap = num(d.ceremonyMs) && num(d.returnMs) ? { ts: ev.ts, ms: d.ceremonyMs + d.returnMs } : undefined;
          L.walk = undefined; L.grab = undefined; L.ivals.delete(L.order);
          if (L.res && L.res.choice === 'discount' && !L.res.effects.has('discount')) bad('R44', ev, 'discount decision resolved without a discount effect');
          if (L.res && L.res.choice !== 'discount') bad('R44', ev, `order_done after a ${L.res.choice} decision`);
          L.res = undefined;
        }
        L.finished.add(L.order);
        L.order = undefined; L.state = 'idle'; L.open = undefined;
        break;
      }
      case 'order_failed':
      case 'order_quarantined':
      case 'order_parked': {
        if (!L.order || L.order !== ev.order) { bad('R4', ev, `${t} outside its order`); break; }
        if (L.state !== 'failed') bad('R3', ev, `${t} must directly follow a stage_fail`);
        closeChaos();
        if (minor >= 1) {
          if (t === 'order_failed') {
            checkLap(ev, d, L);
            L.counts.cancelled++;
            L.awaitReview = { order: L.order, cancelled: d.outcome === 'cancelled' || d.outcome === undefined };
            L.gap = num(d.cancelMs) && num(d.returnMs) ? { ts: ev.ts, ms: d.cancelMs + d.returnMs } : undefined;
            if (L.res) {
              if (L.res.choice !== 'refund') bad('R44', ev, `order_failed after a ${L.res.choice} decision`);
              else if (!L.res.effects.has('refund')) bad('R44', ev, 'refund decision resolved without a refund effect');
              else if (d.outcome !== 'cancelled' || d.reason !== 'refunded') bad('R44', ev, 'refund decision must end in order_failed{outcome:cancelled, reason:refunded}');
            }
          }
          if (t === 'order_quarantined') L.counts.quarantined++;
          L.res = undefined; L.decision = undefined; L.walk = undefined; L.grab = undefined;
          if (t !== 'order_parked') L.ivals.delete(L.order);
        }
        if (t === 'order_parked') { L.parked.add(L.order); L.parkedIdx.set(L.order, L.doneIdx); }
        else L.finished.add(L.order);
        L.order = undefined; L.state = 'idle'; L.open = undefined; L.stack = [];
        break;
      }
      case 'order_resumed': {
        if (!L.parked.has(ev.order as string)) bad('R11', ev, 'order_resumed for an order that was not parked');
        if (L.order) bad('R23', ev, 'order_resumed while another order is in flight');
        L.expect = 'order_start_same'; L.expectOrder = ev.order;
        break;
      }
      case 'review': {
        if (minor < 1) break;
        const a = L.awaitReview;
        if (!a || a.order !== ev.order) { bad('R42', ev, `review for ${ev.order} does not follow its order_done/order_failed`); break; }
        L.awaitReview = undefined;
        const c = d.cum ?? {};
        if (d.order !== ev.order) bad('R42', ev, `review detail.order ${d.order} differs from the envelope order ${ev.order}`);
        if (c.count !== L.rv.count + 1) bad('R42', ev, `review cum.count ${c.count} should be ${L.rv.count + 1}`);
        if (num(d.stars) && num(c.stars) && Math.abs(c.stars - (L.rv.sum + d.stars)) > 1e-9) bad('R42', ev, `review cum.stars ${c.stars} should be ${L.rv.sum + (d.stars as number)}`);
        if (c.max !== 5 * (L.rv.count + 1)) bad('R42', ev, `review cum.max ${c.max} should be ${5 * (L.rv.count + 1)}`);
        if (a.cancelled && d.stars !== 1) bad('R42', ev, `a cancelled order must get 1 star, got ${d.stars}`);
        L.rv = { count: L.rv.count + 1, sum: L.rv.sum + (num(d.stars) ? d.stars : 0) };
        break;
      }
      case 'decision_needed': {
        if (minor < 1) break;
        if (L.decision) bad('R44', ev, `decision_needed for ${d.order} while ${L.decision.order} is still open`);
        if (!L.order || d.order !== L.order) bad('R44', ev, `decision_needed for ${d.order} but the order in flight is ${L.order ?? '(none)'}`);
        const opts = Array.isArray(d.options) ? (d.options as string[]) : [];
        if (!opts.includes(d.defaultChoice as string)) bad('R44', ev, `defaultChoice ${d.defaultChoice} is not one of the options`);
        L.decision = { order: d.order as string, options: opts, defaultChoice: d.defaultChoice as string };
        break;
      }
      case 'decision_made': {
        if (minor < 1) break;
        if (!L.decision) { bad('R44', ev, 'decision_made without decision_needed'); break; }
        if (L.decision.order !== d.order) bad('R44', ev, `decision_made for ${d.order}, the open decision is for ${L.decision.order}`);
        if (!L.decision.options.includes(d.choice as string)) bad('R44', ev, `choice ${d.choice} is not one of the options`);
        if ((d.source === 'default' || d.source === 'timeout') && d.choice !== L.decision.defaultChoice) bad('R44', ev, `source ${d.source} must choose the defaultChoice ${L.decision.defaultChoice}, got ${d.choice}`);
        L.res = { choice: d.choice as string, effects: new Set() };
        L.decision = undefined;
        // The wrong-order failure is settled by the decision: a discount lets the open stage continue.
        if (d.choice === 'discount') L.state = 'continuing';
        break;
      }
      case 'lane_halted': {
        if (L.state !== 'failed') bad('R3', ev, 'lane_halted must directly follow a stage_fail');
        closeChaos();
        L.halted = true; L.state = 'halted'; L.order = undefined; L.open = undefined; L.stack = [];
        break;
      }
      case 'order_abandoned': {
        if (L.state !== 'halted') bad('R4', ev, 'order_abandoned before lane_halted');
        if (minor >= 1) L.counts.abandoned++;
        closeChaos();
        break;
      }
      default:
    }

    if (CLOSERS.has(t) && t !== 'stage_fail') closeChaos();
    L.prev = ev;
    if (!IGNORABLE.has(t)) L.prevSig = ev;
  });

  // Chaos closers (rules 7, 14, 20) are checked at wave_end. Final stream rules:
  if (opts.requireWaveEnd !== false) {
    const last = events[events.length - 1];
    if (last.type !== 'wave_end' && !(['hardening_spec', 'fix_applied', 'part_added', 'round_end', 'awaiting_next', 'tournament_end', 'lane_eliminated', 'corpse'].includes(last.type))) bad('R1', last, 'stream must end with wave_end');
    if (waveOpen) bad('R1', last, 'last wave never ended');
  }
  return out;
}

/** Parses JSONL text into events. Throws with the line number on bad JSON. */
export function parseJsonl(text: string): HauntEvent[] {
  const events: HauntEvent[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    try { events.push(JSON.parse(line)); } catch (e) { throw new Error(`line ${i + 1}: ${(e as Error).message}`); }
  });
  return events;
}

export function formatViolations(vs: Violation[], max = 20): string {
  return vs.slice(0, max).map((v) => `  [${v.rule}] seq ${v.seq} ${v.type}: ${v.message}`).join('\n') + (vs.length > max ? `\n  ... and ${vs.length - max} more` : '');
}
