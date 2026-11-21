// Journal: bot-owned append-only JSONL. Semantics from .kiro/specs/engine/design.md section 3
// and runtime.md section 6. Every record is written with writeSync then fsyncSync.
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeSync } from 'node:fs';

export type JournalRecord =
  | { t: 'stage_start'; order: string; stage: string; attempt: number; ts: number }
  | { t: 'intent'; order: string; stage: string; kind: string; key: string | null; eid: string; ts: number }
  | { t: 'result'; order: string; stage: string; kind: string; key: string | null; eid: string; payload: unknown; ts: number }
  | { t: 'stage_done'; order: string; stage: string; ts: number }
  | { t: 'order_done'; order: string; ts: number }
  | { t: 'order_end'; order: string; outcome: OrderOutcome; ts: number }
  /** Wrong-order redo (playtest-v2 design.md section 8): generation `n` starts from intake with `:rN` keys. */
  | { t: 'order_redo'; order: string; n: number; ts: number }
  /** The wrong-order decision that was made, so a restart applies it instead of asking again. */
  | { t: 'decision'; order: string; choice: DecisionChoice; ts: number };

export type OrderOutcome = 'done' | 'failed' | 'parked' | 'quarantined';
export type DecisionChoice = 'refund' | 'discount' | 'redo';

export interface EffectState {
  intent: boolean;
  result: boolean;
  key: string | null;
  payload?: unknown;
}

export interface StageState {
  done: boolean;
  effects: Map<string, EffectState>;
}

export interface OrderState {
  /** Set only by an `order_end` record (or `order_done`, which means done). */
  outcome: OrderOutcome | null;
  stages: Map<string, StageState>;
  /** Redo generation: 0 for the first run, n after the nth `order_redo`. */
  redo: number;
  /** The wrong-order decision made in the current generation, if any. */
  decision: DecisionChoice | null;
}

export type JournalState = Map<string, OrderState>;

/** Parse JSONL text. Unparseable lines (a torn last line after a kill) are ignored and never throw. */
export function parseJournal(text: string): JournalRecord[] {
  const out: JournalRecord[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const rec = JSON.parse(line) as JournalRecord;
      if (rec && typeof rec === 'object' && typeof rec.t === 'string' && typeof rec.order === 'string') out.push(rec);
    } catch {
      // torn line
    }
  }
  return out;
}

export function readJournal(path: string): JournalRecord[] {
  return existsSync(path) ? parseJournal(readFileSync(path, 'utf8')) : [];
}

/** Fold one record into state, in place. */
export function applyRecord(state: JournalState, r: JournalRecord): void {
  const order = (id: string): OrderState => {
    let o = state.get(id);
    if (!o) state.set(id, (o = { outcome: null, stages: new Map(), redo: 0, decision: null }));
    return o;
  };
  const stage = (id: string, name: string): StageState => {
    const o = order(id);
    let s = o.stages.get(name);
    if (!s) o.stages.set(name, (s = { done: false, effects: new Map() }));
    return s;
  };
  const effect = (s: StageState, eid: string, key: string | null): EffectState => {
    let e = s.effects.get(eid);
    if (!e) s.effects.set(eid, (e = { intent: false, result: false, key }));
    return e;
  };
  switch (r.t) {
    case 'stage_start':
      stage(r.order, r.stage);
      break;
    case 'intent':
      effect(stage(r.order, r.stage), r.eid, r.key).intent = true;
      break;
    case 'result': {
      const e = effect(stage(r.order, r.stage), r.eid, r.key);
      e.result = true;
      e.payload = r.payload;
      break;
    }
    case 'stage_done':
      stage(r.order, r.stage).done = true;
      break;
    case 'order_done':
      order(r.order).outcome = 'done';
      break;
    case 'order_end':
      order(r.order).outcome = r.outcome;
      break;
    case 'order_redo': {
      // A redo starts the order again from intake: nothing of the wrong generation may be replayed.
      const o = order(r.order);
      o.stages = new Map();
      o.redo = r.n;
      o.decision = null;
      break;
    }
    case 'decision':
      order(r.order).decision = r.choice;
      break;
  }
}

/** Pure fold of records into state. Replaying the same records twice gives the same state (P3). */
export function replay(records: readonly JournalRecord[]): JournalState {
  const state: JournalState = new Map();
  for (const r of records) applyRecord(state, r);
  return state;
}

export class JournalWriteError extends Error {
  constructor(readonly code: string) {
    super(`journal write failed: ${code}`);
  }
}

export class Journal {
  private fd: number;
  private failures = 0;

  constructor(readonly path: string) {
    this.fd = openSync(path, 'a');
  }

  /** `disk_full`: the next write throws ENOSPC once. */
  failNextWrite(): void {
    this.failures++;
  }

  /** Throws JournalWriteError on an injected failure. A real fs error propagates unchanged. */
  append(rec: JournalRecord): void {
    if (this.failures > 0) {
      this.failures--;
      throw new JournalWriteError('ENOSPC');
    }
    writeSync(this.fd, JSON.stringify(rec) + '\n');
    fsyncSync(this.fd);
  }

  close(): void {
    closeSync(this.fd);
  }
}
