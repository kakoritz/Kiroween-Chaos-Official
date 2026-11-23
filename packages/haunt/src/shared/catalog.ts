// Shared catalogs: apps and stages, tiers, parts, faults, creatures. Source of truth for the
// IDs in contract/CONTRACT.md and the numbers in .kiro/specs/engine/design.md and runtime.md.

export type AppId = 'orders' | 'inbox';
export type TierId = 'rookie' | 'retrier' | 'journaler' | 'reconciler' | 'phoenix';
export type PartId = 'retry' | 'journal' | 'idempotency' | 'breaker' | 'offline_queue';
export type EffectKind = 'account_create' | 'order' | 'charge' | 'email' | 'store' | 'dispatch' | 'notify' | 'ticket';
export type StageRole = 'input' | 'work' | 'effect' | 'poll' | 'final';

/** Stage kind carried in the contract's `stages` list (V1_2.md section 1). */
export type StageKind = 'effect' | 'read' | 'poll' | 'final';
export const stageKind = (role: StageRole): StageKind => (role === 'input' || role === 'work' ? 'read' : role);

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
  { id: 'account', label: 'Account or login', icon: 'user', workAnimation: 'fill_form', role: 'effect', min: 400, max: 800, effects: [{ kind: 'account_create', key: 'account', service: 'account' }], verb: 'Logging in' },
  { id: 'create', label: 'Create order', icon: 'mail', workAnimation: 'read_mail', role: 'input', min: 300, max: 700, effects: [], verb: 'Reading order' },
  { id: 'submit', label: 'Submit order', icon: 'plane', workAnimation: 'send_letter', role: 'effect', min: 200, max: 400, effects: [{ kind: 'order', key: 'order', service: 'order' }], verb: 'Submitting order' },
  { id: 'payment', label: 'Payment', icon: 'card', workAnimation: 'swipe_card', role: 'effect', min: 700, max: 1300, effects: [{ kind: 'charge', key: 'charge', service: 'charge' }], verb: 'Charging card' },
  { id: 'confirmation', label: 'Confirmation', icon: 'envelope', workAnimation: 'write_letter', role: 'effect', min: 300, max: 600, effects: [{ kind: 'email', key: 'email', service: 'email' }], verb: 'Sending confirmation' },
  { id: 'receive', label: 'Store receives', icon: 'box', workAnimation: 'archive_box', role: 'effect', min: 200, max: 400, effects: [{ kind: 'store', key: 'store:1', service: 'store' }], verb: 'Store receiving' },
  { id: 'process', label: 'Process order', icon: 'brain', workAnimation: 'think', role: 'effect', min: 300, max: 600, effects: [{ kind: 'store', key: 'store:2', service: 'store' }], verb: 'Preparing items' },
  { id: 'updates', label: 'Order updates', icon: 'bubbles', workAnimation: 'send_bubbles', role: 'effect', min: 300, max: 600, effects: [{ kind: 'notify', key: 'notify:1', service: 'notify' }, { kind: 'notify', key: 'notify:2', service: 'notify' }], verb: 'Sending updates' },
  { id: 'ship', label: 'Ship and pack', icon: 'box', workAnimation: 'load_scooter', role: 'effect', min: 500, max: 1000, effects: [{ kind: 'dispatch', key: 'dispatch', service: 'dispatch' }], verb: 'Packing and shipping' },
  { id: 'transit', label: 'Delivery updates', icon: 'road', workAnimation: 'scooter_road', role: 'poll', min: 1500, max: 3000, effects: [], verb: 'Tracking delivery' },
  { id: 'handoff', label: 'Handoff', icon: 'door', workAnimation: 'doorstep', role: 'final', min: 300, max: 600, effects: [], verb: 'Handing off' },
];

// The Ticket Desk (PK-C3, packs spec section 4): the Python inbox as a service desk. Durations are not fixed by the specs
// (assumption, see docs/DECISIONS.md); apps/haunted-inbox/haunt.yaml and bot/run.py carry the same eleven stages.
export const INBOX_STAGES: StageDef[] = [
  { id: 'login', label: 'SSO login', icon: 'user', workAnimation: 'fill_form', role: 'effect', min: 300, max: 600, effects: [{ kind: 'account_create', key: 'login', service: 'account' }], verb: 'Signing in with SSO' },
  { id: 'ingest', label: 'Ingest request', icon: 'mail', workAnimation: 'read_mail', role: 'input', min: 400, max: 700, effects: [], verb: 'Ingesting request' },
  { id: 'validate', label: 'Validate', icon: 'brain', workAnimation: 'think', role: 'work', min: 300, max: 600, effects: [], verb: 'Validating fields' },
  { id: 'dedupe', label: 'Deduplicate', icon: 'brain', workAnimation: 'think', role: 'work', min: 300, max: 600, effects: [], verb: 'Checking duplicates' },
  { id: 'triage', label: 'Triage', icon: 'brain', workAnimation: 'think', role: 'work', min: 400, max: 800, effects: [], verb: 'Triaging' },
  { id: 'assign', label: 'Assign ticket', icon: 'ticket', workAnimation: 'file_ticket', role: 'effect', min: 500, max: 900, effects: [{ kind: 'ticket', key: 'ticket', service: 'ticket' }], verb: 'Filing ticket' },
  { id: 'sla', label: 'SLA clock', icon: 'brain', workAnimation: 'think', role: 'work', min: 200, max: 400, effects: [], verb: 'Starting the SLA clock' },
  { id: 'notify', label: 'Notify requester', icon: 'envelope', workAnimation: 'write_letter', role: 'effect', min: 400, max: 800, effects: [{ kind: 'email', key: 'reply', service: 'reply' }], verb: 'Sending reply' },
  { id: 'escalate', label: 'Escalate', icon: 'bubbles', workAnimation: 'send_bubbles', role: 'effect', min: 300, max: 600, effects: [{ kind: 'notify', key: 'escalate', service: 'notify' }], verb: 'Escalating' },
  { id: 'resolve', label: 'Resolve', icon: 'box', workAnimation: 'archive_box', role: 'work', min: 300, max: 600, effects: [], verb: 'Resolving' },
  { id: 'close', label: 'Close and survey', icon: 'archive', workAnimation: 'archive_box', role: 'final', min: 300, max: 500, effects: [], verb: 'Closing' },
];
export const APPS: Record<AppId, { id: AppId; label: string; stages: StageDef[]; orderPrefix: string }> = {
  orders: { id: 'orders', label: 'Haunted Orders', stages: ORDERS_STAGES, orderPrefix: 'ord' },
  inbox: { id: 'inbox', label: 'Haunted Inbox', stages: INBOX_STAGES, orderPrefix: 'msg' },
};

/** Wording of one app, so UI lines and review text read right (a ticket desk talks about tickets and replies, not orders and charges). */
export interface AppVocab {
  /** What one unit of work is called, lower case. */
  unit: string;
  /** Id prefix shown for a unit (the bot's file ids keep `ord-`; the UI shows this one). */
  idPrefix: string;
  /** Verb for the lane picking a unit up ("grabbed order", "picked up ticket"). */
  start: string;
  /** Past tense of finishing one. */
  done: string;
  /** The effect kind whose repeat is the app's worst double-effect (a second charge, a second ticket). */
  dupKind: string;
  /** Review reason for that double effect. */
  dupReason: string;
  /** Review reasons by sub-score, low and high. */
  low: { timeliness: string; delays: string; issues: string; delivery: string; ease: string };
  high: { timeliness: string; delays: string; issues: string; delivery: string; ease: string };
  /** Review reason when a wrong decision was taken. */
  wrong: string;
  /** Review reason of a cancelled unit. */
  never: string;
  /** Lane-line text of a cancelled unit. */
  cancelled: string;
}
export const APP_VOCAB: Record<AppId, AppVocab> = {
  orders: {
    unit: 'order', idPrefix: 'ord', start: 'grabbed', done: 'delivered', dupKind: 'charge', dupReason: 'Charged twice!', wrong: 'Wrong order', never: 'Never arrived', cancelled: 'ORDER CANCELLED',
    low: { timeliness: 'Took forever to arrive', delays: 'Kept me waiting', issues: 'So many hiccups', delivery: 'Wrong order', ease: 'Hard to order' },
    high: { timeliness: 'Lightning fast', delays: 'No waiting around', issues: 'Smooth as a ghost', delivery: 'Everything arrived right', ease: 'Easy to order' },
  },
  inbox: {
    unit: 'ticket', idPrefix: 'tkt', start: 'picked up', done: 'resolved', dupKind: 'ticket', dupReason: 'Filed a duplicate ticket!', wrong: 'Wrong answer', never: 'Never answered', cancelled: 'TICKET CANCELLED',
    low: { timeliness: 'Took forever to answer', delays: 'Kept me waiting', issues: 'So many hiccups', delivery: 'Wrong answer', ease: 'Hard to reach support' },
    high: { timeliness: 'Answered in a flash', delays: 'No waiting around', issues: 'Smooth as a ghost', delivery: 'Got the right answer', ease: 'Easy to reach support' },
  },
};
export const vocabOf = (app: string | undefined): AppVocab => APP_VOCAB[app === 'inbox' ? 'inbox' : 'orders'];

/** Contract stage list for an app (V1_2.md section 1): `[{id, label, kind}]`. */
export function stageList(app: AppId): { id: string; label: string; kind: StageKind }[] {
  return APPS[app].stages.map((s) => ({ id: s.id, label: s.label, kind: stageKind(s.role) }));
}

/** Pre-v1.2 orders stage ids and what they became (V1_2.md section 1; `intake` is now `create` then `submit`). */
export const LEGACY_STAGE_MAP: Readonly<Record<string, string>> = { intake: 'create', dispatch: 'ship', tracking: 'transit' };
/** Maps a legacy stage id to the current one so old recorded runs and fixtures still load. Unknown ids pass through. */
export function legacyStage(id: string): string {
  return LEGACY_STAGE_MAP[id] ?? id;
}

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
  | 'wrong_address' | 'no_answer' | 'gated_house' | 'car_accident'
  | 'weather' | 'road_hazard' | 'delay' | 'out_of_gas' | 'not_on_truck'
  | 'order_typo'
  | 'sla_breach' | 'wrong_queue' | 'duplicate_storm' | 'sso_expired' | 'field_mapping_error' | 'webhook_retry_storm' | 'assignee_deleted' | 'rate_limited';
export type BossFaultId = 'boss_power_outage' | 'boss_internet_outage' | 'boss_hazard_storm';

export const FAULTS: FaultId[] = [
  'crash', 'out_of_memory', 'power_outage', 'internet_outage', 'endpoint_down', 'timeout', 'comm_timeout', 'slow_link',
  'http_404', 'http_429', 'http_500', 'missing_file', 'duplicate_request', 'malformed_payload', 'disk_full',
  'hazard_event', 'driver_unreachable', 'sms_down', 'app_down', 'updates_down',
  'wrong_address', 'no_answer', 'gated_house', 'car_accident',
  'weather', 'road_hazard', 'delay', 'out_of_gas', 'not_on_truck',
  'order_typo',
  'sla_breach', 'wrong_queue', 'duplicate_storm', 'sso_expired', 'field_mapping_error', 'webhook_retry_storm', 'assignee_deleted', 'rate_limited',
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
  { id: 'reaper', label: 'Reaper', family: 'process', sprite: 'reaper', causes: ['crash', 'out_of_memory', 'sso_expired'], boss: false, apps: both, description: 'Kills the bot process without warning.' },
  { id: 'wraith', label: 'Wraith', family: 'world', sprite: 'wraith', causes: ['power_outage'], boss: false, apps: both, description: 'Cuts the power. The bot stays dead for five seconds.' },
  { id: 'banshee', label: 'Banshee', family: 'network', sprite: 'banshee', causes: ['internet_outage', 'sla_breach'], boss: false, apps: both, description: 'Drops every connection to the outside world.' },
  { id: 'zombie', label: 'Zombie', family: 'network', sprite: 'zombie', causes: ['timeout', 'comm_timeout', 'slow_link', 'duplicate_storm'], boss: false, apps: both, description: 'Makes calls crawl, or never answer in time.' },
  { id: 'ghost', label: 'Ghost', family: 'http', sprite: 'ghost', causes: ['http_404', 'assignee_deleted'], boss: false, apps: both, description: 'Makes an endpoint vanish for two calls.' },
  { id: 'goblin', label: 'Goblin', family: 'http', sprite: 'goblin', causes: ['http_429', 'updates_down', 'rate_limited'], boss: false, apps: both, description: 'Floods the service until it says slow down.' },
  { id: 'imp', label: 'Imp', family: 'http', sprite: 'imp', causes: ['http_500', 'app_down'], boss: false, apps: both, description: 'Makes the service fail for two calls.' },
  { id: 'gargoyle', label: 'Gargoyle', family: 'http', sprite: 'gargoyle', causes: ['endpoint_down', 'sms_down'], boss: false, apps: both, description: 'Takes one endpoint down for ten seconds.' },
  { id: 'poltergeist', label: 'Poltergeist', family: 'data', sprite: 'poltergeist', causes: ['missing_file', 'wrong_queue'], boss: false, apps: both, description: 'Hides the input file.' },
  { id: 'doppelganger', label: 'Doppelganger', family: 'data', sprite: 'doppelganger', causes: ['duplicate_request', 'webhook_retry_storm'], boss: false, apps: both, description: 'Sends the same request twice.' },
  { id: 'witch', label: 'Witch', family: 'data', sprite: 'witch', causes: ['malformed_payload', 'field_mapping_error'], boss: false, apps: both, description: 'Curses the input so it cannot be read.' },
  { id: 'mummy', label: 'Mummy', family: 'process', sprite: 'mummy', causes: ['disk_full'], boss: false, apps: both, description: 'Fills the disk so one journal write fails.' },
  { id: 'werewolf', label: 'Werewolf', family: 'world', sprite: 'werewolf', causes: ['hazard_event'], boss: false, apps: ['orders'], description: 'Stalls the delivery feed.' },
  { id: 'will_o_wisp', label: "Will-o'-the-Wisp", family: 'world', sprite: 'will_o_wisp', causes: ['driver_unreachable'], boss: false, apps: ['orders'], description: 'Leads the delivery driver astray.' },
  { id: 'scarecrow', label: 'Scarecrow', family: 'world', sprite: 'scarecrow', causes: ['wrong_address', 'delay'], boss: false, apps: ['orders'], description: 'Points the scooter down the wrong road, or holds it up.' },
  { id: 'storm_crow', label: 'Storm Crow', family: 'world', sprite: 'storm_crow', causes: ['weather'], boss: false, apps: ['orders'], description: 'Calls a storm over the delivery road.' },
  { id: 'pothole_imp', label: 'Pothole Imp', family: 'world', sprite: 'pothole_imp', causes: ['road_hazard'], boss: false, apps: ['orders'], description: 'Digs a pothole in the middle of the road.' },
  { id: 'fuel_wraith', label: 'Fuel Wraith', family: 'world', sprite: 'fuel_wraith', causes: ['out_of_gas'], boss: false, apps: ['orders'], description: 'Drinks the scooter dry.' },
  { id: 'lost_parcel_ghoul', label: 'Lost Parcel Ghoul', family: 'world', sprite: 'lost_parcel_ghoul', causes: ['not_on_truck'], boss: false, apps: ['orders'], description: 'Steals the parcel off the truck.' },
  { id: 'black_cat', label: 'Black Cat', family: 'world', sprite: 'black_cat', causes: ['no_answer', 'gated_house'], boss: false, apps: ['orders'], description: 'Sits on the doorstep so nobody answers, or shuts the gate.' },
  { id: 'phantom_car', label: 'Phantom Car', family: 'world', sprite: 'phantom_car', causes: ['car_accident'], boss: false, apps: ['orders'], description: 'Crashes at the door and blocks the road.' },
  { id: 'prankster', label: 'Prankster', family: 'world', sprite: 'prankster', causes: ['order_typo'], boss: false, apps: ['orders'], description: 'Swaps the items on the order so the wrong thing is made.' },
  { id: 'lich', label: 'Lich', family: 'world', sprite: 'lich', causes: ['boss_power_outage'], boss: true, apps: both, description: 'Boss. Cuts the power on every lane at once.' },
  { id: 'banshee_queen', label: 'Banshee Queen', family: 'network', sprite: 'banshee_queen', causes: ['boss_internet_outage'], boss: true, apps: both, description: 'Boss. A twelve second internet outage on every lane.' },
  { id: 'headless_horseman', label: 'Headless Horseman', family: 'world', sprite: 'headless_horseman', causes: ['boss_hazard_storm'], boss: true, apps: both, description: 'Boss. A hazard storm and rate limits on every lane.' },
];

export function creatureForFault(fault: string): CreatureDef | undefined {
  return CREATURES.find((c) => c.causes.includes(fault));
}

/** Which roles a fault can hit (runtime.md section 9). A fault that cannot hit the current stage is deferred. */
/** World faults that only land on one orders stage (design.md section 7). Others defer to it. */
export const WORLD_FAULT_STAGE: Record<string, string> = { sms_down: 'confirmation', app_down: 'ship', updates_down: 'updates', wrong_address: 'transit', weather: 'transit', road_hazard: 'transit', delay: 'transit', out_of_gas: 'transit', not_on_truck: 'transit', no_answer: 'handoff', gated_house: 'handoff', car_accident: 'handoff', order_typo: 'create' };
const WORLD_STAGE_ROLE: Record<string, StageRole> = { transit: 'poll', handoff: 'final', create: 'input' } as Record<string, StageRole>;

/** Ticket Desk faults (packs spec section 4): each lands on one inbox stage and nowhere else. */
export const DESK_FAULT_STAGE: Readonly<Record<string, string>> = {
  sla_breach: 'sla', wrong_queue: 'triage', duplicate_storm: 'dedupe', sso_expired: 'login', field_mapping_error: 'validate',
  webhook_retry_storm: 'ingest', assignee_deleted: 'assign', rate_limited: 'assign',
};
/** Faults the bot handles itself (the arena arms them, the bot applies them at their stage). `sso_expired` is a provider fault. */
export const DESK_ARMED_FAULTS: readonly string[] = ['sla_breach', 'wrong_queue', 'duplicate_storm', 'field_mapping_error', 'webhook_retry_storm', 'assignee_deleted', 'rate_limited'];
export const isDeskFault = (f: string): boolean => f in DESK_FAULT_STAGE;

export function faultApplies(fault: string, role: StageRole, stageId?: string): boolean {
  if (DESK_FAULT_STAGE[fault]) {
    const st = INBOX_STAGES.find((x) => x.id === DESK_FAULT_STAGE[fault]);
    return st !== undefined && role === st.role && (stageId === undefined ? true : stageId === st.id);
  }
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
  weather: { forMs: 1800 },
  road_hazard: { forMs: 4000 },
  delay: { forMs: 600 },
  out_of_gas: { forMs: 7000 },
  not_on_truck: { forMs: 4000 },
  no_answer: { forMs: 3000 },
  gated_house: { forMs: 3000 },
  car_accident: { forMs: 7000 },
  order_typo: {},
  sla_breach: {}, wrong_queue: {}, duplicate_storm: {}, field_mapping_error: {}, webhook_retry_storm: {}, assignee_deleted: {},
  sso_expired: { count: 1, status: 401 },
  rate_limited: { count: 1, status: 429, retryAfterMs: 1000 },
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

/** Wrong-order decisions (design.md section 8) and each tier's default policy. */
export type DecisionChoice = 'refund' | 'discount' | 'redo';
export const DECISION_CHOICES: DecisionChoice[] = ['refund', 'discount', 'redo'];
export const TIER_DECISION_DEFAULT: Record<string, DecisionChoice> = { rookie: 'refund', retrier: 'refund', journaler: 'discount', reconciler: 'discount', phoenix: 'redo' };
export const DECISION_TIMEOUT_MS = 6000;

/** An order or message id as the app names it: `ord-0003` and `msg-0003` read `tkt-0003` in the inbox. */
export function displayId(app: string | undefined, id: string): string {
  const m = /^[a-z]+-(\d+.*)$/.exec(id);
  return m ? `${vocabOf(app).idPrefix}-${m[1]}` : id;
}
