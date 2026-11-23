// Fills the detail fields the contract requires on bot-forwarded events (PROTOCOL.md rule on detail). Bots emit the
// minimum; the live runtime owns the wire shape. Only missing keys are added, never overwritten.
type Ev = Record<string, any>;
interface WireState { afterUp: boolean; inFlight?: string; attempts: Map<string, number>; recover: string[]; last?: Ev }
interface LaneState { index: number; stageStart: Map<string, number>; orderStart: Map<string, number>; depth: number; recoverStart: number; repeats: Map<string, number> }

export class DetailNormalizer {
  private total = 1;
  private lanes = new Map<string, LaneState>();

  constructor(private readonly now: () => number = Date.now) {}

  begin(total: number): void { this.total = Math.max(1, Math.floor(total) || 1); this.lanes.clear(); this.wires.clear(); }

  private lane(lane: string): LaneState {
    let l = this.lanes.get(lane);
    if (!l) { l = { index: 0, stageStart: new Map(), orderStart: new Map(), depth: 0, recoverStart: 0, repeats: new Map() }; this.lanes.set(lane, l); }
    return l;
  }

  /**
   * Turns one bot-forwarded event into its contract wire events (PROTOCOL.md rules 6, 13, 27, 29). After `process_up`
   * the bot's repeated `order_start` for the in-flight order is dropped, and a tier with no journal gets the
   * `recover_start{restart}`/`recover_done{restart}` pair before its first `stage_start`. A skipped `stage_done` gets
   * its `stage_start`, `attempt` is counted by the server, and each `recover_done` carries its open pair's action.
   */
  shape(lane: string, ev: Ev): Ev[] {
    const w = this.wire(lane);
    const out: Ev[] = [];
    const push = (e: Ev): void => {
      if (e.type === 'stage_start') {
        const k = `${e.order ?? ''}|${e.stage ?? ''}`;
        const n = (w.attempts.get(k) ?? 0) + 1;
        w.attempts.set(k, n);
        e = { ...e, detail: { ...(e.detail ?? {}), attempt: n } };
      }
      const f = this.fix(lane, e);
      w.last = f;
      out.push(f);
    };
    switch (ev.type) {
      case 'process_up': w.afterUp = true; break;
      case 'order_start':
        if (w.afterUp && ev.order === w.inFlight) return [];
        w.afterUp = false;
        w.inFlight = ev.order;
        // A wrong-order redo runs every stage again from attempt 1.
        if (ev.detail?.redo === true) for (const k of [...w.attempts.keys()]) if (k.startsWith(`${ev.order}|`)) w.attempts.delete(k);
        break;
      case 'recover_start': w.afterUp = false; w.recover.push(String(ev.detail?.action ?? 'replay')); break;
      case 'recover_done': {
        const action = w.recover.pop();
        if (action) ev = { ...ev, detail: { ...(ev.detail ?? {}), action } };
        break;
      }
      case 'stage_start':
        if (w.afterUp) {
          w.afterUp = false;
          push({ type: 'recover_start', detail: { action: 'restart', depth: 0 } });
          push({ type: 'recover_done', detail: { action: 'restart', depth: 0 } });
        }
        break;
      case 'stage_done':
        if (ev.detail?.skipped === true && !(w.last?.type === 'stage_start' && w.last.order === ev.order && w.last.stage === ev.stage)) {
          push({ type: 'stage_start', order: ev.order, stage: ev.stage, detail: {} });
        }
        break;
      case 'order_done': case 'order_failed': case 'order_parked': case 'order_quarantined':
        if (ev.order === w.inFlight) w.inFlight = undefined;
        break;
      default: break;
    }
    push(ev);
    return out;
  }

  private wires = new Map<string, WireState>();

  private wire(lane: string): WireState {
    let s = this.wires.get(lane);
    if (!s) { s = { afterUp: false, attempts: new Map(), recover: [] }; this.wires.set(lane, s); }
    return s;
  }

  fix(lane: string, ev: Ev): Ev {
    const l = this.lane(lane);
    const d: Ev = { ...(ev.detail ?? {}) };
    const t = this.now();
    const key = `${ev.order ?? ''}|${ev.stage ?? ''}`;
    const set = (k: string, v: unknown): void => { if (d[k] === undefined) d[k] = v; };
    switch (ev.type) {
      case 'order_start': {
        const m = /(\d+)$/.exec(String(ev.order ?? ''));
        l.index = Math.min(this.total, m ? Math.max(1, Number(m[1])) : l.index + 1);
        l.orderStart.set(String(ev.order), t);
        set('index', l.index); set('total', this.total);
        break;
      }
      case 'stage_start': l.stageStart.set(key, t); set('attempt', 1); break;
      case 'stage_progress': set('pct', 50); set('label', ev.stage ?? 'working'); break;
      case 'stage_done': set('ms', Math.max(0, t - (l.stageStart.get(key) ?? t))); set('skipped', false); break;
      case 'stage_fail': set('error', 'failed'); set('retryable', true); set('attempt', 1); break;
      case 'chaos': set('depth', 1); set('source', 'user'); set('scope', 'inner'); set('injectedAt', t); break;
      case 'process_dead': set('reason', 'killed'); set('restartInMs', 0); break;
      case 'process_up': l.depth = 0; set('attempt', 1); break;
      case 'recover_start': l.depth = Math.min(5, l.depth + 1); l.recoverStart = t; set('depth', l.depth); break;
      case 'recover_done': set('depth', Math.max(1, l.depth)); set('ms', Math.max(0, t - l.recoverStart)); break;
      case 'order_done': {
        const c = l.repeats.get(String(ev.order)) ?? 0;
        set('repeats', c); set('clean', c === 0); set('ms', Math.max(0, t - (l.orderStart.get(String(ev.order)) ?? t)));
        break;
      }
      case 'repeat': l.repeats.set(String(ev.order), (l.repeats.get(String(ev.order)) ?? 0) + 1); break;
      default: break;
    }
    return { ...ev, detail: d };
  }
}

const CHAOS_CLOSERS = new Set([
  'chaos_absorbed', 'stage_fail', 'process_dead', 'recover_start', 'lane_halted',
  'order_parked', 'order_failed', 'order_quarantined', 'order_abandoned',
]);
interface Settle { pending?: Ev; dead: boolean; open: number }

/**
 * Sits between the runtime and the event log (PROTOCOL.md rules 7, 10, 20). Holds `boss_end` until every lane has
 * settled (no unanswered chaos, not dead, no open recovery), and at wave end closes chaos that never fired (the lane
 * finished first) with `chaos_absorbed`, then releases any held `boss_end`.
 */
export class SettleGate {
  private lanes = new Map<string, Settle>();
  private held: Ev[] = [];

  constructor(private readonly out: (ev: Ev) => void) {}

  begin(): void { this.lanes.clear(); this.held = []; }

  private lane(id: string): Settle {
    let s = this.lanes.get(id);
    if (!s) { s = { dead: false, open: 0 }; this.lanes.set(id, s); }
    return s;
  }

  private settled(): boolean {
    for (const s of this.lanes.values()) if (s.pending || s.dead || s.open > 0) return false;
    return true;
  }

  push(ev: Ev): void {
    if (ev.type === 'boss_end' && !this.settled()) { this.held.push(ev); return; }
    if (ev.lane !== undefined) {
      const s = this.lane(String(ev.lane));
      if (ev.type === 'chaos') s.pending = ev;
      else if (CHAOS_CLOSERS.has(ev.type)) s.pending = undefined;
      if (ev.type === 'process_dead') { s.dead = true; s.open = 0; }
      if (ev.type === 'process_up') s.dead = false;
      if (ev.type === 'order_start') s.open = 0;
      if (ev.type === 'recover_start') s.open++;
      if (ev.type === 'recover_done') s.open = Math.max(0, s.open - 1);
    }
    this.out(ev);
    if (this.held.length && ev.type !== 'boss_end' && this.settled()) this.release();
  }

  /** Before `wave_end`: absorb chaos that never fired, then let a held `boss_end` through. */
  finish(): void {
    for (const [lane, s] of this.lanes) {
      if (!s.pending) continue;
      const d = s.pending.detail ?? {};
      this.push({ type: 'chaos_absorbed', lane, detail: { creature: d.creature, fault: d.fault, reason: 'wave ended before the fault fired' } });
    }
    for (const s of this.lanes.values()) { s.dead = false; s.open = 0; }
    this.release();
  }

  private release(): void {
    const held = this.held;
    this.held = [];
    for (const ev of held) this.out(ev);
  }
}
