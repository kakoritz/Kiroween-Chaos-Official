// Edge cases (spec 3.4): a normalised signature `stage + fault + consequence`, and the cases a lane met in a round.
import { laneIssues } from '../runner/floor';
import type { Ev } from './rp';

export type Consequence = 'absorbed' | 'recovered' | 'duplicate_effect' | 'order_lost' | 'order_parked' | 'order_quarantined' | 'lane_halted' | 'order_degraded';
export type Outcome = 'solved' | 'partly' | 'lost';

/** How a lane got through: what its recovery actually used. */
export type Mechanism = 'retry' | 'retry_backoff' | 'journal_replay' | 'idempotency_key' | 'reconcile' | 'breaker' | 'queue' | 'restart' | 'compensate' | 'absorbed' | 'none';

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
  unknown?: boolean;
  fingerprint?: string;
}

/** Faults are normalised to a name that is the same for a gremlin and its variant, and for a fuzz shape and its base. */
export function normaliseFault(detail: Record<string, any> | undefined): string {
  if (!detail) return 'unknown';
  if (detail.fault === 'gremlin') return String(detail.variant ?? 'gremlin');
  return String(detail.fault ?? 'unknown');
}

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
  restarts: number;
}

const fresh = (order: string): Ctx => ({ order, faults: [], actions: new Set(), repeatKinds: new Set(), replayedEffects: 0, parked: false, degraded: false, breakerOpened: false, recoverMs: 0, scoreDelta: 0, restarts: 0 });

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

/** The cases one lane met in a round, from the wave's events. One case per fault pressed, judged by what the order did next. */
export function laneCases(events: readonly Ev[], lane: number, round: number): Case[] {
  const out: Case[] = [];
  let ctx: Ctx | null = null;
  let curStage = '';
  const close = (end: 'order_done' | 'order_failed' | 'order_quarantined' | 'halted' | 'open', ts?: unknown): void => {
    void ts;
    if (!ctx) return;
    const c = ctx;
    ctx = null;
    for (const f of c.faults) {
      const lost = end === 'order_failed' || end === 'halted' || end === 'open';
      const consequence: Consequence = end === 'halted' ? 'lane_halted'
        : end === 'order_quarantined' ? 'order_quarantined'
        : lost ? 'order_lost'
        : c.repeatKinds.size > 0 ? 'duplicate_effect'
        : c.parked ? 'order_parked'
        : c.degraded ? 'order_degraded'
        : c.actions.size > 0 || c.restarts > 0 ? 'recovered' : 'absorbed';
      const outcome: Outcome = lost || end === 'order_quarantined' ? 'lost' : c.repeatKinds.size > 0 || c.parked || c.degraded ? 'partly' : 'solved';
      const mechanism = lost ? 'none' : mechanismOf(c);
      out.push({
        signature: signatureOf(f.stage, f.fault, consequence), stage: f.stage, fault: f.fault, consequence, lane, round, order: c.order, outcome, mechanism,
        ...(c.repeatKinds.size ? { kinds: [...c.repeatKinds].sort() } : {}), costMs: Math.round(c.recoverMs), costPoints: Math.round(c.scoreDelta < 0 ? -c.scoreDelta : 0),
        ...(c.stars !== undefined ? { stars: c.stars } : {}), ...(f.unknown ? { unknown: true, fingerprint: f.fingerprint } : {}),
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
        ctx.faults.push({ fault: normaliseFault(d), stage, ...(d.unknown ? { unknown: true, fingerprint: String(d.fingerprint ?? '') } : {}) });
        break;
      }
      case 'recover_start': if (ctx && typeof d.action === 'string') { ctx.actions.add(d.action); if (d.action === 'restart') ctx.restarts++; } break;
      case 'recover_done': if (ctx && typeof d.ms === 'number') ctx.recoverMs += d.ms; break;
      case 'process_up': if (ctx) ctx.restarts++; break;
      case 'effect': if (ctx && d.replayed) ctx.replayedEffects++; break;
      case 'repeat': if (ctx) ctx.repeatKinds.add(String(d.kind)); break;
      case 'breaker': if (ctx && d.state === 'open') ctx.breakerOpened = true; break;
      case 'order_parked': if (ctx) ctx.parked = true; break;
      case 'stage_fail': if (ctx && d.degraded) ctx.degraded = true; break;
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
