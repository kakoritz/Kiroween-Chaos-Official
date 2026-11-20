// window.__haunt: the in-page transport for contract mode `browser` (PROTOCOL.md). Same operations as the
// REST calls, no HTTP. Events get a sequence number so `subscribe(fn, {since})` can replay from a point.
// No node imports (must bundle for the browser).

export interface HauntEvent {
  seq: number;
  [k: string]: unknown;
}

export interface HauntState {
  mode: 'browser';
  running: boolean;
  [k: string]: unknown;
}

export interface InPageHandlers {
  getState(): Record<string, unknown>;
  startWave?(opts: Record<string, unknown>): Promise<Record<string, unknown>> | Record<string, unknown>;
  chaos?(opts: Record<string, unknown>): Promise<Record<string, unknown>> | Record<string, unknown>;
}

export interface HauntApi {
  getState(): HauntState;
  startWave(opts?: Record<string, unknown>): Promise<Record<string, unknown>>;
  chaos(opts?: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** Replays buffered events with seq > since, then streams new ones. Returns an unsubscribe function. */
  subscribe(fn: (ev: HauntEvent) => void, opts?: { since?: number }): () => void;
}

export class InPageHaunt implements HauntApi {
  private events: HauntEvent[] = [];
  private subs = new Set<(ev: HauntEvent) => void>();
  private seq = 0;

  constructor(private readonly h: InPageHandlers, private readonly cap = 5000) {}

  /** Publish a contract event or control message from the engine. */
  publish(msg: Record<string, unknown>): HauntEvent {
    const ev: HauntEvent = { ...msg, seq: ++this.seq };
    this.events.push(ev);
    if (this.events.length > this.cap) this.events.splice(0, this.events.length - this.cap);
    for (const f of [...this.subs]) f(ev);
    return ev;
  }

  getState(): HauntState {
    return { running: false, ...this.h.getState(), mode: 'browser' };
  }

  async startWave(opts: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (!this.h.startWave) throw new Error('startWave is not available');
    return this.h.startWave(opts);
  }

  async chaos(opts: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (!this.h.chaos) throw new Error('chaos is not available');
    return this.h.chaos(opts);
  }

  subscribe(fn: (ev: HauntEvent) => void, opts: { since?: number } = {}): () => void {
    const since = opts.since ?? 0;
    for (const ev of this.events) if (ev.seq > since) fn(ev);
    this.subs.add(fn);
    return () => void this.subs.delete(fn);
  }
}

/** Install the API as `window.__haunt` (or on any target object). */
export function installHaunt(target: { __haunt?: HauntApi }, api: HauntApi): HauntApi {
  target.__haunt = api;
  return api;
}
