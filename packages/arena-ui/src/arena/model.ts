// Arena view model (UI-A3). A pure reducer of contract events: no DOM, no clock of its own.
// `now` is passed in by the caller and only stamps cosmetic timers (pose changes, cheer length).
// Order, counts, scores and outcomes come from events alone (ui-spec section 5).
import type { ArenaEvent, ArenaState, StageInfo } from '../api/types';
import { applyBossEvent, emptyBoss, loadBoss, type BossVM } from './boss';
import { EQUIP_LIFE_MS, type EquipVM } from './equip';
import type { OrderDropVM } from './order';
import { applyLap, lapMotion, newLap, START_X, type LapVM } from './lap';
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
}

export interface LedgerCell { rows: number; repeats: number }

export interface ArenaVM {
  stages: StageInfo[];
  lanes: LaneVM[];
  wave: number;
  running: boolean;
  speed: number;
  /** Boss banner state (UI-B5). */
  boss: BossVM;
}

export const emptyVM = (): ArenaVM => ({ stages: [], lanes: [], wave: 0, running: false, speed: 1, boss: emptyBoss() });

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

/** Build from GET /api/state on load and reconnect. Stage names come from here (W3). */
export function loadSnapshot(vm: ArenaVM, s: ArenaState, now: number): void {
  vm.stages = Array.isArray(s.stages) ? s.stages.map((x) => ({ ...x })) : [];
  vm.wave = s.wave?.n ?? 0;
  vm.running = !!s.wave?.running;
  vm.speed = s.wave?.speed ?? 1;
  loadBoss(vm.boss, s, now, vm.speed);
  vm.lanes = (s.lanes ?? []).map((ls) => {
    const l = newLane(ls.lane, vm.stages.length, now);
    l.tier = ls.tier; l.label = ls.label; l.parts = ls.parts.filter((p) => p.installed).map((p) => p.id);
    l.order = ls.order; l.orderIndex = ls.orderIndex; l.ordersTotal = ls.ordersTotal;
    l.score = ls.score; l.counts = { ...ls.counts }; l.depth = ls.depth;
    const idx = Math.max(0, ls.stageIndex);
    l.stageIndex = idx;
    for (let i = 0; i < vm.stages.length; i++) {
      if (ls.order && i < idx) l.chips[i] = 'done';
      else if (ls.order && i === idx) l.chips[i] = ls.state === 'dead' ? 'dead' : 'active';
    }
    const wa = vm.stages[idx]?.workAnimation;
    l.workAnim = wa ?? '';
    l.lap = newLap(ls.order ? stationX(idx, vm.stages.length) : START_X);
    l.mode = ls.state === 'working' ? 'working' : ls.state === 'recovering' ? 'recovering'
      : ls.state === 'dead' ? 'dead' : ls.state === 'halted' ? 'halted' : ls.state === 'done' ? 'done' : 'idle';
    return l;
  });
}

function laneOf(vm: ArenaVM, ev: ArenaEvent): LaneVM | undefined {
  return typeof ev.lane === 'number' ? vm.lanes.find((l) => l.lane === ev.lane) : undefined;
}

function resetChips(l: LaneVM): void {
  l.chips.fill('pending'); l.attempts.fill(0); l.progress = 0; l.progressLabel = '';
}

const LAP_EVENTS = new Set(['order_start', 'stage_start', 'stage_done', 'order_done', 'order_failed', 'order_parked', 'process_dead', 'process_up']);

/** Apply one event. Unknown types are ignored (protocol rule 17). */
export function applyEvent(vm: ArenaVM, ev: ArenaEvent, now: number): void {
  const d = (ev.detail ?? {}) as Record<string, unknown>;
  if (ev.type === 'reset') { vm.lanes = []; vm.wave = 0; vm.running = false; vm.boss = emptyBoss(); return; }
  if (ev.type === 'boss_warning' || ev.type === 'boss_start' || ev.type === 'boss_end') {
    const k = applyBossEvent(vm.boss, ev, now, vm.speed);
    // Survived flash on every lane that is not dead or halted (ui-spec section 5).
    if (k === 'end') for (const l of vm.lanes) if (l.mode !== 'dead' && l.mode !== 'halted') l.survivedAt = now;
    return;
  }
  if (ev.type === 'wave_start') {
    vm.wave = num(ev.wave, vm.wave + 1);
    vm.running = true;
    vm.speed = num(d.speed, 1);
    const n = Math.max(1, Math.min(5, num(d.lanes, 5)));
    vm.lanes = Array.from({ length: n }, (_, i) => newLane(i + 1, vm.stages.length, now));
    return;
  }
  if (ev.type === 'wave_end') { vm.running = false; vm.boss = emptyBoss(); return; }
  const l = laneOf(vm, ev);
  if (!l) return;
  const si = ev.stage ? vm.stages.findIndex((s) => s.id === ev.stage) : -1;
  prune(l, now);
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
      resetChips(l); l.order = ev.order ?? null; l.orderIndex = num(d.index); l.ordersTotal = num(d.total);
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
      if (ev.stage) exitStage(l, now, ev.stage);
      setMode(l, 'idle', now);
      break;
    case 'stage_fail':
      actAll(l, now);
      if (si >= 0) l.chips[si] = 'failed';
      setMode(l, 'fail', now);
      break;
    case 'chaos': l.depth = num(d.depth, l.depth + 1); addCreature(l, now, d, ev.stage ?? vm.stages[l.stageIndex]?.id ?? ''); break;
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
      l.counts.completed += 1; l.dirty = d.clean === false; exitAll(l, now);
      l.cheer = { since: now, dur: 700 }; setMode(l, 'idle', now);
      break;
    case 'order_failed':
      l.counts.failed += 1; exitAll(l, now, { delay: 600 });
      { const fi = vm.stages.findIndex((s) => s.id === d.stage); if (fi >= 0) l.chips[fi] = 'failed'; }
      setMode(l, 'fail', now);
      break;
    case 'order_parked':
      l.counts.parked += 1; exitAll(l, now, { delay: 600 }); if (si >= 0) l.chips[si] = 'parked'; setMode(l, 'idle', now);
      break;
    case 'order_resumed': l.counts.parked = Math.max(0, l.counts.parked - 1); break;
    case 'order_quarantined':
      l.counts.quarantined += 1; exitAll(l, now, { delay: 600 }); if (si >= 0) l.chips[si] = 'quarantined'; setMode(l, 'idle', now);
      break;
    case 'lane_halted': exitAll(l, now, { delay: 600 }); setMode(l, 'halted', now); break;
    case 'part_added': {
      const part = str(d.part);
      if (!part) break;
      if (!l.parts.includes(part)) l.parts = [...l.parts, part];
      l.equips = l.equips.filter((e) => now - e.since < EQUIP_LIFE_MS && e.part !== part);
      l.equips.push({ part, since: now, ...(typeof d.spec === 'string' ? { spec: d.spec } : {}) });
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

/** Reconcile ledger cells with GET /api/ledger (wave_end and page load). The server is the truth. */
export function reconcileLedger(vm: ArenaVM, data: unknown): void {
  const lanes = (data as { lanes?: Array<{ lane: number; byKind?: Record<string, { rows?: number; repeats?: number }> }> } | null)?.lanes;
  if (!Array.isArray(lanes)) return;
  for (const e of lanes) {
    const l = vm.lanes.find((x) => x.lane === e.lane);
    if (!l || !e.byKind) continue;
    for (const [kind, c] of Object.entries(e.byKind)) l.ledger[kind] = { rows: num(c.rows), repeats: num(c.repeats) };
  }
}

/** Header total. */
export const totalScore = (vm: ArenaVM): number => vm.lanes.reduce((a, l) => a + l.score, 0);

/** Station x for a stage index inside the track (design px), evenly spaced. */
export function stationX(i: number, n: number, x0 = 260, x1 = 1500): number {
  const pad = 70;
  if (n <= 1) return (x0 + x1) / 2;
  return x0 + pad + ((x1 - x0 - 2 * pad) * i) / (n - 1);
}
