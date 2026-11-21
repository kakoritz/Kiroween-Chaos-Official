// Shared catalogs: apps and stages, tiers, parts, faults, creatures. Source of truth for the
// IDs in contract/CONTRACT.md and the numbers in .kiro/specs/engine/design.md and runtime.md.

export type AppId = 'orders' | 'inbox';
export type TierId = 'rookie' | 'retrier' | 'journaler' | 'reconciler' | 'phoenix';
export type PartId = 'retry' | 'journal' | 'idempotency' | 'breaker' | 'offline_queue';
export type EffectKind = 'account_create' | 'charge' | 'email' | 'dispatch' | 'notify' | 'ticket';
export type StageRole = 'input' | 'work' | 'effect' | 'poll' | 'final';

export interface EffectDef {
  kind: EffectKind;
  /** Idempotency key suffix. The full key is `<order>:<key>`. */
  key: string;
  /** Provider service name used by faults and the breaker. */
  service: string;
}

export interface StageDef {
  id: string;
  label: string;
  icon: string;
  workAnimation: string;
  role: StageRole;
  /** Work sleep range at 1x, ms. */
  min: number;
  max: number;
  effects: EffectDef[];
  /** Short verb phrase shown in stage_progress labels. */
  verb: string;
}

export const ORDERS_STAGES: StageDef[] = [
  { id: 'intake', label: 'Order intake', icon: 'mail', workAnimation: 'read_mail', role: 'input', min: 400, max: 900, effects: [], verb: 'Reading order' },
  { id: 'account', label: 'Account creation', icon: 'user', workAnimation: 'fill_form', role: 'effect', min: 500, max: 1000, effects: [{ kind: 'account_create', key: 'account', service: 'account' }], verb: 'Creating account' },
  { id: 'payment', label: 'Payment processing', icon: 'card', workAnimation: 'swipe_card', role: 'effect', min: 800, max: 1500, effects: [{ kind: 'charge', key: 'charge', service: 'charge' }], verb: 'Charging card' },
  { id: 'confirmation', label: 'Confirmation', icon: 'envelope', workAnimation: 'write_letter', role: 'effect', min: 400, max: 800, effects: [{ kind: 'email', key: 'email', service: 'email' }], verb: 'Sending confirmation' },
  { id: 'dispatch', label: 'Dispatch to delivery', icon: 'box', workAnimation: 'load_scooter', role: 'effect', min: 600, max: 1200, effects: [{ kind: 'dispatch', key: 'dispatch', service: 'dispatch' }], verb: 'Booking delivery' },
  { id: 'updates', label: 'Order updates', icon: 'bubbles', workAnimation: 'send_bubbles', role: 'effect', min: 400, max: 800, effects: [{ kind: 'notify', key: 'notify:1', service: 'notify' }, { kind: 'notify', key: 'notify:2', service: 'notify' }], verb: 'Sending updates' },
  { id: 'tracking', label: 'Delivery tracking', icon: 'road', workAnimation: 'scooter_road', role: 'poll', min: 1500, max: 3000, effects: [], verb: 'Tracking delivery' },
  { id: 'handoff', label: 'Handoff', icon: 'door', workAnimation: 'doorstep', role: 'final', min: 300, max: 600, effects: [], verb: 'Handing off' },
];

// The inbox durations are not fixed by the specs (assumption, see docs/DECISIONS.md).
export const INBOX_STAGES: StageDef[] = [
  { id: 'fetch', label: 'Fetch mail', icon: 'mail', workAnimation: 'read_mail', role: 'input', min: 300, max: 700, effects: [], verb: 'Fetching mail' },
  { id: 'classify', label: 'Classify', icon: 'brain', workAnimation: 'think', role: 'work', min: 600, max: 1100, effects: [], verb: 'Classifying' },
  { id: 'ticket', label: 'File ticket', icon: 'ticket', workAnimation: 'file_ticket', role: 'effect', min: 500, max: 1000, effects: [{ kind: 'ticket', key: 'ticket', service: 'ticket' }], verb: 'Filing ticket' },
  { id: 'draft', label: 'Draft reply', icon: 'envelope', workAnimation: 'write_letter', role: 'work', min: 800, max: 1400, effects: [], verb: 'Drafting reply' },
  { id: 'reply', label: 'Send reply', icon: 'plane', workAnimation: 'send_letter', role: 'effect', min: 500, max: 1000, effects: [{ kind: 'email', key: 'reply', service: 'reply' }], verb: 'Sending reply' },
  { id: 'archive', label: 'Archive', icon: 'archive', workAnimation: 'archive_box', role: 'final', min: 300, max: 600, effects: [], verb: 'Archiving' },
];

export const APPS: Record<AppId, { id: AppId; label: string; stages: StageDef[]; orderPrefix: string }> = {
  orders: { id: 'orders', label: 'Haunted Orders', stages: ORDERS_STAGES, orderPrefix: 'ord' },
  inbox: { id: 'inbox', label: 'Haunted Inbox', stages: INBOX_STAGES, orderPrefix: 'msg' },
};

export function orderId(app: AppId, index: number): string {
  return `${APPS[app].orderPrefix}-${String(index).padStart(4, '0')}`;
}

export const PARTS: Record<PartId, { id: PartId; label: string }> = {
  journal: { id: 'journal', label: 'Spellbook' },
  idempotency: { id: 'idempotency', label: 'Seal' },
  retry: { id: 'retry', label: 'Lantern' },
  breaker: { id: 'breaker', label: 'Shield' },
  offline_queue: { id: 'offline_queue', label: 'Coffin Stash' },
};
export const PART_ORDER: PartId[] = ['journal', 'idempotency', 'retry', 'breaker', 'offline_queue'];

export const TIERS: Record<TierId, { id: TierId; label: string; parts: PartId[] }> = {
  rookie: { id: 'rookie', label: 'Rookie', parts: [] },
  retrier: { id: 'retrier', label: 'Retrier', parts: ['retry'] },
  journaler: { id: 'journaler', label: 'Journaler', parts: ['retry', 'journal'] },
  reconciler: { id: 'reconciler', label: 'Reconciler', parts: ['retry', 'journal', 'idempotency'] },
  phoenix: { id: 'phoenix', label: 'Phoenix', parts: ['retry', 'journal', 'idempotency', 'breaker', 'offline_queue'] },
};
export const TIER_ORDER: TierId[] = ['rookie', 'retrier', 'journaler', 'reconciler', 'phoenix'];

/** Lane to tier mapping (runtime.md section 11). */
export function laneTiers(lanes: number, mode: 'race' | 'allPhoenix'): TierId[] {
  if (mode === 'allPhoenix') return Array.from({ length: lanes }, () => 'phoenix' as TierId);
  const sets: Record<number, TierId[]> = {
    1: ['phoenix'],
    2: ['rookie', 'phoenix'],
    3: ['rookie', 'journaler', 'phoenix'],
    4: ['rookie', 'retrier', 'journaler', 'phoenix'],
    5: TIER_ORDER,
  };
  return sets[lanes] ?? TIER_ORDER.slice(0, lanes);
}

export type FaultId =
  | 'crash' | 'out_of_memory' | 'power_outage'
  | 'internet_outage' | 'endpoint_down' | 'timeout' | 'comm_timeout' | 'slow_link'
  | 'http_404' | 'http_429' | 'http_500'
  | 'missing_file' | 'duplicate_request' | 'malformed_payload' | 'disk_full'
  | 'hazard_event' | 'driver_unreachable'
  | 'sms_down' | 'app_down' | 'updates_down'
  | 'wrong_address' | 'no_answer' | 'gated_house' | 'car_accident';
export type BossFaultId = 'boss_power_outage' | 'boss_internet_outage' | 'boss_hazard_storm';

export const FAULTS: FaultId[] = [
  'crash', 'out_of_memory', 'power_outage', 'internet_outage', 'endpoint_down', 'timeout', 'comm_timeout', 'slow_link',
  'http_404', 'http_429', 'http_500', 'missing_file', 'duplicate_request', 'malformed_payload', 'disk_full',
  'hazard_event', 'driver_unreachable', 'sms_down', 'app_down', 'updates_down',
  'wrong_address', 'no_answer', 'gated_house', 'car_accident',
];
export const BOSS_FAULTS: BossFaultId[] = ['boss_power_outage', 'boss_internet_outage', 'boss_hazard_storm'];

export const CRASH_FAULTS: FaultId[] = ['crash', 'out_of_memory', 'power_outage'];
export const CRASH_POINTS = ['before_effect', 'after_effect_before_journal', 'after_journal', 'mid_stage'] as const;
export type CrashPoint = (typeof CRASH_POINTS)[number];

/** Restart delay after a kill, ms at 1x (design.md section 5). */
export const RESTART_MS: Record<string, number> = { crash: 1000, out_of_memory: 2500, power_outage: 5000 };
export const RESTART_CAP_MS = 8000;

export const isCrashFault = (f: string): boolean => CRASH_FAULTS.includes(f as FaultId);
export const isBossFault = (f: string): boolean => BOSS_FAULTS.includes(f as BossFaultId);

export interface CreatureDef {
  id: string;
  label: string;
  family: 'process' | 'network' | 'http' | 'data' | 'world';
  sprite: string;
  causes: string[];
  boss: boolean;
  apps: AppId[];
  description: string;
}

const both: AppId[] = ['orders', 'inbox'];
export const CREATURES: CreatureDef[] = [
  { id: 'reaper', label: 'Reaper', family: 'process', sprite: 'reaper', causes: ['crash', 'out_of_memory'], boss: false, apps: both, description: 'Kills the bot process without warning.' },
  { id: 'wraith', label: 'Wraith', family: 'world', sprite: 'wraith', causes: ['power_outage'], boss: false, apps: both, description: 'Cuts the power. The bot stays dead for five seconds.' },
  { id: 'banshee', label: 'Banshee', family: 'network', sprite: 'banshee', causes: ['internet_outage'], boss: false, apps: both, description: 'Drops every connection to the outside world.' },
  { id: 'zombie', label: 'Zombie', family: 'network', sprite: 'zombie', causes: ['timeout', 'comm_timeout', 'slow_link'], boss: false, apps: both, description: 'Makes calls crawl, or never answer in time.' },
  { id: 'ghost', label: 'Ghost', family: 'http', sprite: 'ghost', causes: ['http_404'], boss: false, apps: both, description: 'Makes an endpoint vanish for two calls.' },
  { id: 'goblin', label: 'Goblin', family: 'http', sprite: 'goblin', causes: ['http_429', 'updates_down'], boss: false, apps: both, description: 'Floods the service until it says slow down.' },
  { id: 'imp', label: 'Imp', family: 'http', sprite: 'imp', causes: ['http_500', 'app_down'], boss: false, apps: both, description: 'Makes the service fail for two calls.' },
  { id: 'gargoyle', label: 'Gargoyle', family: 'http', sprite: 'gargoyle', causes: ['endpoint_down', 'sms_down'], boss: false, apps: both, description: 'Takes one endpoint down for ten seconds.' },
  { id: 'poltergeist', label: 'Poltergeist', family: 'data', sprite: 'poltergeist', causes: ['missing_file'], boss: false, apps: both, description: 'Hides the input file.' },
  { id: 'doppelganger', label: 'Doppelganger', family: 'data', sprite: 'doppelganger', causes: ['duplicate_request'], boss: false, apps: both, description: 'Sends the same request twice.' },
  { id: 'witch', label: 'Witch', family: 'data', sprite: 'witch', causes: ['malformed_payload'], boss: false, apps: both, description: 'Curses the input so it cannot be read.' },
  { id: 'mummy', label: 'Mummy', family: 'process', sprite: 'mummy', causes: ['disk_full'], boss: false, apps: both, description: 'Fills the disk so one journal write fails.' },
  { id: 'werewolf', label: 'Werewolf', family: 'world', sprite: 'werewolf', causes: ['hazard_event'], boss: false, apps: ['orders'], description: 'Stalls the tracking feed.' },
  { id: 'will_o_wisp', label: "Will-o'-the-Wisp", family: 'world', sprite: 'will_o_wisp', causes: ['driver_unreachable'], boss: false, apps: ['orders'], description: 'Leads the delivery driver astray.' },
  { id: 'scarecrow', label: 'Scarecrow', family: 'world', sprite: 'scarecrow', causes: ['wrong_address'], boss: false, apps: ['orders'], description: 'Points the scooter down the wrong road.' },
  { id: 'black_cat', label: 'Black Cat', family: 'world', sprite: 'black_cat', causes: ['no_answer', 'gated_house'], boss: false, apps: ['orders'], description: 'Sits on the doorstep so nobody answers, or shuts the gate.' },
  { id: 'phantom_car', label: 'Phantom Car', family: 'world', sprite: 'phantom_car', causes: ['car_accident'], boss: false, apps: ['orders'], description: 'Crashes at the door and blocks the road.' },
  { id: 'lich', label: 'Lich', family: 'world', sprite: 'lich', causes: ['boss_power_outage'], boss: true, apps: both, description: 'Boss. Cuts the power on every lane at once.' },
  { id: 'banshee_queen', label: 'Banshee Queen', family: 'network', sprite: 'banshee_queen', causes: ['boss_internet_outage'], boss: true, apps: both, description: 'Boss. A twelve second internet outage on every lane.' },
  { id: 'headless_horseman', label: 'Headless Horseman', family: 'world', sprite: 'headless_horseman', causes: ['boss_hazard_storm'], boss: true, apps: both, description: 'Boss. A hazard storm and rate limits on every lane.' },
];

export function creatureForFault(fault: string): CreatureDef | undefined {
  return CREATURES.find((c) => c.causes.includes(fault));
}

/** Which roles a fault can hit (runtime.md section 9). A fault that cannot hit the current stage is deferred. */
/** World faults that only land on one orders stage (design.md section 7). Others defer to it. */
export const WORLD_FAULT_STAGE: Record<string, string> = { sms_down: 'confirmation', app_down: 'dispatch', updates_down: 'updates', wrong_address: 'tracking', no_answer: 'handoff', gated_house: 'handoff', car_accident: 'handoff' };
const WORLD_STAGE_ROLE: Record<string, StageRole> = { tracking: 'poll', handoff: 'final' } as Record<string, StageRole>;

export function faultApplies(fault: string, role: StageRole, stageId?: string): boolean {
  if (WORLD_FAULT_STAGE[fault]) return role === (WORLD_STAGE_ROLE[WORLD_FAULT_STAGE[fault]!] ?? 'effect') && (stageId === undefined || stageId === WORLD_FAULT_STAGE[fault]);
  if (isCrashFault(fault) || fault === 'disk_full') return true;
  switch (fault) {
    case 'missing_file':
    case 'malformed_payload':
    case 'duplicate_request':
      return role === 'input';
    case 'hazard_event':
    case 'driver_unreachable':
      return role === 'poll';
    case 'internet_outage':
    case 'slow_link':
      return role === 'effect' || role === 'poll';
    default:
      // timeout, comm_timeout, http_*, endpoint_down
      return role === 'effect';
  }
}

/** Pipeline and provider constants at 1x (runtime.md sections 4, 7, 18, 28). */
export const TIMING = {
  clientTimeoutMs: 1500,
  pollTimeoutMs: 800,
  pollIntervalMs: 300,
  retryDelayMs: 500,
  backoffBaseMs: 500,
  breakerOpenMs: 5000,
  retryAttempts: 3,
  breakerAttempts: 5,
  breakerFailures: 4,
  latencyMin: 50,
  latencyMax: 70,
  journalWriteMs: 8,
  deliveredOnPoll: 5,
  bossWarnMs: 8000,
  progressMs: 300,
} as const;

/** Window and count faults (design.md section 5, runtime.md section 4). */
export const FAULT_PARAMS: Record<string, { count?: number; forMs?: number; latency?: number; status?: number; retryAfterMs?: number }> = {
  timeout: { count: 1, latency: 3000 },
  comm_timeout: { count: 1, latency: 3000 },
  slow_link: { forMs: 6000, latency: 600 },
  http_404: { count: 2, status: 404 },
  http_500: { count: 2, status: 500 },
  http_429: { count: 3, status: 429, retryAfterMs: 2000 },
  internet_outage: { forMs: 8000 },
  endpoint_down: { forMs: 10000, status: 503 },
  sms_down: { forMs: 8000, status: 503 },
  app_down: { forMs: 8000, status: 503 },
  updates_down: { forMs: 8000, status: 503 },
  wrong_address: { forMs: 5000 },
  no_answer: { forMs: 3000 },
  gated_house: { forMs: 3000 },
  car_accident: { forMs: 7000 },
  hazard_event: { forMs: 5000 },
  driver_unreachable: { forMs: 3000 },
};

export const GRADES = ['A', 'B', 'C', 'D', 'F'] as const;
export type Grade = (typeof GRADES)[number];
export function gradeFor(reliability: number): Grade {
  return reliability >= 90 ? 'A' : reliability >= 80 ? 'B' : reliability >= 65 ? 'C' : reliability >= 50 ? 'D' : 'F';
}
export function worseGrade(a: Grade, b: Grade): Grade {
  return GRADES.indexOf(a) >= GRADES.indexOf(b) ? a : b;
}
export function capGrade(g: Grade, cap: Grade): Grade {
  return worseGrade(g, cap);
}
