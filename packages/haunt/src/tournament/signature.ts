// Edge cases (spec 3.4): a normalised signature `stage + fault + consequence`, and the cases a lane met in a round.
import { laneIssues } from '../runner/floor';
import type { Ev } from './rp';

export type Consequence = 'handled' | 'reported' | 'swallowed' | 'crashed' | 'absorbed' | 'recovered' | 'duplicate_effect' | 'order_lost' | 'order_parked' | 'order_quarantined' | 'lane_halted' | 'order_degraded';
export type Outcome = 'solved' | 'partly' | 'lost';

/** How a lane got through: what its recovery actually used. */
export type Mechanism = 'retry' | 'retry_backoff' | 'journal_replay' | 'idempotency_key' | 'reconcile' | 'breaker' | 'queue' | 'restart' | 'compensate' | 'decision' | 'absorbed' | 'none';

export interface Case {
  /** `payment + timeout + duplicate_effect` */
  signature: string;
  stage: string;
  fault: string;
  consequence: Consequence;
  lane: number;
  round: number;
  order: string;
  outcome: Outcome;
  mechanism: Mechanism;
  /** Ledger kinds that repeated, for duplicate consequences. */
  kinds?: string[];
  costMs: number;
  costPoints: number;
  stars?: number;
  /** The wrong-order decision the lane made for this order (order_typo cases). */
  decision?: { choice: string; source: string };
  unknown?: boolean;
  fingerprint?: string;
}

/** Faults are normalised to a name that is the same for a gremlin and its variant, and for a fuzz shape and its base. */
export function normaliseFault(detail: Record<string, any> | undefined): string {
  if (!detail) return 'unknown';
  if (detail.fault === 'gremlin') return String(detail.variant ?? 'gremlin');
  return String(detail.fault ?? 'unknown');
}

const CURSE_CLASS = new Set(['handled', 'reported', 'swallowed', 'crashed']);
export const signatureOf = (stage: string, fault: string, consequence: string): string => `${stage} + ${fault} + ${consequence}`;

interface Ctx {
  order: string;
  faults: { fault: string; stage: string; unknown?: boolean; fingerprint?: string }[];
  actions: Set<string>;
  repeatKinds: Set<string>;
  replayedEffects: number;
  parked: boolean;
  degraded: boolean;
  breakerOpened: boolean;
  recoverMs: number;
  scoreDelta: number;
  stars?: number;
  decision?: { choice: string; source: string };
  restarts: number;
  /** Where the order's last failed call was, and what it answered (null: no answer): the real cause of a lost order. */
  failStage?: string;
  failStatus?: number | null;
  /** Curse answers of the order and how the bot reacted (TV3-C9). */
  curses: { curse: string; stage: string; cls: 'handled' | 'reported' | 'swallowed' | 'crashed' }[];
}

const fresh = (order: string): Ctx => ({ order, faults: [], actions: new Set(), repeatKinds: new Set(), replayedEffects: 0, parked: false, degraded: false, breakerOpened: false, recoverMs: 0, scoreDelta: 0, restarts: 0, curses: [] });

function mechanismOf(c: Ctx): Mechanism {
  if (c.breakerOpened && c.parked) return 'queue';
  if (c.parked) return 'queue';
  if (c.breakerOpened) return 'breaker';
  if (c.actions.has('reconcile') || (c.replayedEffects > 0 && c.actions.has('replay'))) return c.actions.has('reconcile') ? 'idempotency_key' : 'journal_replay';
  if (c.actions.has('replay')) return 'journal_replay';
  if (c.actions.has('backoff')) return 'retry_backoff';
  if (c.actions.has('retry')) return 'retry';
  if (c.actions.has('restart')) return 'restart';
  return c.faults.length ? 'absorbed' : 'none';
}

/**
 * The fault a failed call stands for, from what the bot saw: a 503 is an endpoint that is down, a 429 a rate limit, a 404 a missing endpoint, any other 5xx a server
 * error, no answer a timeout. Anything else is not named (the pressed fault is blamed as before).
 */
export function faultOfFailure(status: number | null | undefined): string | undefined {
  if (status === null) return 'timeout';
  if (status === undefined) return undefined;
  if (status === 503 || status === 502) return 'endpoint_down';
  if (status === 429) return 'http_429';
  if (status === 404) return 'http_404';
  if (status >= 500) return 'http_500';
  return undefined;
}

/** The cases one lane met in a round, from the wave's events. One case per fault pressed, judged by what the order did next. */
export function laneCases(events: readonly Ev[], lane: number, round: number): Case[] {
  const out: Case[] = [];
  let ctx: Ctx | null = null;
  let curStage = '';
  // A fault that was pressed in an earlier order can still be in force (an outage window): an order lost with no fault of its own is blamed on it.
  let lastChaos: { fault: string; unknown?: boolean; fingerprint?: string } | null = null;
  const close = (end: 'order_done' | 'order_failed' | 'order_quarantined' | 'halted' | 'open', ts?: unknown): void => {
    void ts;
    if (!ctx) return;
    const c = ctx;
    ctx = null;
    for (const k of c.curses) {
      const lost = k.cls === 'swallowed' || k.cls === 'crashed';
      out.push({
        signature: signatureOf(k.stage, `curse_${k.curse}`, k.cls), stage: k.stage, fault: `curse_${k.curse}`, consequence: k.cls, lane, round, order: c.order,
        outcome: k.cls === 'handled' ? 'solved' : lost ? 'lost' : 'partly', mechanism: k.cls === 'handled' ? 'retry' : 'none', costMs: Math.round(c.recoverMs), costPoints: lost ? 300 : 0,
      });
    }
    const faults = c.faults.length === 0 && lastChaos && (end === 'order_failed' || end === 'halted' || end === 'order_quarantined')
      ? [{ fault: lastChaos.fault, stage: curStage || 'payment', ...(lastChaos.unknown ? { unknown: true, fingerprint: lastChaos.fingerprint } : {}) }]
      : c.faults;
    // A lost order is blamed on what happened at the stage where its last call failed. A fault pressed at another stage was survived (or was the lesser cause);
    // without it every lost order is blamed on whatever was pressed first, and the loop treats the wrong stage.
    const failFault = end === 'order_failed' && c.failStage !== undefined ? faultOfFailure(c.failStatus) : undefined;
    const judged: { f: (typeof faults)[number]; lost: boolean }[] = faults.map((x) => ({ f: x, lost: failFault === undefined ? end === 'order_failed' : x.stage === c.failStage }));
    if (failFault !== undefined && !judged.some((x) => x.lost)) judged.push({ f: { fault: failFault, stage: c.failStage! }, lost: true });
    for (const { f, lost: failed } of judged) {
      const lost = failed || end === 'halted' || end === 'open';
      const consequence: Consequence = end === 'halted' ? 'lane_halted'
        : end === 'order_quarantined' ? 'order_quarantined'
        : lost ? 'order_lost'
        : c.repeatKinds.size > 0 ? 'duplicate_effect'
        : c.parked ? 'order_parked'
        : c.degraded ? 'order_degraded'
        : c.actions.size > 0 || c.restarts > 0 ? 'recovered' : 'absorbed';
      const outcome: Outcome = lost || end === 'order_quarantined' ? 'lost' : c.repeatKinds.size > 0 || c.parked || c.degraded ? 'partly' : 'solved';
      const decided = f.fault === 'order_typo' && c.decision !== undefined;
      const mechanism = lost ? 'none' : decided ? 'decision' : mechanismOf(c);
      out.push({
        signature: signatureOf(f.stage, f.fault, consequence), stage: f.stage, fault: f.fault, consequence, lane, round, order: c.order, outcome, mechanism,
        ...(c.repeatKinds.size ? { kinds: [...c.repeatKinds].sort() } : {}), costMs: Math.round(c.recoverMs), costPoints: Math.round(c.scoreDelta < 0 ? -c.scoreDelta : 0),
        ...(c.stars !== undefined ? { stars: c.stars } : {}), ...(decided ? { decision: c.decision } : {}), ...(f.unknown ? { unknown: true, fingerprint: f.fingerprint } : {}),
      });
    }
  };
  for (const e of events) {
    if (String(e.lane) !== String(lane)) continue;
    const d = (e.detail ?? {}) as Record<string, any>;
    switch (e.type) {
      case 'order_start': close('open'); ctx = fresh(String(e.order ?? '')); curStage = ''; break;
      case 'order_resumed': break;
      case 'stage_start': if (typeof e.stage === 'string') curStage = e.stage; break;
      case 'chaos': {
        if (!ctx) break;
        const stage = String(d.deferredTo ?? e.stage ?? (curStage || 'payment'));
        lastChaos = { fault: normaliseFault(d), ...(d.unknown ? { unknown: true, fingerprint: String(d.fingerprint ?? '') } : {}) };
        ctx.faults.push({ fault: normaliseFault(d), stage, ...(d.unknown ? { unknown: true, fingerprint: String(d.fingerprint ?? '') } : {}) });
        break;
      }
      case 'curse_response': if (ctx && CURSE_CLASS.has(String(d.class))) ctx.curses.push({ curse: String(d.curse), stage: String(d.stage ?? e.stage ?? curStage), cls: d.class }); break;
      case 'recover_start': if (ctx && typeof d.action === 'string') { ctx.actions.add(d.action); if (d.action === 'restart') ctx.restarts++; } break;
      case 'recover_done': if (ctx && typeof d.ms === 'number') ctx.recoverMs += d.ms; break;
      case 'process_up': if (ctx) ctx.restarts++; break;
      case 'effect': if (ctx && d.replayed) ctx.replayedEffects++; break;
      case 'repeat': if (ctx) ctx.repeatKinds.add(String(d.kind)); break;
      case 'breaker': if (ctx && d.state === 'open') ctx.breakerOpened = true; break;
      case 'order_parked': if (ctx) ctx.parked = true; break;
      case 'decision_made': if (ctx) ctx.decision = { choice: String(d.choice), source: String(d.source ?? 'default') }; break;
      case 'stage_fail':
        if (ctx && d.degraded) ctx.degraded = true;
        else if (ctx) { ctx.failStage = String(e.stage ?? curStage); ctx.failStatus = typeof d.status === 'number' ? d.status : d.status === null ? null : undefined; }
        break;
      case 'score': if (ctx) ctx.scoreDelta += typeof d.delta === 'number' ? d.delta : 0; break;
      case 'review':
        // The review follows order_done, so it is attached to the cases the order just closed.
        if (typeof d.stars === 'number') { if (ctx) ctx.stars = d.stars; for (const c of out) if (c.order === String(e.order) && c.stars === undefined) c.stars = d.stars; }
        break;
      case 'order_done': close('order_done'); break;
      case 'order_failed': close('order_failed'); break;
      case 'order_quarantined': close('order_quarantined'); break;
      case 'lane_halted': close('halted'); break;
      default: break;
    }
  }
  close('open');
  return out;
}

/** Issues of a lane in a round, for the Casebook's "who met it" count. */
export const issuesIn = (events: readonly Ev[], lane: number): number => laneIssues(events, lane);
