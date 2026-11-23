// The outcome table of .kiro/specs/engine/acceptance.md (table A) generalized by runtime.md section 26.
// One function, `resolveOutcome`, answers: what happens to one order when this fault hits this stage
// of this tier? The mock simulator, the mock's sample reports and the acceptance tests all use it, so
// they cannot drift apart. `packages/core/mock/outcomes.json` is this table written out as data.
import { TIER_DECISION_DEFAULT, APPS, TIERS, TIER_ORDER, FAULTS, CRASH_POINTS, faultApplies, isCrashFault, isDeskFault, type AppId, type EffectKind, type TierId } from './catalog';

export type OutcomeCode = 'OK' | 'REPEAT' | 'FAILED' | 'HALT' | 'PARKED_OK' | 'QUAR' | 'CANCELLED';
export type Template = 'T_OK' | 'T_REPEAT' | 'T_FAILED' | 'T_HALT' | 'T_PARKED_OK' | 'T_QUAR' | 'T_ABSORBED' | 'T_DEGRADED'
  | 'T_CANCELLED' | 'T_DECISION_REFUND' | 'T_DECISION_DISCOUNT' | 'T_DECISION_REDO';

export interface Outcome {
  outcome: OutcomeCode;
  /** Extra ledger rows by effect kind (rows beyond the first). */
  extraRows: Partial<Record<EffectKind, number>>;
  template: Template;
}

export interface OutcomeRow extends Outcome {
  app: AppId;
  tier: TierId;
  fault: string;
  stage: string;
  role: string;
  point?: string;
}

type Rows = Partial<Record<EffectKind, number>>;
const add = (r: Rows, kind: EffectKind, n = 1): void => { r[kind] = (r[kind] ?? 0) + n; };

/** Effects of every stage before `idx` (what a bot with no memory does again). */
function earlierEffects(app: AppId, idx: number): Rows {
  const r: Rows = {};
  APPS[app].stages.slice(0, idx).forEach((s) => s.effects.forEach((e) => add(r, e.kind)));
  return r;
}

const merge = (a: Rows, b: Rows): Rows => { const r: Rows = { ...a }; for (const [k, v] of Object.entries(b)) add(r, k as EffectKind, v as number); return r; };

const done = (outcome: OutcomeCode, extraRows: Rows = {}): Outcome => ({
  outcome, extraRows,
  template: outcome === 'OK' ? 'T_OK' : outcome === 'REPEAT' ? 'T_REPEAT' : outcome === 'FAILED' ? 'T_FAILED' : outcome === 'HALT' ? 'T_HALT' : outcome === 'PARKED_OK' ? 'T_PARKED_OK' : 'T_QUAR',
});

/** The crash points that exist in a stage. Effect stages have three, others have mid_stage. */
export function crashPointsFor(app: AppId, stageId: string): string[] {
  const s = APPS[app].stages.find((x) => x.id === stageId);
  if (!s) return [];
  return s.role === 'effect' ? ['before_effect', 'after_effect_before_journal', 'after_journal'] : ['mid_stage'];
}

/**
 * Outcome for one order. Returns null when the fault cannot hit that stage (the engine defers it).
 * `point` is required for crash-family faults.
 */
export function resolveOutcome(app: AppId, tierId: TierId, fault: string, stageId: string, point?: string): Outcome | null {
  const stages = APPS[app].stages;
  const idx = stages.findIndex((s) => s.id === stageId);
  if (idx < 0) return null;
  const stage = stages[idx];
  if (!faultApplies(fault, stage.role, stageId)) return null;
  const parts = new Set(TIERS[tierId].parts);
  const hasRetry = parts.has('retry');
  const journal = parts.has('journal');
  const idem = parts.has('idempotency');
  const phoenix = parts.has('breaker') && parts.has('offline_queue');
  const selfRows = (n = stage.effects.length): Rows => { const r: Rows = {}; stage.effects.slice(0, n).forEach((e) => add(r, e.kind)); return r; };

  // Ticket Desk faults act only on the real Python desk (the arena, tournaments, the improve loop). The mock model has no row for them.
  if (isDeskFault(fault)) return null;

  if (isCrashFault(fault)) {
    if (!point || !crashPointsFor(app, stageId).includes(point)) return null;
    const earlier = earlierEffects(app, idx);
    if (point === 'mid_stage') return journal ? done('OK') : (Object.keys(earlier).length ? done('REPEAT', earlier) : done('OK'));
    // Effect stage. The kill lands on the first effect of the stage.
    if (point === 'before_effect') return journal ? done('OK') : (Object.keys(earlier).length ? done('REPEAT', earlier) : done('OK'));
    if (point === 'after_effect_before_journal') {
      if (!journal) return done('REPEAT', merge(earlier, selfRows(1)));
      return idem ? done('OK') : done('REPEAT', selfRows(1));
    }
    // after_journal
    return journal ? done('OK') : done('REPEAT', merge(earlier, selfRows(1)));
  }

  if (fault === 'disk_full') return done('OK');
  if (fault === 'slow_link') return done('OK');

  if (fault === 'order_typo') {
    // Table L8: the wrong order is found later; the tier's default policy decides. Ledger rows come from the decision, not from repeats.
    const choice = TIER_DECISION_DEFAULT[tierId] ?? 'refund';
    if (choice === 'refund') return { outcome: 'CANCELLED', extraRows: {}, template: 'T_DECISION_REFUND' };
    return { outcome: 'OK', extraRows: {}, template: choice === 'discount' ? 'T_DECISION_DISCOUNT' : 'T_DECISION_REDO' };
  }

  if (stage.role === 'input') {
    const all = (): Rows => { const r: Rows = {}; stages.forEach((s) => s.effects.forEach((e) => add(r, e.kind))); return r; };
    if (fault === 'duplicate_request') return journal ? done('OK') : done('REPEAT', all());
    if (fault === 'missing_file') return !hasRetry ? done('HALT') : phoenix ? done('PARKED_OK') : done('FAILED');
    if (fault === 'malformed_payload') return !hasRetry ? done('HALT') : phoenix ? done('QUAR') : done('FAILED');
    return null;
  }

  if (stage.role === 'poll') {
    if (fault === 'internet_outage') return phoenix ? done('PARKED_OK') : done('FAILED');
    // Transit faults (V1_2 section 4). Timings follow the tracking poll (runtime.md section 7): a retry bot (calls at 0, 1.3 and 2.6 s) survives a stall under 2.6 s, Phoenix (backoff, calls at 0, 1.3, 3.1 and 5.9 s) one under 5.9 s.
    if (fault === 'weather' || fault === 'delay') return phoenix || hasRetry ? done('OK') : done('FAILED');
    // Out of gas outlasts every attempt; a missing parcel fails fast, so four quick failures open the breaker. Phoenix parks the order and resumes it.
    if (fault === 'out_of_gas' || fault === 'not_on_truck') return phoenix ? done('PARKED_OK') : done('FAILED');
    // hazard_event, driver_unreachable
    return phoenix ? done('OK') : done('FAILED');
  }

  if (stage.role === 'final') {
    // Handoff faults (table L5 to L7): only Phoenix survives; an accident outlasts the retries and parks.
    if (fault === 'no_answer' || fault === 'gated_house') return phoenix ? done('OK') : done('FAILED');
    if (fault === 'car_accident') return phoenix ? done('PARKED_OK') : done('FAILED');
    return null;
  }

  // effect stage with a provider fault
  if (stageId === 'updates' && fault !== 'internet_outage') {
    // Non-critical stage: failures are degraded, the order continues (runtime.md section 33).
    // A whole-internet outage is the exception: the window outlasts the stage and also hits the next stage (ship).
    if (fault === 'timeout' || fault === 'comm_timeout') {
      if (!hasRetry) return done('OK');
      return idem ? done('OK') : done('REPEAT', selfRows(1));
    }
    return done('OK');
  }
  switch (fault) {
    case 'timeout':
    case 'comm_timeout':
      if (!hasRetry) return done('FAILED');
      return idem ? done('OK') : done('REPEAT', selfRows());
    case 'http_404':
    case 'http_500':
      return hasRetry ? done('OK') : done('FAILED');
    case 'http_429':
      return phoenix ? done('OK') : done('FAILED');
    case 'internet_outage':
      // From `updates` the window ends while Phoenix is still backing off at `ship` (5 attempts, 500 ms doubling), so it rides it out.
      if (stageId === 'updates') return phoenix ? done('OK') : done('FAILED');
      return phoenix ? done('PARKED_OK') : done('FAILED');
    case 'endpoint_down':
    case 'sms_down':
    case 'app_down':
      return phoenix ? done('PARKED_OK') : done('FAILED');
    default:
      return null;
  }
}

/** Every applicable row of the table for an app, in a stable order. */
export function allOutcomeRows(app: AppId): OutcomeRow[] {
  const rows: OutcomeRow[] = [];
  for (const tier of TIER_ORDER) {
    for (const stage of APPS[app].stages) {
      for (const fault of FAULTS) {
        const points = isCrashFault(fault) ? crashPointsFor(app, stage.id) : [undefined];
        for (const point of points) {
          const o = resolveOutcome(app, tier, fault, stage.id, point);
          if (!o) continue;
          rows.push({ app, tier, fault, stage: stage.id, role: stage.role, ...(point ? { point } : {}), ...o });
        }
      }
    }
  }
  return rows;
}

// Referenced so a future edit that drops CRASH_POINTS from the catalog fails to compile here.
export const KNOWN_CRASH_POINTS: readonly string[] = CRASH_POINTS;
