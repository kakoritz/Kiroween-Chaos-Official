// Lane view derived from the event stream (PROTOCOL.md `GET /api/state` lanes[]), plus wire normalization and log text.
import type { HauntEvent } from '../../../haunt/src/score/score';
import { PARTS, type StageView } from './catalog';

export type LaneState = 'idle' | 'working' | 'recovering' | 'dead' | 'halted' | 'done';

export interface LaneView {
  lane: number;
  tier: string;
  label: string;
  state: LaneState;
  order: string | null;
  stage: string | null;
  stageIndex: number;
  orderIndex: number;
  ordersTotal: number;
  score: number;
  counts: { completed: number; failed: number; parked: number; quarantined: number; repeats: number };
  depth: number;
  parts: { id: string; label: string; installed: boolean }[];
}

export function newLane(lane: number, tier: string, label: string, used: readonly string[], ordersTotal: number): LaneView {
  return {
    lane, tier, label, state: 'idle', order: null, stage: null, stageIndex: -1, orderIndex: 0, ordersTotal, score: 0,
    counts: { completed: 0, failed: 0, parked: 0, quarantined: 0, repeats: 0 },
    depth: 0,
    parts: PARTS.map((p) => ({ ...p, installed: used.includes(p.id) })),
  };
}

/** Apply one event to the lane views. Pure with respect to the event; mutates `lanes`. */
export function applyEvent(lanes: Map<number, LaneView>, ev: HauntEvent, stages: readonly StageView[]): void {
  if (ev.type === 'wave_end') {
    for (const l of lanes.values()) if (l.state === 'working' || l.state === 'recovering') l.state = 'done';
    return;
  }
  if (ev.lane === undefined) return;
  const l = lanes.get(Number(ev.lane));
  if (!l) return;
  const d = (ev.detail ?? {}) as Record<string, any>;
  switch (ev.type) {
    case 'order_start':
      l.state = 'working'; l.order = ev.order ?? null; l.orderIndex = d.index ?? l.orderIndex + 1;
      l.ordersTotal = d.total ?? l.ordersTotal; l.stage = null; l.stageIndex = -1; break;
    case 'stage_start':
      if (l.state !== 'dead') l.state = 'working';
      l.stage = ev.stage ?? null; l.stageIndex = stages.findIndex((s) => s.id === ev.stage); break;
    case 'chaos': l.depth = d.depth ?? l.depth; break;
    case 'process_dead': l.state = 'dead'; break;
    case 'process_up': l.state = 'working'; l.depth = 0; break;
    case 'recover_start': l.state = 'recovering'; l.depth = d.depth ?? l.depth; break;
    case 'recover_done': l.state = 'working'; break;
    case 'repeat': l.counts.repeats = Math.max(l.counts.repeats, (d.count ?? 1) - 1); break;
    case 'order_done': l.counts.completed++; break;
    case 'order_failed': l.counts.failed++; break;
    case 'order_parked': l.counts.parked++; break;
    case 'order_quarantined': l.counts.quarantined++; break;
    case 'lane_halted': l.state = 'halted'; break;
    case 'score': l.score = d.total ?? l.score; break;
    case 'part_added': { const p = l.parts.find((x) => x.id === d.part); if (p) p.installed = true; break; }
    default: break;
  }
}

/** Contract wire form: integer `lane`, no `lane` key on global events (rule 16). */
export function toWire(ev: HauntEvent): Record<string, unknown> {
  const out: Record<string, unknown> = { ...ev };
  if (ev.lane === undefined) delete out.lane;
  else out.lane = Number.isNaN(Number(ev.lane)) ? ev.lane : Number(ev.lane);
  return out;
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Short sentence for the lane log (PROTOCOL.md amendments). Returns undefined for events that are not logged. */
export function logLine(ev: HauntEvent): { level: 'info' | 'warn' | 'error' | 'good'; text: string } | undefined {
  const d = (ev.detail ?? {}) as Record<string, any>;
  const st = ev.stage ? cap(ev.stage) : 'Stage';
  switch (ev.type) {
    case 'order_start': return { level: 'info', text: `Started ${ev.order} (${d.index} of ${d.total})` };
    case 'stage_start': return { level: 'info', text: `${st} started (attempt ${d.attempt ?? 1})` };
    case 'stage_done': return { level: 'good', text: d.skipped ? `${st} skipped, already journaled` : `${st} done in ${d.ms} ms` };
    case 'stage_fail': return { level: 'error', text: `${st} failed: ${d.error} (attempt ${d.attempt ?? 1})` };
    case 'chaos': return { level: 'warn', text: `${d.creature} arrived: ${d.fault}` };
    case 'chaos_absorbed': return { level: 'good', text: `${d.fault} absorbed: ${d.reason}` };
    case 'process_dead': return { level: 'error', text: `Bot died: ${d.reason}` };
    case 'process_up': return { level: 'info', text: `Bot restarted (attempt ${d.attempt})` };
    case 'recover_start': return { level: 'info', text: `Recovery started: ${d.action}` };
    case 'recover_done': return { level: 'good', text: `Recovery done: ${d.action} in ${d.ms} ms` };
    case 'effect': return { level: d.replayed ? 'info' : 'good', text: `${d.kind} ${d.replayed ? 'replayed' : 'created'} (${d.key})` };
    case 'repeat': return { level: 'error', text: `Repeated ${d.kind}: ${d.count} rows for ${d.key}` };
    case 'breaker': return { level: 'warn', text: `Breaker for ${d.service} is ${d.state}` };
    case 'order_done': return { level: 'good', text: `${ev.order} completed${d.clean ? ' cleanly' : ''}` };
    case 'order_failed': return { level: 'error', text: `${ev.order} failed at ${d.stage}: ${d.error}` };
    case 'order_parked': return { level: 'warn', text: `${ev.order} parked at ${d.stage}: ${d.reason}` };
    case 'order_resumed': return { level: 'info', text: `${ev.order} resumed at ${d.stage}` };
    case 'order_quarantined': return { level: 'warn', text: `${ev.order} quarantined at ${d.stage}: ${d.reason}` };
    case 'order_abandoned': return { level: 'warn', text: `${ev.order} abandoned` };
    case 'lane_halted': return { level: 'error', text: `Lane halted: ${d.reason}` };
    case 'part_added': return { level: 'good', text: `Gear added: ${d.part}` };
    default: return undefined;
  }
}
