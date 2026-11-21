// Event hub of the mock server: one seq counter, a 5000 event buffer, live subscribers and the derived
// state (lanes, waves, boss) that GET /api/state and the lane/ledger/wave endpoints answer from.
import { APPS, gradeFor, worseGrade, type AppId, type Grade, type HauntEvent, type PartId, PARTS, TIERS, type TierId } from '@haunt/shared';

export const BUFFER_MAX = 5000;

export interface LaneState {
  lane: number;
  tier: string;
  label: string;
  state: 'idle' | 'working' | 'recovering' | 'dead' | 'halted' | 'done';
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

export interface WaveRecord {
  n: number;
  startedAt: number;
  endedAt?: number;
  seed: number;
  orders: number;
  lanes: number;
  speed: number;
  tiers: string;
  app: AppId;
  summary?: Record<string, { score: number; completed: number; failed: number; parked: number; quarantined: number; repeats: number }>;
  stopped?: boolean;
}

export function waveGrades(w: WaveRecord): Record<string, Grade> {
  const out: Record<string, Grade> = {};
  for (const [lane, s] of Object.entries(w.summary ?? {})) {
    const total = s.completed + s.failed + s.parked + s.quarantined;
    const reliability = total === 0 ? 100 : Math.max(0, ((s.completed - s.repeats * 0.5) / total) * 100);
    out[lane] = gradeFor(reliability);
  }
  return out;
}

export const worstGrade = (g: Record<string, Grade>): Grade | undefined => Object.values(g).reduce<Grade | undefined>((a, b) => (a ? worseGrade(a, b) : b), undefined);

export const waveScore = (w: WaveRecord): number => Object.values(w.summary ?? {}).reduce((a, s) => a + s.score, 0);

export class Hub {
  seq = 0;
  buffer: HauntEvent[] = [];
  subs = new Set<(e: HauntEvent) => void>();
  app: AppId = 'orders';
  speed = 1;
  waveNo = 0;
  waves: WaveRecord[] = [];
  lanes = new Map<number, LaneState>();
  chaosMode = { mode: 'manual' as 'off' | 'manual' | 'random', frequency: 0.3, seed: 7 };
  boss = { next: 'boss_power_outage', startsInMs: null as number | null, active: false };
  demoRunning: string | null = null;

  get wave(): WaveRecord | undefined { return this.waves[this.waves.length - 1]; }
  get running(): boolean { const w = this.wave; return !!w && w.endedAt === undefined; }

  emit(e: Omit<HauntEvent, 'seq' | 'ts'> & { ts?: number }): HauntEvent {
    const ev = { ...e, seq: ++this.seq, ts: e.ts ?? Date.now() } as HauntEvent;
    this.buffer.push(ev);
    if (this.buffer.length > BUFFER_MAX) this.buffer.splice(0, this.buffer.length - BUFFER_MAX);
    this.track(ev);
    for (const s of this.subs) s(ev);
    return ev;
  }

  /** Start a new run: clears derived state and emits `reset` (the seq counter keeps counting). */
  reset(): void {
    this.lanes.clear();
    this.boss = { next: 'boss_power_outage', startsInMs: null, active: false };
    this.demoRunning = null;
    this.emit({ type: 'reset', detail: {} });
  }

  laneAt(n: number): LaneState | undefined { return this.lanes.get(n); }

  private track(e: HauntEvent): void {
    const d = e.detail ?? {};
    const lane = e.lane !== undefined ? this.lanes.get(e.lane) : undefined;
    switch (e.type) {
      case 'wave_start': {
        this.lanes.clear();
        this.waves.push({ n: e.wave ?? this.waveNo, startedAt: e.ts, seed: d.seed, orders: d.orders, lanes: d.lanes, speed: d.speed, tiers: d.tiers, app: d.app });
        break;
      }
      case 'wave_end': {
        const w = this.wave;
        if (w) { w.endedAt = e.ts; w.summary = d.summary ?? {}; w.stopped = !!d.stopped; }
        for (const l of this.lanes.values()) if (l.state === 'working' || l.state === 'recovering') l.state = 'done';
        this.demoRunning = null;
        break;
      }
      case 'lane_ready': {
        const tier = TIERS[d.tier as TierId];
        const installed = new Set<string>(d.parts ?? []);
        this.lanes.set(e.lane!, {
          lane: e.lane!, tier: d.tier, label: d.label, state: 'idle', order: null, stage: null, stageIndex: -1, orderIndex: 0, ordersTotal: this.wave?.orders ?? 0, score: 0,
          counts: { completed: 0, failed: 0, parked: 0, quarantined: 0, repeats: 0 }, depth: 0,
          parts: (Object.keys(PARTS) as PartId[]).map((id) => ({ id, label: PARTS[id].label, installed: installed.has(id) || (!d.parts && !!tier?.parts.includes(id)) })),
        });
        break;
      }
      case 'order_start': if (lane) { lane.order = e.order ?? null; lane.orderIndex = d.index; lane.ordersTotal = d.total; lane.state = 'working'; lane.stage = null; lane.stageIndex = -1; } break;
      case 'stage_start': if (lane) { lane.stage = e.stage ?? null; lane.stageIndex = APPS[this.app].stages.findIndex((s) => s.id === e.stage); if (lane.state === 'idle' || lane.state === 'recovering') lane.state = 'working'; } break;
      case 'order_done': if (lane) { lane.counts.completed++; lane.counts.repeats += d.repeats ?? 0; this.settle(lane); } break;
      case 'order_failed': if (lane) { lane.counts.failed++; this.settle(lane); } break;
      case 'order_parked': if (lane) { lane.counts.parked++; this.settle(lane); } break;
      case 'order_quarantined': if (lane) { lane.counts.quarantined++; this.settle(lane); } break;
      case 'process_dead': if (lane) lane.state = 'dead'; break;
      case 'process_up': if (lane) { lane.state = 'working'; lane.depth = 0; } break;
      case 'recover_start': if (lane) lane.state = 'recovering'; break;
      case 'recover_done': if (lane) lane.state = 'working'; break;
      case 'lane_halted': if (lane) lane.state = 'halted'; break;
      case 'chaos': if (lane) lane.depth = d.depth ?? lane.depth + 1; break;
      case 'score': if (lane) lane.score = d.total; break;
      case 'part_added': if (lane) { const p = lane.parts.find((x) => x.id === d.part); if (p) p.installed = true; } break;
      case 'boss_warning': this.boss = { next: d.boss, startsInMs: d.startsInMs ?? null, active: false }; break;
      case 'boss_start': this.boss = { next: d.boss, startsInMs: null, active: true }; break;
      case 'boss_end': this.boss = { next: d.boss, startsInMs: null, active: false }; break;
      default: break;
    }
  }

  private settle(l: LaneState): void {
    if (l.orderIndex >= l.ordersTotal && l.state === 'working') l.state = 'done';
  }
}

/** One-line sentence for the lane log, generated from an event. */
export function logText(e: HauntEvent): { level: 'info' | 'warn' | 'error' | 'good'; text: string } | undefined {
  const d = e.detail ?? {};
  const st = e.stage ?? 'stage';
  switch (e.type) {
    case 'order_start': return { level: 'info', text: `Started ${e.order} (${d.index} of ${d.total})` };
    case 'stage_start': return { level: 'info', text: `${st} started (attempt ${d.attempt ?? 1})` };
    case 'stage_done': return { level: 'good', text: d.skipped ? `${st} skipped, already done` : `${st} done in ${d.ms} ms` };
    case 'stage_fail': return { level: 'error', text: `${st} failed: ${d.error} (attempt ${d.attempt ?? 1})` };
    case 'chaos': return { level: 'warn', text: `${d.creature} struck with ${d.fault}` };
    case 'chaos_absorbed': return { level: 'good', text: `${d.fault} had no effect: ${d.reason}` };
    case 'process_dead': return { level: 'error', text: `Process died (${d.reason}), restart in ${d.restartInMs} ms` };
    case 'process_up': return { level: 'info', text: `Process back up (attempt ${d.attempt})` };
    case 'recover_start': return { level: 'warn', text: `Recovery started: ${d.action}` };
    case 'recover_done': return { level: 'good', text: `Recovery finished: ${d.action} in ${d.ms} ms` };
    case 'effect': return { level: d.replayed ? 'good' : 'info', text: d.replayed ? `${d.kind} replayed by key, no new row` : `${d.kind} created (${d.key})` };
    case 'repeat': return { level: 'error', text: `${d.kind} repeated: ${d.count} rows for ${d.key}` };
    case 'order_done': return { level: d.clean ? 'good' : 'warn', text: `${e.order} done${d.clean ? '' : ' with repeats'}` };
    case 'order_failed': return { level: 'error', text: `${e.order} failed at ${d.stage}: ${d.error}` };
    case 'order_parked': return { level: 'warn', text: `${e.order} parked at ${d.stage}: ${d.reason}` };
    case 'order_resumed': return { level: 'good', text: `${e.order} resumed at ${d.stage}` };
    case 'order_quarantined': return { level: 'error', text: `${e.order} quarantined at ${d.stage}: ${d.reason}` };
    case 'lane_halted': return { level: 'error', text: `Lane halted: ${d.reason}` };
    case 'breaker': return { level: 'warn', text: `Breaker for ${d.service} is ${d.state}` };
    case 'part_added': return { level: 'good', text: `Gear added: ${d.part}` };
    default: return undefined;
  }
}
