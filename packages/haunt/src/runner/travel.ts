// Travel scheduler (playtest-v2 design section 1, contract/V1_1.md rule 40). The runner owns one clock per lane and
// holds the bot's next event (never reorders) until the stated gap has passed: `walkMs` after a non-final stage_done,
// `grabMs` after order_start, `ceremonyMs + returnMs` after order_done, `cancelMs + returnMs` after order_failed.
// Replay pairs (skipped stage_done) and process restarts are exempt.
export interface TravelTimes { walkMs: number; grabMs: number; ceremonyMs: number; returnMs: number; cancelMs: number }

export const PACE_FACTOR: Record<string, number> = { normal: 1, show: 2, slow: 3 };
export const BASE_TRAVEL: Readonly<TravelTimes> = { walkMs: 400, grabMs: 500, ceremonyMs: 1600, returnMs: 1800, cancelMs: 900 };

/** Travel constants at a pace and speed: base x pace factor / speed, in real ms. */
export function travelAt(pace: string, speed: number): TravelTimes {
  const f = (PACE_FACTOR[pace] ?? 1) / (speed > 0 ? speed : 1);
  return {
    walkMs: BASE_TRAVEL.walkMs * f, grabMs: BASE_TRAVEL.grabMs * f, ceremonyMs: BASE_TRAVEL.ceremonyMs * f,
    returnMs: BASE_TRAVEL.returnMs * f, cancelMs: BASE_TRAVEL.cancelMs * f,
  };
}

type Ev = Record<string, any>;

/** Per-lane gate. `wait` is awaited before a bot event is processed; `annotate` adds the travel fields and starts the next gap. */
export class LaneTravel {
  private notBefore = 0;

  constructor(
    private readonly t: () => TravelTimes,
    private readonly lastStage: string,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  /** Milliseconds this raw bot event must still wait. */
  due(ev: Ev): number {
    if (ev.type !== 'stage_start' && ev.type !== 'order_start') return 0;
    return Math.max(0, this.notBefore - this.now());
  }

  async wait(ev: Ev): Promise<void> {
    const ms = this.due(ev);
    if (ms > 0) await this.sleep(ms);
  }

  /** Call for each shaped wire event, at the moment it is recorded. Returns the event with travel fields (never overwrites). */
  annotate(ev: Ev): Ev {
    const t = this.t();
    const d: Ev = { ...(ev.detail ?? {}) };
    const at = this.now();
    const gap = (ms: number): void => { this.notBefore = at + ms; };
    switch (ev.type) {
      case 'order_start': d.grabMs ??= t.grabMs; gap(d.grabMs); break;
      case 'stage_done':
        if (d.skipped === true || ev.stage === this.lastStage) break;
        d.walkMs ??= t.walkMs; gap(d.walkMs);
        break;
      case 'order_done': d.ceremonyMs ??= t.ceremonyMs; d.returnMs ??= t.returnMs; gap(d.ceremonyMs + d.returnMs); break;
      case 'order_failed': d.cancelMs ??= t.cancelMs; d.returnMs ??= t.returnMs; gap(d.cancelMs + d.returnMs); break;
      case 'process_dead': this.notBefore = 0; break;
      default: return ev;
    }
    return { ...ev, detail: d };
  }
}
