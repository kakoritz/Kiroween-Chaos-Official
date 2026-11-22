// Event envelope and type lists (contract/PROTOCOL.md).

export interface HauntEvent {
  seq: number;
  ts: number;
  type: string;
  wave?: number;
  lane?: number;
  order?: string;
  stage?: string;
  detail?: Record<string, any>;
  // hello only
  contractVersion?: number;
  contractMinor?: number;
  mode?: string;
  app?: string;
  [extra: string]: unknown;
}

/** Events without a lane (PROTOCOL rule 16). */
export const GLOBAL_TYPES = ['hello', 'reset', 'wave_start', 'wave_end', 'boss_warning', 'boss_start', 'boss_end', 'hardening_spec', 'fix_applied', 'intensity'] as const;

/** Lane level events. */
export const LANE_TYPES = [
  'lane_ready', 'order_start', 'stage_start', 'stage_progress', 'stage_done', 'stage_fail', 'chaos', 'chaos_absorbed',
  'process_dead', 'process_up', 'recover_start', 'recover_done', 'effect', 'repeat', 'breaker', 'order_done', 'order_failed',
  'order_parked', 'order_resumed', 'order_quarantined', 'order_abandoned', 'lane_halted', 'part_added', 'score',
  'review', 'decision_needed', 'decision_made', 'outage',
] as const;

export const ALL_TYPES: string[] = [...GLOBAL_TYPES, ...LANE_TYPES];
export const isGlobalType = (t: string): boolean => (GLOBAL_TYPES as readonly string[]).includes(t);

export const CONTRACT_VERSION = 1;
