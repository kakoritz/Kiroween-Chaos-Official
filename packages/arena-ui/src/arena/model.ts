// Arena view model (UI-A3). A pure reducer of contract events: no DOM, no clock of its own.
// `now` is passed in by the caller and only stamps cosmetic timers (pose changes, cheer length).
// Order, counts, scores and outcomes come from events alone (ui-spec section 5).
import { appIdOf } from './vocab';
import type { ArenaEvent, ArenaState, StageInfo } from '../api/types';
import { applyBossEvent, emptyBoss, loadBoss, type BossVM } from './boss';
import { EQUIP_LIFE_MS, type EquipVM } from './equip';
import type { OrderDropVM } from './order';
import { applyLap, lapMotion, newLap, START_X, type LapVM } from './lap';
import { foldHeat, newHeat, chipState, type ChipInfo, type Heat } from './chips';
import { applyIntensity, defaultDial, readDial, type DialState } from './dial';
import { applyTournamentEvent, emptyTournament, loadTournament, type Fallen, type TournamentVM } from './tournament';
import { applyCurseEvent, type CursePop, type CurseVM } from './curses';
import { endOutage, openOutage, pruneOutages, startOutage, type OutageVM } from './outage';
import { absorb, actAll, addCreature, exitAll, exitDepth, exitStage, prune, PUFF_MS, type CreatureVM } from './creatures';

export type ChipState = 'pending' | 'active' | 'done' | 'replayed' | 'retrying' | 'failed' | 'dead' | 'parked' | 'quarantined';
export type SkelMode = 'sleep' | 'idle' | 'working' | 'fail' | 'recovering' | 'dead' | 'reassembling' | 'halted' | 'done';

export interface LaneVM {
  lane: number;
  tier: string;
  label: string;
  parts: string[];
  mode: SkelMode;
  /** Timestamp of the last mode change (cosmetic). */
  since: number;
  chips: ChipState[];
  attempts: number[];
  stageIndex: number;
  progress: number;
  progressLabel: string;
  workAnim: string;
  order: string | null;
  orderIndex: number;
  ordersTotal: number;
  score: number;
  counts: { completed: number; failed: number; parked: number; quarantined: number; repeats: number };
  depth: number;
  action: string;
  restartInMs: number;
  /** Short cheer after a stage (300) or an order (700). */
  cheer: { since: number; dur: number } | null;
  /** The last order finished with repeats. */
  dirty: boolean;
  /** Ledger rows created this wave per effect kind, plus extra rows beyond the first per key. */
  ledger: Record<string, LedgerCell>;
  /** Highest count seen per effect key, to derive repeats without double counting. */
  keyMax: Record<string, number>;
  /** Timestamp of the last repeat per kind (cosmetic flash). */
  flash: Record<string, number>;
  /** Creature stack (UI-B3), oldest first. Not restorable from a snapshot. */
  creatures: CreatureVM[];
  /** Timestamp of the last boss_end this lane survived (cosmetic flash), or 0. */
  survivedAt: number;
  /** Gear being equipped (UI-S4), newest last. Cosmetic, not restorable from a snapshot. */
  equips: EquipVM[];
  /** Last score change, for the +N pop (cosmetic). */
  scorePop: { since: number; delta: number } | null;
  /** Scroll dropping into the hand at order_start (UI-S6). Cosmetic. */
  orderDrop?: OrderDropVM | null;
  /** Lap choreography (PT-U1): skeleton anchor, walks, grab. Cosmetic. */
  lap?: LapVM;
  /** Chips v2 (PT-U3): this order's events, derived chip info, wave-wide heat. Not restorable from a snapshot. */
  chipEv?: ArenaEvent[];
  v2?: ChipInfo[];
  heat?: Heat;
  heatFolded?: boolean;
  /** Set once the lane is eliminated (TV3-U8): the row greys out and its corpse stays on the death stage. */
  fallen?: Fallen | null;
  /** Active curses and the last answers to cursed calls (TV3-U11). Cosmetic, not restorable from a snapshot. */
  curses?: CurseVM[];
  cursepops?: CursePop[];
  /** Outage countdown rings, one per stage at most (TV3-U7). Cosmetic, not restorable from a snapshot. */
  outages?: OutageVM[];
  /** Live star tracker (PT-U6): cum of the last review in this wave and that review's stars. */
  stars?: { sum: number; max: number; last: number } | null;
}

export interface LedgerCell { rows: number; repeats: number }

export interface ArenaVM {
  /** Id of the running app (`orders` or `inbox`): picks the wording. */
  app: string;
  stages: StageInfo[];
  lanes: LaneVM[];
  wave: number;
  running: boolean;
  speed: number;
  /** Boss banner state (UI-B5). */
  boss: BossVM;
  /** Intensity dial (TV3-U6): the server's level, ramp flag and the source of the last change. */
  intensity: DialState;
  /** Tournament rounds, standings, corpses (TV3-U8). */
  tournament: TournamentVM;
}

export const emptyVM = (): ArenaVM => ({ app: 'orders', stages: [], lanes: [], wave: 0, running: false, speed: 1, boss: emptyBoss(), intensity: defaultDial(), tournament: emptyTournament() });

export function newLane(n: number, stageCount: number, now: number): LaneVM {
  return {
    lane: n, tier: 'rookie', label: '', parts: [], mode: 'sleep', since: now,
    chips: Array<ChipState>(stageCount).fill('pending'), attempts: Array<number>(stageCount).fill(0),
    stageIndex: 0, progress: 0, progressLabel: '', workAnim: '', order: null, orderIndex: 0, ordersTotal: 0,
    score: 0, counts: { completed: 0, failed: 0, parked: 0, quarantined: 0, repeats: 0 },
    depth: 0, action: '', restartInMs: 0, cheer: null, dirty: false,
    ledger: {}, keyMax: {}, flash: {}, creatures: [], survivedAt: 0, equips: [], scorePop: null, lap: newLap(),
  };
}

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);

function setMode(l: LaneVM, mode: SkelMode, now: number): void {
  if (l.mode !== mode) { l.mode = mode; l.since = now; }
}

/** The orders stage list before contract v1.2. Used only when the server sends no list at all (rule 48). */
export const LEGACY_STAGES: readonly StageInfo[] = [
  { id: 'intake', label: 'Order intake', icon: 'mail', workAnimation: 'read_mail' },
  { id: 'account', label: 'Account creation', icon: 'user', workAnimation: 'fill_form' },
  { id: 'payment', label: 'Payment processing', icon: 'card', workAnimation: 'swipe_card' },
  { id: 'confirmation', label: 'Confirmation', icon: 'envelope', workAnimation: 'write_letter' },
  { id: 'dispatch', label: 'Dispatch to delivery', icon: 'box', workAnimation: 'load_scooter' },
  { id: 'updates', label: 'Order updates', icon: 'bubbles', workAnimation: 'send_bubbles' },
  { id: 'tracking', label: 'Delivery tracking', icon: 'road', workAnimation: 'scooter_road' },
  { id: 'handoff', label: 'Handoff', icon: 'door', workAnimation: 'doorstep' },
];

/** Stage chips come from the server: `app.stages` (v1.2) first, then `stages`, then the legacy list. */
export function stagesOf(s: Pick<ArenaState, 'app' | 'stages'>): StageInfo[] {
  const fromApp = typeof s.app === 'object' && s.app !== null && Array.isArray(s.app.stages) && s.app.stages.length > 0 ? s.app.stages : null;
  const list = fromApp ?? (Array.isArray(s.stages) && s.stages.length > 0 ? s.stages : null);
  if (!list) return LEGACY_STAGES.map((x) => ({ ...x }));
  return list.map((x) => ({ icon: '', workAnimation: 'think', ...x }) as StageInfo);
}

/** Build from GET /api/state on load and reconnect. Stage names come from here (W3). */
export function loadSnapshot(vm: ArenaVM, s: ArenaState, now: number): void {
  vm.stages = stagesOf(s);
  vm.app = appIdOf(s.app);
  vm.wave = s.wave?.n ?? 0;
  vm.running = !!s.wave?.running;
  vm.speed = s.wave?.speed ?? 1;
  loadBoss(vm.boss, s, now, vm.speed);
  vm.intensity = readDial(s) ?? vm.intensity;
  loadTournament(vm.tournament, s);
  vm.lanes = (s.lanes ?? []).map((ls) => {
    const l = newLane(ls.lane, vm.stages.length, now);
    l.tier = ls.tier; l.label = ls.label; l.parts = ls.parts.filter((p) => p.installed).map((p) => p.id);
    l.order = ls.order; l.orderIndex = ls.orderIndex; l.ordersTotal = ls.ordersTotal;
    l.score = ls.score; l.counts = { ...ls.counts }; l.depth = ls.depth;
    const st = (ls as { stars?: { sum?: number; max?: number; count?: number } }).stars;
    if (st && typeof st.sum === 'number' && typeof st.max === 'number' && (st.count ?? 1) > 0) l.stars = { sum: st.sum, max: st.max, last: 0 };
    const idx = Math.max(0, ls.stageIndex);
    l.stageIndex = idx;
    for (let i = 0; i < vm.stages.length; i++) {
      if (ls.order && i < idx) l.chips[i] = 'done';
      else if (ls.order && i === idx) l.chips[i] = ls.state === 'dead' ? 'dead' : 'active';
    }
    const wa = vm.stages[idx]?.workAnimation;
    l.workAnim = wa ?? '';
    l.lap = newLap(ls.order ? stationX(idx, vm.stages.length) : START_X);
    l.fallen = vm.tournament.fallen[ls.lane] ?? null;
    l.mode = l.fallen ? 'halted' : ls.state === 'working' ? 'working' : ls.state === 'recovering' ? 'recovering'
      : ls.state === 'dead' ? 'dead' : ls.state === 'halted' ? 'halted' : ls.state === 'done' ? 'done' : 'idle';
    return l;
  });
}

/** A fallen lane stops: the row greys out and the skeleton gives way to the corpse. Creatures stay and keep circling. */
function fallLane(l: LaneVM, f: Fallen, now: number): void {
  l.fallen = f;
  if (l.mode !== 'halted') { l.mode = 'halted'; l.since = now; }
  l.order = null; l.depth = 0; l.outages = [];
  exitAll(l, now, { delay: 600 });
}

/** After a tournament event: make sure every roster lane has a row, and fallen lanes are marked. */
function syncTournamentLanes(vm: ArenaVM, ev: ArenaEvent, now: number): void {
  const t = vm.tournament;
  if (ev.type === 'round_start' && vm.stages.length > 0) {
    for (const n of t.roster) if (!vm.lanes.some((l) => l.lane === n)) vm.lanes.push(newLane(n, vm.stages.length, now));
    vm.lanes.sort((a, b) => a.lane - b.lane);
  }
  for (const l of vm.lanes) {
    const f = t.fallen[l.lane];
    if (f && !l.fallen) fallLane(l, f, now);
    else if (f && l.fallen) l.fallen = f;
  }
}

function laneOf(vm: ArenaVM, ev: ArenaEvent): LaneVM | undefined {
  return typeof ev.lane === 'number' ? vm.lanes.find((l) => l.lane === ev.lane) : undefined;
}

function resetChips(l: LaneVM): void {
  l.chips.fill('pending'); l.attempts.fill(0); l.progress = 0; l.progressLabel = '';
}

const LAP_EVENTS = new Set(['order_start', 'stage_start', 'stage_done', 'order_done', 'order_failed', 'order_parked', 'process_dead', 'process_up', 'review']);

const ORDER_END = new Set(['order_done', 'order_failed', 'order_parked', 'order_quarantined']);
const MAX_ORDER_EVENTS = 300;

/** Keep this order's events and derive chips v2 (PT-U3). Wave heat folds in once per finished order. */
function trackChips(l: LaneVM, vm: ArenaVM, ev: ArenaEvent): void {
  const ids = vm.stages.map((s) => s.id);
  if (!l.heat || l.heat.issues.length !== ids.length) l.heat = newHeat(ids.length);
  if (ev.type === 'order_start') {
    if (l.v2 && l.chipEv?.length && !l.heatFolded) foldHeat(l.heat, l.v2);
    l.chipEv = []; l.heatFolded = false;
  }
  const buf = (l.chipEv ??= []);
  buf.push(ev);
  if (buf.length > MAX_ORDER_EVENTS) buf.splice(0, buf.length - MAX_ORDER_EVENTS);
  l.v2 = chipState(buf, ids);
  if (ORDER_END.has(ev.type) && !l.heatFolded) { foldHeat(l.heat, l.v2); l.heatFolded = true; }
}

/** Apply one event. Unknown types are ignored (protocol rule 17). */
export function applyEvent(vm: ArenaVM, ev: ArenaEvent, now: number): void {
  const d = (ev.detail ?? {}) as Record<string, unknown>;
  if (ev.type === 'reset') { vm.lanes = []; vm.wave = 0; vm.running = false; vm.boss = emptyBoss(); vm.tournament = emptyTournament(); return; }
  if (applyTournamentEvent(vm.tournament, ev as never)) { syncTournamentLanes(vm, ev, now); return; }
  if (ev.type === 'boss_warning' || ev.type === 'boss_start' || ev.type === 'boss_end') {
    const k = applyBossEvent(vm.boss, ev, now, vm.speed);
    // Survived flash on every lane that is not dead or halted (ui-spec section 5).
    if (k === 'end') for (const l of vm.lanes) if (l.mode !== 'dead' && l.mode !== 'halted') l.survivedAt = now;
    return;
  }
  if (ev.type === 'intensity') { applyIntensity(vm.intensity, d); return; }
  if (ev.type === 'wave_start') {
    if (typeof d.app === 'string') vm.app = appIdOf(d.app);
    vm.wave = num(ev.wave, vm.wave + 1);
    vm.running = true;
    vm.speed = num(d.speed, 1);
    const n = Math.max(1, Math.min(5, num(d.lanes, 5)));
    const roster = vm.tournament.active ? vm.tournament.roster : [];
    if (roster.length > 0) {
      // In a tournament the fallen lanes stay on the board; only the live lanes start fresh (contract rule 50).
      const old = new Map(vm.lanes.map((l) => [l.lane, l] as const));
      vm.lanes = roster.map((n2) => {
        if (vm.tournament.fallen[n2] && old.get(n2)) return old.get(n2)!;
        const nl = newLane(n2, vm.stages.length, now);
        // A curse lasts until the plan removes it, across rounds.
        const carried = old.get(n2)?.curses;
        if (carried?.length) nl.curses = carried;
        return nl;
      });
      for (const l of vm.lanes) if (vm.tournament.fallen[l.lane]) fallLane(l, vm.tournament.fallen[l.lane]!, now);
      return;
    }
    vm.lanes = Array.from({ length: n }, (_, i) => newLane(i + 1, vm.stages.length, now));
    return;
  }
  if (ev.type === 'wave_end') { vm.running = false; vm.boss = emptyBoss(); return; }
  const l = laneOf(vm, ev);
  if (!l) return;
  // Rule 50: a fallen lane emits no more order events. If one arrives anyway, the corpse stays a corpse.
  if (l.fallen) return;
  const si = ev.stage ? vm.stages.findIndex((s) => s.id === ev.stage) : -1;
  prune(l, now);
  pruneOutages(l, now);
  trackChips(l, vm, ev);
  if (LAP_EVENTS.has(ev.type)) {
    const n = vm.stages.length;
    const open = l.chips.some((c) => c === 'done' || c === 'replayed') ? l.stageIndex : -1;
    applyLap(l.lap ??= newLap(), ev, d, now, lapMotion(l.lap, now), ev.type === 'process_up' ? open : si, n, (i) => stationX(i, n));
  }
  switch (ev.type) {
    case 'lane_ready':
      l.tier = str(d.tier, l.tier); l.label = str(d.label, l.label);
      l.parts = Array.isArray(d.parts) ? (d.parts as unknown[]).map(String) : [];
      setMode(l, 'idle', now);
      break;
    case 'order_start':
      endOutage(l, now); resetChips(l); l.order = ev.order ?? null; l.orderIndex = num(d.index); l.ordersTotal = num(d.total);
      l.stageIndex = 0; l.dirty = false; l.orderDrop = { since: now }; setMode(l, 'idle', now);
      break;
    case 'stage_start': {
      const attempt = num(d.attempt, 1);
      if (si >= 0) {
        // A restarted bot repeating earlier stages: chips from that stage on return to pending.
        if (si < l.stageIndex || l.chips[si] === 'done' || l.chips[si] === 'replayed') {
          for (let i = si; i < l.chips.length; i++) { l.chips[i] = 'pending'; l.attempts[i] = 0; }
        }
        l.stageIndex = si; l.attempts[si] = attempt;
        l.chips[si] = attempt > 1 ? 'retrying' : 'active';
        l.workAnim = vm.stages[si]!.workAnimation;
      }
      l.progress = 0; l.progressLabel = ''; l.action = '';
      if (ev.stage) startOutage(l, now, ev.stage);
      setMode(l, 'working', now);
      break;
    }
    case 'stage_progress':
      l.progress = Math.max(0, Math.min(100, num(d.pct))); l.progressLabel = str(d.label);
      break;
    case 'stage_done':
      if (si >= 0) l.chips[si] = d.skipped === true ? 'replayed' : 'done';
      l.progress = 100;
      if (d.skipped !== true) l.cheer = { since: now, dur: 300 };
      if (ev.stage) { exitStage(l, now, ev.stage); endOutage(l, now, ev.stage); }
      setMode(l, 'idle', now);
      break;
    case 'stage_fail':
      actAll(l, now);
      if (si >= 0) l.chips[si] = 'failed';
      setMode(l, 'fail', now);
      break;
    case 'curse_start': case 'curse_end': case 'curse_response': applyCurseEvent(l, ev, now, vm.stages.map((s) => s.id), vm.speed); break;
    case 'outage': {
      // A fault pressed for a stage the lane has not reached yet waits there: the ring counts from the moment the stage starts.
      const oi = ev.stage ? vm.stages.findIndex((s) => s.id === ev.stage) : -1;
      openOutage(l, now, vm.speed, ev.stage, d, !!l.order && oi > l.stageIndex && l.chips[oi] === 'pending');
      break;
    }
    case 'chaos': l.depth = num(d.depth, l.depth + 1); addCreature(l, now, d, str(d.deferredTo) || ev.stage || (vm.stages[l.stageIndex]?.id ?? '')); break;
    case 'chaos_absorbed': l.depth = Math.max(0, l.depth - 1); absorb(l, now, typeof d.creature === 'string' ? d.creature : undefined); break;
    case 'process_dead': {
      actAll(l, now, true); exitAll(l, now, { dur: PUFF_MS, keepKillers: true });
      for (let i = 0; i < l.chips.length; i++) if (l.chips[i] === 'active' || l.chips[i] === 'retrying') l.chips[i] = 'dead';
      l.restartInMs = num(d.restartInMs); setMode(l, 'dead', now);
      break;
    }
    case 'process_up': l.depth = 0; exitAll(l, now); setMode(l, 'reassembling', now); break;
    case 'recover_start': l.action = str(d.action); actAll(l, now); setMode(l, 'recovering', now); break;
    case 'recover_done':
      exitDepth(l, now, num(d.depth, l.depth));
      l.depth = Math.max(0, num(d.depth, l.depth) - 1);
      setMode(l, l.chips[l.stageIndex] === 'active' || l.chips[l.stageIndex] === 'retrying' ? 'working' : 'idle', now);
      break;
    case 'effect': {
      if (d.replayed === true) break;
      const kind = str(d.kind, 'effect');
      (l.ledger[kind] ??= { rows: 0, repeats: 0 }).rows += 1;
      break;
    }
    case 'repeat': {
      l.counts.repeats += 1;
      const kind = str(d.kind, 'effect'), key = kind + '|' + str(d.key);
      const count = num(d.count, 2), cell = (l.ledger[kind] ??= { rows: 0, repeats: 0 });
      const prev = l.keyMax[key] ?? 1;
      if (count > prev) { cell.repeats += count - prev; l.keyMax[key] = count; }
      l.flash[kind] = now;
      break;
    }
    case 'order_done':
      l.counts.completed += 1; l.dirty = d.clean === false; exitAll(l, now); endOutage(l, now);
      l.cheer = { since: now, dur: 700 }; setMode(l, 'idle', now);
      break;
    case 'order_failed':
      l.counts.failed += 1; exitAll(l, now, { delay: 600 }); endOutage(l, now);
      { const fi = vm.stages.findIndex((s) => s.id === d.stage); if (fi >= 0) l.chips[fi] = 'failed'; }
      setMode(l, 'fail', now);
      break;
    case 'order_parked':
      l.counts.parked += 1; exitAll(l, now, { delay: 600 }); endOutage(l, now); if (si >= 0) l.chips[si] = 'parked'; setMode(l, 'idle', now);
      break;
    case 'order_resumed': l.counts.parked = Math.max(0, l.counts.parked - 1); break;
    case 'order_quarantined':
      l.counts.quarantined += 1; exitAll(l, now, { delay: 600 }); endOutage(l, now); if (si >= 0) l.chips[si] = 'quarantined'; setMode(l, 'idle', now);
      break;
    case 'lane_halted': exitAll(l, now, { delay: 600 }); endOutage(l, now); setMode(l, 'halted', now); break;
    case 'part_added': {
      const part = str(d.part);
      if (!part) break;
      if (!l.parts.includes(part)) l.parts = [...l.parts, part];
      l.equips = l.equips.filter((e) => now - e.since < EQUIP_LIFE_MS && e.part !== part);
      l.equips.push({ part, since: now, ...(typeof d.spec === 'string' ? { spec: d.spec } : {}) });
      break;
    }
    case 'review': {
      const c = (d.cum ?? {}) as Record<string, unknown>;
      if (typeof c.stars === 'number' && typeof c.max === 'number') l.stars = { sum: c.stars, max: c.max, last: num(d.stars) };
      break;
    }
    case 'score': {
      const before = l.score;
      l.score = num(d.total, l.score + num(d.delta));
      const delta = l.score - before;
      if (delta !== 0) l.scorePop = { since: now, delta };
      break;
    }
    default: break;
  }
}

/** Provider ledger kinds under the contract's effect kind names, the ones `effect` events carry (else one column shows twice). */
const LEDGER_KIND: Record<string, string> = { account: 'account_create', reply: 'email' };

/** Reconcile ledger cells with GET /api/ledger (wave_end and page load). The server is the truth. */
export function reconcileLedger(vm: ArenaVM, data: unknown): void {
  const lanes = (data as { lanes?: Array<{ lane: number; byKind?: Record<string, { rows?: number; repeats?: number }> }> } | null)?.lanes;
  if (!Array.isArray(lanes)) return;
  for (const e of lanes) {
    const l = vm.lanes.find((x) => x.lane === e.lane);
    if (!l || !e.byKind) continue;
    const next: LaneVM['ledger'] = {};
    for (const [raw, c] of Object.entries(e.byKind)) {
      const cell = (next[LEDGER_KIND[raw] ?? raw] ??= { rows: 0, repeats: 0 });
      cell.rows += num(c.rows); cell.repeats += num(c.repeats);
    }
    l.ledger = next;
  }
}

/** Header total. */
export const totalScore = (vm: ArenaVM): number => vm.lanes.reduce((a, l) => a + l.score, 0);

/** Chip width in design px: 150 when there is room, narrower so eleven chips never overlap (TV3-U8 polish). */
export function chipWidth(n: number, x0 = 260, x1 = 1500): number {
  if (n <= 1) return 150;
  const gap = (x1 - x0 - 140) / (n - 1);
  return Math.max(60, Math.min(150, Math.floor(gap - 4)));
}

/** Station x for a stage index inside the track (design px), evenly spaced. */
export function stationX(i: number, n: number, x0 = 260, x1 = 1500): number {
  const pad = 70;
  if (n <= 1) return (x0 + x1) / 2;
  return x0 + pad + ((x1 - x0 - 2 * pad) * i) / (n - 1);
}
