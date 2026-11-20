// Fills the detail fields the contract requires on bot-forwarded events (PROTOCOL.md rule on detail). Bots emit the
// minimum; the live runtime owns the wire shape. Only missing keys are added, never overwritten.
type Ev = Record<string, any>;
interface LaneState { index: number; stageStart: Map<string, number>; orderStart: Map<string, number>; depth: number; recoverStart: number; repeats: Map<string, number> }

export class DetailNormalizer {
  private total = 1;
  private lanes = new Map<string, LaneState>();

  constructor(private readonly now: () => number = Date.now) {}

  begin(total: number): void { this.total = Math.max(1, Math.floor(total) || 1); this.lanes.clear(); }

  private lane(lane: string): LaneState {
    let l = this.lanes.get(lane);
    if (!l) { l = { index: 0, stageStart: new Map(), orderStart: new Map(), depth: 0, recoverStart: 0, repeats: new Map() }; this.lanes.set(lane, l); }
    return l;
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
      case 'chaos': set('depth', 1); set('source', 'manual'); set('scope', 'inner'); set('injectedAt', t); break;
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
