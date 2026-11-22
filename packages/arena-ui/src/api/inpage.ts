import {
  ApiError, CONTRACT_VERSION,
  type ArenaApi, type ArenaEvent, type ChaosModeOptions, type ChaosOptions, type ConnectionStatus, type DemoScript,
  type SubscribeHandlers, type Unsubscribe, type WaveOptions,
} from './types';

/** Shape of window.__haunt (contract/PROTOCOL.md). Each call mirrors the REST call of the same name. */
export interface HauntInPage {
  getHealth(): Promise<any>;
  getState(): Promise<any>;
  startWave(opts?: WaveOptions): Promise<any>;
  stopWave(): Promise<any>;
  setSpeed(speed: number): Promise<any>;
  chaos(opts?: ChaosOptions): Promise<any>;
  setChaosMode(opts: ChaosModeOptions): Promise<any>;
  startDemo(script: DemoScript): Promise<any>;
  stopDemo(): Promise<any>;
  getCaptions?(script: string): Promise<any>;
  getCreatures(): Promise<any>;
  getCampaign(): Promise<any>;
  getApps(): Promise<any>;
  setApp(app: string): Promise<any>;
  getLaneStage(lane: number, stage: string, order?: string): Promise<any>;
  getLaneLog(lane: number, opts?: { order?: string; since?: number }): Promise<any>;
  getLaneOrders(lane: number): Promise<any>;
  getLaneOrder(lane: number, order: string): Promise<any>;
  getLaneLaps(lane: number): Promise<any>;
  getWaveLaps(n: number): Promise<any>;
  getWaveStars(n: number): Promise<any>;
  decide(lane: number, order: string, choice: string): Promise<any>;
  setIntensity?(level: number, opts?: { autoRamp?: boolean; everyN?: number; max?: number }): Promise<any>;
  startTournament?(opts?: Record<string, unknown>): Promise<any>;
  next?(): Promise<any>;
  getTournament?(): Promise<any>;
  getCasebook?(): Promise<any>;
  getLessons?(lane: number): Promise<any>;
  getLedger(): Promise<any>;
  getWaves(): Promise<any>;
  getReport(n: number): Promise<any>;
  getCompare(n: number, m: number): Promise<any>;
  getPostmortem(n: number): Promise<any>;
  getHardening(n: number): Promise<any>;
  subscribe(fn: (e: ArenaEvent) => void, opts?: { since?: number }): () => void;
}

const wrap = async <T>(p: Promise<T>): Promise<T> => {
  try {
    return await p;
  } catch (e: any) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(e?.code ?? 'error', e?.message ?? String(e));
  }
};

export class InPageApi implements ArenaApi {
  constructor(private readonly h: HauntInPage) {}

  getHealth() { return wrap(this.h.getHealth()); }
  getState() { return wrap(this.h.getState()); }
  startWave(opts: WaveOptions = {}) { return wrap(this.h.startWave(opts)); }
  stopWave() { return wrap(this.h.stopWave()); }
  setSpeed(speed: number) { return wrap(this.h.setSpeed(speed)); }
  chaos(opts: ChaosOptions = {}) { return wrap(this.h.chaos(opts)); }
  setChaosMode(opts: ChaosModeOptions) { return wrap(this.h.setChaosMode(opts)); }
  startDemo(script: DemoScript) { return wrap(this.h.startDemo(script)); }
  stopDemo() { return wrap(this.h.stopDemo()); }
  getCaptions(script: DemoScript) { return wrap(this.h.getCaptions ? this.h.getCaptions(script) : Promise.reject(new ApiError('not_applicable', 'captions not available'))); }
  getCreatures() { return wrap(this.h.getCreatures()); }
  getCampaign() { return wrap(this.h.getCampaign()); }
  getApps() { return wrap(this.h.getApps()); }
  setApp(app: string) { return wrap(this.h.setApp(app)); }
  getLaneStage(lane: number, stage: string, order?: string) { return wrap(this.h.getLaneStage(lane, stage, order)); }
  getLaneLog(lane: number, opts: { order?: string; since?: number } = {}) { return wrap(this.h.getLaneLog(lane, opts)); }
  getLaneOrders(lane: number) { return wrap(this.h.getLaneOrders(lane)); }
  getLaneOrder(lane: number, order: string) { return wrap(this.h.getLaneOrder(lane, order)); }
  getLaneLaps(lane: number) { return wrap(this.h.getLaneLaps(lane)); }
  getWaveLaps(n: number) { return wrap(this.h.getWaveLaps(n)); }
  getWaveStars(n: number) { return wrap(this.h.getWaveStars(n)); }
  decide(lane: number, order: string, choice: string) { return wrap(this.h.decide(lane, order, choice)); }
  setIntensity(level: number, opts: { autoRamp?: boolean; everyN?: number; max?: number } = {}) { return wrap(this.h.setIntensity ? this.h.setIntensity(level, opts) : Promise.reject(new ApiError('not_applicable', 'the intensity dial needs a server'))); }
  private need<T>(f: ((...a: any[]) => Promise<T>) | undefined, ...a: any[]): Promise<T> {
    return wrap(f ? f.apply(this.h, a) : Promise.reject(new ApiError('not_applicable', 'the tournament needs a server')));
  }
  startTournament(opts: Record<string, unknown> = {}) { return this.need(this.h.startTournament, opts); }
  next() { return this.need(this.h.next); }
  getTournament() { return this.need(this.h.getTournament); }
  getCasebook() { return this.need(this.h.getCasebook); }
  getLessons(lane: number) { return this.need(this.h.getLessons, lane); }
  getLedger() { return wrap(this.h.getLedger()); }
  getWaves() { return wrap(this.h.getWaves()); }
  getReport(n: number) { return wrap(this.h.getReport(n)); }
  getCompare(n: number, m: number) { return wrap(this.h.getCompare(n, m)); }
  getPostmortem(n: number) { return wrap(this.h.getPostmortem(n)); }
  getHardening(n: number) { return wrap(this.h.getHardening(n)); }

  subscribe(handlers: SubscribeHandlers, opts: { since?: number } = {}): Unsubscribe {
    let closed = false;
    const status = (s: ConnectionStatus) => { if (!closed) handlers.onStatus?.(s); };
    status('connecting');
    const off = this.h.subscribe((ev) => {
      if (closed) return;
      if (ev.type === 'hello') {
        if (ev.contractVersion !== CONTRACT_VERSION) status('version_mismatch');
        else status('live');
      }
      handlers.onEvent(ev);
    }, opts.since === undefined ? undefined : { since: opts.since });
    return () => {
      if (closed) return;
      closed = true;
      off();
      handlers.onStatus?.('closed');
    };
  }
}
