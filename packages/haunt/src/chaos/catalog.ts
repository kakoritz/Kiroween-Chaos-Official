// Fault catalog: which faults exist, where they apply, how they act.
// Spec: .kiro/specs/engine/design.md section 5; runtime.md sections 3, 19, 29.
import type { HookPoint } from '../sdk/sdk';

/** `desk`: armed on the Python Ticket Desk, which applies the fault at its own stage (apps/haunted-inbox/bot/desk.py). */
export type FaultKind = 'process' | 'provider' | 'file' | 'disk' | 'desk';
export type Family = 'process' | 'network' | 'http' | 'data' | 'world';

export const CRASH_POINTS: readonly HookPoint[] = [
  'before_effect', 'after_effect_before_journal', 'after_journal', 'mid_stage',
];
export const RECOVERY_POINTS: readonly HookPoint[] = ['during_replay', 'during_reconcile', 'during_backoff'];

/** The Ticket Desk's stages in order (shared/catalog INBOX_STAGES). */
export const INBOX_ORDER: readonly string[] = ['login', 'ingest', 'validate', 'dedupe', 'triage', 'assign', 'sla', 'notify', 'escalate', 'resolve', 'close'];
/** Inbox stages that make provider calls. */
const INBOX_EFFECT: readonly string[] = ['login', 'assign', 'notify', 'escalate'];
/** The Stream app's stages in order (shared/catalog STREAM_STAGES) and the ones that make provider calls. */
export const STREAM_ORDER: readonly string[] = ['fetch', 'classify', 'draft', 'reply', 'archive'];
const STREAM_EFFECT: readonly string[] = ['fetch', 'draft', 'reply', 'archive'];
/** Stages that make provider calls. */
export const EFFECT_STAGES: readonly string[] = ['account', 'submit', 'payment', 'confirmation', 'receive', 'process', 'updates', 'ship', 'transit', ...INBOX_EFFECT, ...STREAM_EFFECT];
/** Stages that run a journaled effect (transit only polls), so only these have an after_effect_before_journal hook. */
export const JOURNALED_EFFECT_STAGES: readonly string[] = EFFECT_STAGES.filter((s) => s !== 'transit');
const ORDERS_ORDER = ['account', 'create', 'submit', 'payment', 'confirmation', 'receive', 'process', 'updates', 'ship', 'transit', 'handoff'];
const ALL = [...ORDERS_ORDER, ...INBOX_ORDER, ...STREAM_ORDER];
/** Effect stages that retry on a count fault (updates degrades instead, transit polls). */
const CALL_STAGES: readonly string[] = ['account', 'submit', 'payment', 'confirmation', 'receive', 'process', 'ship', 'login', 'assign', 'notify', 'escalate', ...STREAM_EFFECT];

export interface FaultDef {
  id: string;
  creature: string;
  family: Family;
  kind: FaultKind;
  /** Stages where it can land. */
  stages: readonly string[];
  /** Restart delay for process faults (ms, speed 1x). */
  restartMs?: number;
  /** Window length (ms) or number of calls. */
  forMs?: number;
  count?: number;
}

const def = (d: FaultDef): FaultDef => d;

export const FAULTS: readonly FaultDef[] = [
  def({ id: 'crash', creature: 'reaper', family: 'process', kind: 'process', stages: ALL, restartMs: 1000, count: 1 }),
  def({ id: 'out_of_memory', creature: 'reaper', family: 'process', kind: 'process', stages: ALL, restartMs: 2500, count: 1 }),
  def({ id: 'power_outage', creature: 'wraith', family: 'process', kind: 'process', stages: ALL, restartMs: 5000, count: 1 }),
  def({ id: 'internet_outage', creature: 'banshee', family: 'network', kind: 'provider', stages: EFFECT_STAGES, forMs: 8000 }),
  def({ id: 'endpoint_down', creature: 'gargoyle', family: 'network', kind: 'provider', stages: EFFECT_STAGES, forMs: 10000 }),
  def({ id: 'timeout', creature: 'zombie', family: 'network', kind: 'provider', stages: CALL_STAGES, count: 1 }),
  def({ id: 'comm_timeout', creature: 'zombie', family: 'network', kind: 'provider', stages: CALL_STAGES, count: 1 }),
  def({ id: 'slow_link', creature: 'zombie', family: 'network', kind: 'provider', stages: EFFECT_STAGES, forMs: 6000 }),
  def({ id: 'http_404', creature: 'ghost', family: 'http', kind: 'provider', stages: CALL_STAGES, count: 2 }),
  def({ id: 'http_429', creature: 'goblin', family: 'http', kind: 'provider', stages: ['payment', 'confirmation', 'ship', 'assign', 'notify', 'draft', 'reply'], count: 3 }),
  def({ id: 'http_500', creature: 'imp', family: 'http', kind: 'provider', stages: EFFECT_STAGES, count: 2 }),
  def({ id: 'missing_file', creature: 'poltergeist', family: 'data', kind: 'file', stages: ['create'], forMs: 6000 }),
  def({ id: 'duplicate_request', creature: 'doppelganger', family: 'data', kind: 'file', stages: ['create'], count: 1 }),
  def({ id: 'malformed_payload', creature: 'witch', family: 'data', kind: 'file', stages: ['create'], count: 1 }),
  def({ id: 'disk_full', creature: 'mummy', family: 'data', kind: 'disk', stages: ALL, count: 1 }),
  def({ id: 'hazard_event', creature: 'werewolf', family: 'world', kind: 'provider', stages: ['transit'], forMs: 5000 }),
  def({ id: 'sms_down', creature: 'gargoyle', family: 'network', kind: 'provider', stages: ['confirmation'], forMs: 8000 }),
  def({ id: 'app_down', creature: 'imp', family: 'http', kind: 'provider', stages: ['ship'], forMs: 8000 }),
  def({ id: 'updates_down', creature: 'goblin', family: 'http', kind: 'provider', stages: ['updates'], forMs: 8000 }),
  def({ id: 'wrong_address', creature: 'scarecrow', family: 'world', kind: 'provider', stages: ['transit'], forMs: 5000 }),
  def({ id: 'no_answer', creature: 'black_cat', family: 'world', kind: 'provider', stages: ['handoff'], forMs: 3000 }),
  def({ id: 'gated_house', creature: 'black_cat', family: 'world', kind: 'provider', stages: ['handoff'], forMs: 3000 }),
  def({ id: 'order_typo', creature: 'prankster', family: 'world', kind: 'provider', stages: ['create'], forMs: 0 }),
  def({ id: 'car_accident', creature: 'phantom_car', family: 'world', kind: 'provider', stages: ['handoff'], forMs: 7000 }),
  def({ id: 'weather', creature: 'storm_crow', family: 'world', kind: 'provider', stages: ['transit'], forMs: 1800 }),
  def({ id: 'road_hazard', creature: 'pothole_imp', family: 'world', kind: 'provider', stages: ['transit'], forMs: 4000 }),
  def({ id: 'delay', creature: 'scarecrow', family: 'world', kind: 'provider', stages: ['transit'], forMs: 600 }),
  def({ id: 'out_of_gas', creature: 'fuel_wraith', family: 'world', kind: 'provider', stages: ['transit'], forMs: 7000 }),
  def({ id: 'not_on_truck', creature: 'lost_parcel_ghoul', family: 'world', kind: 'provider', stages: ['transit'], forMs: 4000 }),
  def({ id: 'driver_unreachable', creature: 'will_o_wisp', family: 'world', kind: 'provider', stages: ['transit'], forMs: 3000 }),
  // Ticket Desk faults (packs spec section 4), creatures by name from the art we have. The Python desk applies the `desk` ones itself.
  def({ id: 'sla_breach', creature: 'banshee', family: 'network', kind: 'desk', stages: ['sla'], count: 1 }),
  def({ id: 'wrong_queue', creature: 'poltergeist', family: 'data', kind: 'desk', stages: ['triage'], count: 1 }),
  def({ id: 'duplicate_storm', creature: 'zombie', family: 'network', kind: 'desk', stages: ['dedupe'], count: 1 }),
  def({ id: 'sso_expired', creature: 'reaper', family: 'process', kind: 'provider', stages: ['login'], count: 1 }),
  def({ id: 'field_mapping_error', creature: 'witch', family: 'data', kind: 'desk', stages: ['validate'], count: 1 }),
  def({ id: 'webhook_retry_storm', creature: 'doppelganger', family: 'data', kind: 'desk', stages: ['ingest'], count: 1 }),
  def({ id: 'assignee_deleted', creature: 'ghost', family: 'http', kind: 'desk', stages: ['assign'], count: 1 }),
  def({ id: 'rate_limited', creature: 'goblin', family: 'http', kind: 'desk', stages: ['assign'], count: 1 }),
];

export const BOSSES = ['boss_power_outage', 'boss_internet_outage', 'boss_hazard_storm'] as const;
export type BossId = (typeof BOSSES)[number];

const BY_ID = new Map(FAULTS.map((f) => [f.id, f]));

export function faultById(id: string): FaultDef | undefined {
  return BY_ID.get(id);
}

export function isCrashFamily(f: FaultDef): boolean {
  return f.kind === 'process';
}

/** Restart delay doubles per nested crash, capped at 8000 ms. */
export const RESTART_CAP_MS = 8000;
export const MAX_DEPTH = 5;

export function restartDelay(base: number, nested: number): number {
  return Math.min(base * 2 ** nested, RESTART_CAP_MS);
}

/** First stage at or after `from` (wrapping into the next order) where the fault applies. `app` picks the stage list when `from` is unknown. */
export function nextApplicableStage(f: FaultDef, from: string | null, app: 'orders' | 'inbox' | 'stream' = 'orders'): { stage: string; nextOrder: boolean } {
  const order = from !== null && STREAM_ORDER.includes(from) ? STREAM_ORDER : from !== null && INBOX_ORDER.includes(from) && !ORDERS_ORDER.includes(from) ? INBOX_ORDER : from === null && app === 'stream' ? STREAM_ORDER : from === null && app === 'inbox' ? INBOX_ORDER : ORDERS_ORDER;
  const i = from === null ? 0 : Math.max(0, order.indexOf(from));
  for (let j = i; j < order.length; j++) if (f.stages.includes(order[j]!)) return { stage: order[j]!, nextOrder: false };
  for (let j = 0; j < order.length; j++) if (f.stages.includes(order[j]!)) return { stage: order[j]!, nextOrder: true };
  const hit = [ORDERS_ORDER, INBOX_ORDER, STREAM_ORDER].filter((o) => o !== order).flat().find((st) => f.stages.includes(st));
  if (hit) return { stage: hit, nextOrder: false };
  throw new Error(`fault ${f.id} applies to no stage`);
}

export type InjectedAt = 'before' | 'after_effect' | 'during' | 'recovery';

export function injectedAtFor(f: FaultDef, point: HookPoint | null, scope: 'inner' | 'outer'): InjectedAt {
  if (scope === 'inner') return 'recovery';
  if (f.kind !== 'process') return 'during';
  switch (point) {
    case 'after_effect_before_journal':
    case 'after_journal':
      return 'after_effect';
    case 'mid_stage':
      return 'during';
    case 'startup':
    case 'during_replay':
    case 'during_reconcile':
    case 'during_backoff':
      return 'recovery';
    default:
      return 'before';
  }
}
