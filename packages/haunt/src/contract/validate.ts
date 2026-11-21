// Event stream validator: contract/events.schema.json plus every ordering rule of contract/PROTOCOL.md.
// Used by `npm run validate:events`, the contract test suite (mock and live) and the fixture generator.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
import Ajv2020 from 'ajv/dist/2020.js';
import { APPS, ALL_TYPES, GLOBAL_TYPES, type AppId, type HauntEvent } from '@haunt/shared';

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

const IGNORABLE = new Set(['score', 'effect', 'repeat', 'chaos', 'chaos_absorbed', 'breaker']);
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
}

const newLane = (): Lane => ({
  ready: false, state: 'idle', doneIdx: -1, stack: [], pendingChaos: 0, parked: new Set(), parkedIdx: new Map(), finished: new Set(), score: 0,
  breaker: new Map(), bossChaos: 0, stageStarts: new Map(), halted: false,
});

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
  let stageIds: string[] = APPS.orders.stages.map((s) => s.id);
  let sawWaveStart = false;

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
    if (t !== 'hello' && t !== 'reset' && ev.wave === undefined) bad('R16', ev, 'missing wave');

    switch (t) {
      case 'hello': return;
      case 'reset':
        lanes = new Map(); waveOpen = false; boss = null;
        return;
      case 'wave_start': {
        if (waveOpen) bad('R1', ev, 'wave_start while the previous wave has not ended');
        waveOpen = true; sawWaveStart = true;
        waveNo = ev.wave ?? waveNo + 1;
        app = (d.app as AppId) in APPS ? (d.app as AppId) : 'orders';
        stageIds = APPS[app].stages.map((s) => s.id);
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
      case 'hardening_spec':
      case 'fix_applied':
        if (ev.wave === undefined || ev.wave > waveNo) bad('R26', ev, `${t} carries wave ${ev.wave}, expected a wave up to ${waveNo}`);
        return;
      default:
    }

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
        if (L.order) bad('R4', ev, `order_start while ${L.order} is still in flight`);
        const o = ev.order as string;
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
        break;
      }
      case 'stage_fail': {
        if (!L.open || L.open.killed || L.open.stage !== stageId) { bad('R2', ev, 'stage_fail without its open stage'); break; }
        closeChaos();
        if (d.degraded) { L.state = 'degraded_failed'; L.expect = 'stage_start_next'; L.doneIdx = Math.max(L.doneIdx, L.open.idx); L.open = undefined; }
        else L.state = 'failed';
        break;
      }
      case 'recover_start': {
        if (L.state === 'dead') { bad('R6', ev, 'recover_start while dead'); break; }
        closeChaos();
        const a = d.action as string;
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
        L.pendingChaos++;
        if (d.source === 'boss') L.bossChaos++;
        break;
      }
      case 'chaos_absorbed': closeChaos(); break;
      case 'effect': {
        if (L.state === 'dead') bad('R6', ev, 'effect while dead');
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
        break;
      }
      case 'order_done': {
        if (!L.order || L.order !== ev.order) { bad('R5', ev, 'order_done outside its order'); break; }
        if (L.open) bad('R5', ev, 'order_done while a stage is open');
        if (L.state === 'failed') bad('R3', ev, 'order_done right after stage_fail');
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
      case 'lane_halted': {
        if (L.state !== 'failed') bad('R3', ev, 'lane_halted must directly follow a stage_fail');
        closeChaos();
        L.halted = true; L.state = 'halted'; L.order = undefined; L.open = undefined; L.stack = [];
        break;
      }
      case 'order_abandoned': {
        if (L.state !== 'halted') bad('R4', ev, 'order_abandoned before lane_halted');
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
    if (last.type !== 'wave_end' && !(['hardening_spec', 'fix_applied', 'part_added'].includes(last.type))) bad('R1', last, 'stream must end with wave_end');
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
