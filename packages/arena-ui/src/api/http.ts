import { SseParser } from './sse';
import {
  ApiError, CONTRACT_VERSION,
  type ArenaApi, type ArenaEvent, type ArenaState, type ChaosModeOptions, type ChaosOptions, type ChaosResult,
  type Caption, type ConnectionStatus, type Creature, type DemoScript, type Health, type SubscribeHandlers, type Unsubscribe, type WaveOptions,
  type AppInfo, type LogLine, type WaveSummary,
} from './types';

export interface HttpOptions {
  /** '' means same origin (core serves the UI, or the Vite proxy forwards). Otherwise e.g. http://127.0.0.1:7070. */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Reconnect backoff in ms: starts at min, doubles up to max. */
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
}

const q = (params: Record<string, string | number | undefined>): string => {
  const s = Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return s ? `?${s}` : '';
};

export class HttpApi implements ArenaApi {
  private readonly base: string;
  private readonly f: typeof fetch;
  private readonly minMs: number;
  private readonly maxMs: number;

  constructor(opts: HttpOptions = {}) {
    this.base = (opts.baseUrl ?? '').replace(/\/+$/, '');
    this.f = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    this.minMs = opts.reconnectMinMs ?? 500;
    this.maxMs = opts.reconnectMaxMs ?? 5000;
  }

  private async request<T>(method: string, path: string, body?: unknown, text = false): Promise<T> {
    let res: Response;
    try {
      res = await this.f(this.base + path, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new ApiError('unreachable', e instanceof Error ? e.message : 'network error');
    }
    if (!res.ok) {
      let code = 'http_' + res.status;
      let message = res.statusText;
      try {
        const j = (await res.json()) as { error?: { code?: string; message?: string } } | null;
        if (j?.error) { code = j.error.code ?? code; message = j.error.message ?? message; }
      } catch { /* non-JSON error body */ }
      throw new ApiError(code, message, res.status);
    }
    if (text) return (await res.text()) as T;
    const raw = await res.text();
    return (raw ? JSON.parse(raw) : {}) as T;
  }

  getHealth() { return this.request<Health>('GET', '/api/health'); }
  getState() { return this.request<ArenaState>('GET', '/api/state'); }
  startWave(opts: WaveOptions = {}) { return this.request<{ wave: number }>('POST', '/api/wave/start', opts); }
  stopWave() { return this.request('POST', '/api/wave/stop'); }
  setSpeed(speed: number) { return this.request<{ speed: number }>('POST', '/api/speed', { speed }); }
  chaos(opts: ChaosOptions = {}) { return this.request<ChaosResult>('POST', '/api/chaos', opts); }
  setChaosMode(opts: ChaosModeOptions) { return this.request('POST', '/api/chaos/mode', opts); }
  startDemo(script: DemoScript, speed?: number) { return this.request('POST', '/api/demo/start', speed === undefined ? { script } : { script, speed }); }
  stopDemo() { return this.request('POST', '/api/demo/stop'); }
  getCaptions(script: DemoScript) { return this.request<Caption[]>('GET', `/api/demo/captions/${encodeURIComponent(script)}`); }
  getCreatures() { return this.request<Creature[]>('GET', '/api/creatures'); }
  getCampaign() { return this.request('GET', '/api/campaign'); }
  getApps() { return this.request<AppInfo[]>('GET', '/api/apps'); }
  setApp(app: string) { return this.request('POST', '/api/app', { app }); }
  getLaneStage(lane: number, stage: string, order?: string) {
    return this.request('GET', `/api/lane/${lane}/stage/${encodeURIComponent(stage)}${q({ order })}`);
  }
  getLaneLog(lane: number, opts: { order?: string; since?: number } = {}) {
    return this.request<{ lines: LogLine[] }>('GET', `/api/lane/${lane}/log${q({ order: opts.order, since: opts.since })}`);
  }
  getLaneOrders(lane: number) { return this.request('GET', `/api/lane/${lane}/orders`); }
  getLaneOrder(lane: number, order: string) { return this.request('GET', `/api/lane/${lane}/order/${encodeURIComponent(order)}`); }
  getLaneLaps(lane: number) { return this.request('GET', `/api/lane/${lane}/laps`); }
  getWaveLaps(n: number) { return this.request('GET', `/api/waves/${n}/laps`); }
  getWaveStars(n: number) { return this.request('GET', `/api/waves/${n}/stars`); }
  decide(lane: number, order: string, choice: string) { return this.request('POST', '/api/decision', { lane, order, choice }); }
  setIntensity(level: number, opts: { autoRamp?: boolean; everyN?: number; max?: number } = {}) { return this.request('POST', '/api/intensity', { level, ...opts }); }
  startTournament(opts: Record<string, unknown> = {}) { return this.request('POST', '/api/tournament/start', opts); }
  next() { return this.request('POST', '/api/next'); }
  getTournament() { return this.request('GET', '/api/tournament'); }
  getCasebook() { return this.request('GET', '/api/casebook'); }
  getPatterns() { return this.request('GET', '/api/patterns'); }
  writeSpecs(opts: { runId?: string } = {}) { return this.request('POST', '/api/specs', opts); }
  startImprove(opts: Record<string, unknown> = {}) { return this.request('POST', '/api/improve', opts); }
  getImprove() { return this.request('GET', '/api/improve'); }
  resetLessons() { return this.request('DELETE', '/api/lessons'); }
  getLessons(lane: number) { return this.request('GET', `/api/lessons/${lane}`); }
  getLedger() { return this.request('GET', '/api/ledger'); }
  getWaves() { return this.request<WaveSummary[]>('GET', '/api/waves'); }
  getReport(n: number) { return this.request('GET', `/api/waves/${n}/report`); }
  getCompare(n: number, m: number) { return this.request('GET', `/api/waves/${n}/compare/${m}`); }
  getPostmortem(n: number) { return this.request<string>('GET', `/api/waves/${n}/postmortem`, undefined, true); }
  getHardening(n: number) { return this.request('GET', `/api/waves/${n}/hardening`); }

  /**
   * Streams /api/events with fetch (not EventSource) so a 410 is visible as a status code.
   * Reconnects with the last seen seq. On 410 it calls onGone and resubscribes without `since`.
   * `seq` keeps increasing for the life of the server process, so a `reset` event needs no special handling here.
   */
  subscribe(handlers: SubscribeHandlers, opts: { since?: number } = {}): Unsubscribe {
    const ctl = new AbortController();
    let closed = false;
    let since = opts.since;
    let delay = this.minMs;
    const status = (s: ConnectionStatus) => { if (!closed) handlers.onStatus?.(s); };

    const sleep = (ms: number) => new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms);
      ctl.signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
    });

    const run = async () => {
      let first = true;
      while (!closed) {
        status(first ? 'connecting' : 'reconnecting');
        first = false;
        try {
          const res = await this.f(this.base + '/api/events' + q({ since }), {
            headers: { Accept: 'text/event-stream' },
            signal: ctl.signal,
          });
          if (res.status === 410) {
            since = undefined;
            handlers.onGone?.();
            continue;
          }
          if (!res.ok || !res.body) throw new ApiError('http_' + res.status, res.statusText, res.status);
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          const parser = new SseParser();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            for (const payload of parser.push(dec.decode(value, { stream: true }))) {
              let ev: ArenaEvent;
              try { ev = JSON.parse(payload); } catch { continue; }
              if (typeof ev?.type !== 'string') continue;
              if (typeof ev.seq === 'number') since = ev.seq;
              if (ev.type === 'hello') {
                if (ev.contractVersion !== CONTRACT_VERSION) {
                  status('version_mismatch');
                  handlers.onEvent(ev);
                  closed = true;
                  ctl.abort();
                  return;
                }
                delay = this.minMs;
                status('live');
              }
              handlers.onEvent(ev);
            }
          }
        } catch (e) {
          if (closed) return;
          void e; // network drop: fall through to backoff and retry
        }
        if (closed) return;
        status('reconnecting');
        await sleep(delay);
        delay = Math.min(delay * 2, this.maxMs);
      }
    };
    void run();

    return () => {
      if (closed) return;
      closed = true;
      ctl.abort();
      handlers.onStatus?.('closed');
    };
  }
}
