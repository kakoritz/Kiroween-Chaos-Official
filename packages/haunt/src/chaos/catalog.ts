// Fault catalog: which faults exist, where they apply, how they act.
// Spec: .kiro/specs/engine/design.md section 5; runtime.md sections 3, 19, 29.
import type { HookPoint } from '../sdk';

export type FaultKind = 'process' | 'provider' | 'file' | 'disk';
export type Family = 'process' | 'network' | 'http' | 'data' | 'world';

export const CRASH_POINTS: readonly HookPoint[] = [
  'before_effect', 'after_effect_before_journal', 'after_journal', 'mid_stage',
];
export const RECOVERY_POINTS: readonly HookPoint[] = ['during_replay', 'during_reconcile', 'during_backoff'];

/** Stages that make provider calls. */
export const EFFECT_STAGES: readonly string[] = ['account', 'payment', 'confirmation', 'dispatch', 'updates', 'tracking'];
/** Stages that run a journaled effect (tracking only polls), so only these have an fter_effect_before_journal hook. */
export const JOURNALED_EFFECT_STAGES: readonly string[] = EFFECT_STAGES.filter((s) => s !== 'tracking');
const ALL = ['intake', 'account', 'payment', 'confirmation', 'dispatch', 'updates', 'tracking', 'handoff'];

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
  def({ id: 'internet_outage', creature: 'banshee', family: 'network', kind: 'provider', stages: ['account', 'payment', 'confirmation', 'dispatch', 'updates', 'tracking'], forMs: 8000 }),
  def({ id: 'endpoint_down', creature: 'gargoyle', family: 'network', kind: 'provider', stages: EFFECT_STAGES, forMs: 10000 }),
  def({ id: 'timeout', creature: 'zombie', family: 'network', kind: 'provider', stages: ['account', 'payment', 'confirmation', 'dispatch'], count: 1 }),
  def({ id: 'comm_timeout', creature: 'zombie', family: 'network', kind: 'provider', stages: ['account', 'payment', 'confirmation', 'dispatch'], count: 1 }),
  def({ id: 'slow_link', creature: 'zombie', family: 'network', kind: 'provider', stages: EFFECT_STAGES, forMs: 6000 }),
  def({ id: 'http_404', creature: 'ghost', family: 'http', kind: 'provider', stages: ['account', 'payment', 'confirmation', 'dispatch'], count: 2 }),
  def({ id: 'http_429', creature: 'goblin', family: 'http', kind: 'provider', stages: ['payment', 'confirmation', 'dispatch'], count: 3 }),
  def({ id: 'http_500', creature: 'imp', family: 'http', kind: 'provider', stages: EFFECT_STAGES, count: 2 }),
  def({ id: 'missing_file', creature: 'poltergeist', family: 'data', kind: 'file', stages: ['intake'], forMs: 6000 }),
  def({ id: 'duplicate_request', creature: 'doppelganger', family: 'data', kind: 'file', stages: ['intake'], count: 1 }),
  def({ id: 'malformed_payload', creature: 'witch', family: 'data', kind: 'file', stages: ['intake'], count: 1 }),
  def({ id: 'disk_full', creature: 'mummy', family: 'data', kind: 'disk', stages: ALL, count: 1 }),
  def({ id: 'hazard_event', creature: 'werewolf', family: 'world', kind: 'provider', stages: ['tracking'], forMs: 5000 }),
  def({ id: 'sms_down', creature: 'gargoyle', family: 'network', kind: 'provider', stages: ['confirmation'], forMs: 8000 }),
  def({ id: 'app_down', creature: 'imp', family: 'http', kind: 'provider', stages: ['dispatch'], forMs: 8000 }),
  def({ id: 'updates_down', creature: 'goblin', family: 'http', kind: 'provider', stages: ['updates'], forMs: 8000 }),
  def({ id: 'wrong_address', creature: 'scarecrow', family: 'world', kind: 'provider', stages: ['tracking'], forMs: 5000 }),
  def({ id: 'no_answer', creature: 'black_cat', family: 'world', kind: 'provider', stages: ['handoff'], forMs: 3000 }),
  def({ id: 'gated_house', creature: 'black_cat', family: 'world', kind: 'provider', stages: ['handoff'], forMs: 3000 }),
  def({ id: 'car_accident', creature: 'phantom_car', family: 'world', kind: 'provider', stages: ['handoff'], forMs: 7000 }),
  def({ id: 'driver_unreachable', creature: 'will_o_wisp', family: 'world', kind: 'provider', stages: ['tracking'], forMs: 3000 }),
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

/** First stage at or after `from` (wrapping into the next order) where the fault applies. */
export function nextApplicableStage(f: FaultDef, from: string | null): { stage: string; nextOrder: boolean } {
  const i = from === null ? 0 : Math.max(0, ALL.indexOf(from));
  for (let j = i; j < ALL.length; j++) if (f.stages.includes(ALL[j]!)) return { stage: ALL[j]!, nextOrder: false };
  for (let j = 0; j < ALL.length; j++) if (f.stages.includes(ALL[j]!)) return { stage: ALL[j]!, nextOrder: true };
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
