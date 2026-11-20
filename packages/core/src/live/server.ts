// Live server: the contract's REST and SSE surface on top of the real event log and wave manager.
// Spec: contract/PROTOCOL.md. Binds to loopback only. The engine (runner process loop) plugs in through `LiveEngine`;
// without one the server still serves every read endpoint and validates every write.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { EventLog } from '../../../haunt/src/events/eventlog';
import { WaveManager } from '../../../haunt/src/score/wave';
import type { HauntEvent } from '../../../haunt/src/score/score';
import { tiersForLanes, type TierMode } from '../../../haunt/src/runner/lanes';
import { MAX_DEPTH } from '../../../haunt/src/chaos/catalog';
import { fnv1a32, mulberry32 } from '../../../haunt/src/shared/rng';
import { APPS, APP_STAGES, CONTRACT_VERSION, CREATURES, DEMO_SCRIPTS, FAULT_IDS, type AppId } from './catalog';
import { buildPostmortem, buildReport, waveEvents } from './report';
import { loadDemo } from './demo';
import type { HardeningBody } from './runtime';
import { applyEvent, logLine, newLane, toWire, type LaneView } from './lanes';

export const LIVE_HOST = '127.0.0.1';
export const LIVE_PORT = 7070;
export const RETAINED_EVENTS = 5000;
export const PING_MS = 15000;
const SPEEDS = [0.5, 1, 2, 4];

export interface ChaosRequest { lane?: number; creature?: string; fault: string; scope?: 'inner' | 'outer'; point?: string }
export interface ChaosResult { chaosId: string; creature: string; fault: string; depth: number; deferred: boolean }
export interface WaveSettings { orders: number; seed: number; tiers: TierMode; lanes: number; speed: number; pace: 'normal' | 'show'; app: AppId }

/** What the runner provides. Every hook is optional so the server is usable (read-only) before the runner exists. */
export interface LiveEngine {
  startWave?(wave: number, settings: WaveSettings, record: (ev: HauntEvent) => void): void;
  stopWave?(): void;
  setSpeed?(speed: number): void;
  chaos?(req: ChaosRequest): ChaosResult;
  setChaosMode?(mode: ChaosMode): void;
  startDemo?(script: string, speed?: number): void;
  stopDemo?(): void;
}

export interface ChaosMode { mode: 'off' | 'manual' | 'random'; frequency: number; seed: number }

export interface LiveOptions {
  log?: EventLog;
  engine?: LiveEngine;
  app?: AppId;
  /** Directory of built UI files served at `/`. Defaults to `packages/arena-ui/dist` when present. */
  staticDir?: string;
  ledger?: () => { lanes: unknown[] };
  /** Hardening spec the reviewer wrote after a wave. Undefined means not ready (404). */
  hardening?: (wave: number) => HardeningBody | undefined;
  pingMs?: number;
}

class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const fail = (status: number, code: string, message: string): never => { throw new ApiError(status, code, message); };

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
};
const ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export class LiveServer {
  readonly log: EventLog;
  readonly waves: WaveManager;
  readonly lanes = new Map<number, LaneView>();
  readonly engine: LiveEngine;
  app: AppId;
  settings?: WaveSettings & { startedAt: number };
  chaosMode: ChaosMode = { mode: 'manual', frequency: 0.3, seed: 7 };
  demoRunning: string | null = null;
  private chaosCount = 0;
  private readonly staticDir?: string;
  private readonly ledger: () => { lanes: unknown[] };
  private readonly pingMs: number;
  private readonly hardening: (wave: number) => HardeningBody | undefined;
  private readonly clients = new Set<ServerResponse>();
  private http?: Server;

  constructor(opts: LiveOptions = {}) {
    this.log = opts.log ?? new EventLog();
    this.waves = new WaveManager(this.log);
    this.engine = opts.engine ?? {};
    this.app = opts.app ?? 'orders';
    this.ledger = opts.ledger ?? (() => ({ lanes: [] }));
    this.pingMs = opts.pingMs ?? PING_MS;
    this.hardening = opts.hardening ?? (() => undefined);
    const dist = opts.staticDir ?? resolve(process.cwd(), 'packages', 'arena-ui', 'dist');
    this.staticDir = existsSync(dist) ? dist : undefined;
    this.log.subscribe((ev) => {
      applyEvent(this.lanes, ev, APP_STAGES[this.app]);
      if (ev.type === 'wave_end') this.demoRunning = null;
      const line = `data: ${JSON.stringify(toWire(ev))}\n\n`;
      for (const c of this.clients) c.write(line);
    });
    this.log.emit({ type: 'reset' });
  }

  // ---- lifecycle ----

  async listen(port = LIVE_PORT): Promise<{ url: string; port: number }> {
    this.http = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.http!.listen(port, LIVE_HOST, r));
    const addr = this.http.address();
    const p = typeof addr === 'object' && addr ? addr.port : port;
    return { url: `http://${LIVE_HOST}:${p}`, port: p };
  }

  async close(): Promise<void> {
    for (const c of this.clients) c.end();
    this.clients.clear();
    this.log.close();
    const h = this.http;
    this.http = undefined;
    if (h) await new Promise<void>((r) => { h.close(() => r()); h.closeAllConnections?.(); });
  }

  // ---- helpers ----

  private get seq(): number { return this.log.events.at(-1)?.seq ?? 0; }
  private get stages() { return APP_STAGES[this.app]; }
  private laneList(): LaneView[] { return [...this.lanes.values()].sort((a, b) => a.lane - b.lane); }

  private laneOf(raw: string | undefined): LaneView {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 5) return fail(400, 'bad_lane', `bad lane ${raw}`);
    const l = this.lanes.get(n);
    if (!l) return fail(400, 'bad_lane', `lane ${n} is not in the current wave`);
    return l;
  }

  private laneEvents(lane: number): HauntEvent[] {
    return this.log.events.filter((e) => e.lane !== undefined && Number(e.lane) === lane);
  }

  private wavesView() {
    return this.waves.waves.map((w) => ({ n: w.n, startedAt: w.startedAt, ...(w.endedAt ? { endedAt: w.endedAt } : {}), ...(w.grade ? { grade: w.grade, grades: w.grades } : {}), score: w.score }));
  }

  // ---- read endpoints ----

  state() {
    const running = this.waves.active;
    const s = this.settings;
    return {
      contractVersion: CONTRACT_VERSION, mode: 'live', app: this.app,
      wave: s ? { n: this.waves.n, running, seed: s.seed, speed: s.speed, orders: s.orders, tiers: s.tiers, startedAt: s.startedAt } : null,
      chaos: { ...this.chaosMode },
      stages: this.stages,
      lanes: this.laneList(),
      boss: { next: null, startsInMs: null, active: false },
      demo: { scripts: [...DEMO_SCRIPTS], running: this.demoRunning },
    };
  }

  private stageInspector(lane: LaneView, stage: string, orderQ: string | undefined) {
    if (!this.stages.some((s) => s.id === stage)) fail(400, 'bad_request', `unknown stage ${stage}`);
    const evs = this.laneEvents(lane.lane);
    const order = orderQ ?? lane.order ?? [...evs].reverse().find((e) => e.order)?.order ?? null;
    const LANE_LEVEL = ['chaos', 'process_dead', 'process_up', 'recover_start', 'recover_done'];
    const mine = evs.filter((e) => (e.order === undefined || e.order === order) && (e.stage === stage || (e.stage === undefined && LANE_LEVEL.includes(e.type))));
    const attempts: { attempt: number; startTs: number; endTs?: number; status: string; error?: string }[] = [];
    for (const e of mine) {
      const d = (e.detail ?? {}) as Record<string, any>;
      const cur = attempts.at(-1);
      if (e.type === 'stage_start' && e.stage === stage) attempts.push({ attempt: d.attempt ?? attempts.length + 1, startTs: e.ts!, status: 'active' });
      else if (cur?.status === 'active' && e.type === 'stage_done') { cur.endTs = e.ts; cur.status = 'done'; }
      else if (cur?.status === 'active' && e.type === 'stage_fail') { cur.endTs = e.ts; cur.status = 'failed'; cur.error = d.error; }
      else if (cur?.status === 'active' && e.type === 'process_dead') { cur.endTs = e.ts; cur.status = 'killed'; }
    }
    const last = attempts.at(-1);
    const parked = mine.some((e) => e.stage === stage && e.type === 'order_parked');
    const quarantined = mine.some((e) => e.stage === stage && e.type === 'order_quarantined');
    const status = quarantined ? 'quarantined' : parked ? 'parked'
      : !last ? 'pending' : last.status === 'killed' ? 'dead' : last.status;
    const stageEvents = mine.filter((e) => e.stage === stage).map(toWire);
    return {
      lane: lane.lane, order, stage, status, input: null, output: null, attempts,
      events: stageEvents,
      effects: mine.filter((e) => e.type === 'effect' && e.stage === stage).map((e) => ({ ts: e.ts, ...(e.detail as object), rowId: null })),
      chaos: mine.filter((e) => e.type === 'chaos').map(toWire),
      recover: mine.filter((e) => e.type === 'recover_start' || e.type === 'recover_done').map(toWire),
      journal: [],
    };
  }

  private laneLog(lane: LaneView, q: URLSearchParams) {
    const since = Number(q.get('since') ?? 0) || 0;
    const order = q.get('order');
    const lines = [];
    for (const e of this.laneEvents(lane.lane)) {
      if (e.seq! <= since || (order && e.order !== order)) continue;
      const l = logLine(e);
      if (l) lines.push({ seq: e.seq, ts: e.ts, level: l.level, type: e.type, stage: e.stage ?? null, order: e.order ?? null, text: l.text });
    }
    return { lines };
  }

  private laneOrders(lane: LaneView) {
    const out = new Map<string, string>();
    for (const e of this.laneEvents(lane.lane)) {
      if (!e.order) continue;
      if (e.type === 'order_start' || e.type === 'order_resumed') out.set(e.order, 'active');
      else if (e.type === 'order_done') out.set(e.order, 'done');
      else if (e.type === 'order_failed') out.set(e.order, 'failed');
      else if (e.type === 'order_parked') out.set(e.order, 'parked');
      else if (e.type === 'order_quarantined') out.set(e.order, 'quarantined');
      else if (e.type === 'order_abandoned') out.set(e.order, 'abandoned');
    }
    return [...out].map(([order, outcome]) => ({ order, outcome }));
  }

  private waveRecord(raw: string | undefined) {
    const n = Number(raw);
    const w = this.waves.waves.find((x) => x.n === n);
    if (!w) return fail(404, 'not_ready', `no wave ${raw}`);
    return w;
  }

  private compare(a: string | undefined, b: string | undefined) {
    const wa = this.waveRecord(a), wb = this.waveRecord(b);
    if (!wa.endedAt || !wb.endedAt) fail(404, 'not_ready', 'both waves must have ended');
    const order = ['A', 'B', 'C', 'D', 'F'];
    const rank = (g: string | undefined) => (g ? order.indexOf(g) : order.length);
    const cells = Object.keys({ ...wa.grades, ...wb.grades }).map((k) => {
      const ga = wa.grades?.[k], gb = wb.grades?.[k];
      const change = rank(gb) < rank(ga) ? 'improved' : rank(gb) > rank(ga) ? 'worse' : 'same';
      const tier = this.lanes.get(Number(k))?.tier;
      return { lane: Number(k), ...(tier ? { tier } : {}), a: { grade: ga, score: 0, repeats: 0 }, b: { grade: gb, score: 0, repeats: 0 }, change };
    });
    return { a: { score: wa.score, grade: wa.grade, repeats: 0 }, b: { score: wb.score, grade: wb.grade, repeats: 0 }, cells };
  }

  // ---- write endpoints ----

  private startWave(body: Record<string, any>) {
    if (this.waves.active) fail(409, 'wave_running', 'a wave is running');
    const num = (k: string, def: number, ok: (n: number) => boolean) => {
      const v = body[k] ?? def;
      if (typeof v !== 'number' || !ok(v)) fail(400, 'bad_request', `bad ${k}`);
      return v as number;
    };
    const orders = num('orders', 12, (n) => Number.isInteger(n) && n >= 1 && n <= 200);
    const seed = num('seed', 7, Number.isInteger);
    const lanes = num('lanes', 5, (n) => Number.isInteger(n) && n >= 1 && n <= 5);
    const speed = num('speed', 1, (n) => SPEEDS.includes(n));
    const tiers = body.tiers ?? 'race';
    if (tiers !== 'race' && tiers !== 'allPhoenix') fail(400, 'bad_request', 'bad tiers');
    const pace = body.pace ?? 'normal';
    if (pace !== 'normal' && pace !== 'show') fail(400, 'bad_request', 'bad pace');
    const app = body.app ?? this.app;
    if (app !== 'orders' && app !== 'inbox') fail(400, 'bad_request', 'bad app');
    if (app !== this.app) this.switchApp(app);

    const defs = tiersForLanes(lanes, tiers);
    this.lanes.clear();
    const perLane: Record<string, number> = {};
    defs.forEach((t, i) => {
      this.lanes.set(i + 1, newLane(i + 1, t.id, t.label, t.use, orders));
      perLane[String(i + 1)] = orders;
    });
    const settings: WaveSettings = { orders, seed, tiers, lanes, speed, pace, app };
    const n = this.waves.start({ lanes: perLane, info: { orders, seed, tiers, lanes, speed, app, pace } });
    this.settings = { ...settings, startedAt: this.waves.waves.at(-1)!.startedAt };
    defs.forEach((t, i) => this.waves.record({ type: 'lane_ready', lane: String(i + 1), detail: { tier: t.id, label: t.label, parts: [...t.use] } }));
    this.engine.startWave?.(n, settings, (ev) => { if (this.waves.active) this.waves.record(ev); });
    return { wave: n };
  }

  private switchApp(app: AppId) {
    if (this.waves.active) fail(409, 'wave_running', 'a wave is running');
    this.app = app;
    this.lanes.clear();
    this.log.emit({ type: 'reset' });
  }

  private chaos(body: Record<string, any>): ChaosResult {
    if (!this.waves.active) fail(409, 'no_wave', 'no wave is running');
    const isBoss = (f: string) => f.startsWith('boss_');
    let creature = typeof body.creature === 'string' ? CREATURES.find((c) => c.id === body.creature) : undefined;
    if (body.creature !== undefined && !creature) fail(400, 'bad_creature', `unknown creature ${body.creature}`);
    if (body.fault !== undefined && !(typeof body.fault === 'string' && FAULT_IDS.has(body.fault))) fail(400, 'bad_fault', `unknown fault ${body.fault}`);
    if (body.scope !== undefined && body.scope !== 'inner' && body.scope !== 'outer') fail(400, 'bad_request', 'bad scope');
    let fault: string | undefined = body.fault;
    if (creature && fault && !creature.causes.includes(fault)) fail(400, 'bad_fault', `${creature.id} does not cause ${fault}`);
    if (!creature && fault) creature = CREATURES.find((c) => c.causes.includes(fault!));
    if (!fault) {
      const pool = creature ? creature.causes : CREATURES.filter((c) => !c.boss).flatMap((c) => c.causes);
      const rng = mulberry32(fnv1a32(`${this.chaosMode.seed}|chaos|${this.chaosCount}`));
      fault = pool[Math.floor(rng() * pool.length)]!;
      creature = creature ?? CREATURES.find((c) => c.causes.includes(fault!));
    }
    const f = fault!;
    const req: ChaosRequest = { fault: f, creature: creature!.id, scope: body.scope, point: body.point };
    if (body.lane === undefined) {
      if (!isBoss(f)) fail(400, 'bad_lane', 'lane is required unless the fault is a boss fault');
    } else {
      const l = this.laneOf(String(body.lane));
      req.lane = l.lane;
      if (isBoss(f)) fail(400, 'bad_request', 'boss faults hit every lane; omit lane');
      if (l.state === 'idle' || l.state === 'halted' || l.state === 'done') fail(409, 'lane_not_active', `lane ${l.lane} is ${l.state}`);
      if (l.depth >= MAX_DEPTH) fail(409, 'depth_limit', `chaos depth is ${MAX_DEPTH}`);
    }
    if (!this.engine.chaos) fail(409, 'not_applicable', 'no engine is attached');
    this.chaosCount++;
    return this.engine.chaos!(req);
  }

  private setChaosMode(body: Record<string, any>) {
    if (!['off', 'manual', 'random'].includes(body.mode)) fail(400, 'bad_request', 'bad mode');
    const freq = body.frequency ?? this.chaosMode.frequency;
    if (typeof freq !== 'number' || freq < 0 || freq > 1) fail(400, 'bad_request', 'bad frequency');
    const seed = body.seed ?? this.chaosMode.seed;
    if (!Number.isInteger(seed)) fail(400, 'bad_request', 'bad seed');
    this.chaosMode = { mode: body.mode, frequency: freq, seed };
    this.engine.setChaosMode?.(this.chaosMode);
    return {};
  }

  // ---- routing ----

  private route(method: string, url: URL, body: Record<string, any>): { status?: number; json?: unknown; text?: string } | undefined {
    const p = url.pathname;
    const q = url.searchParams;
    const seg = p.split('/').filter(Boolean);
    if (method === 'GET') {
      if (p === '/api/health') return { json: { ok: true, contractVersion: CONTRACT_VERSION, mode: 'live', app: this.app } };
      if (p === '/api/state') return { json: this.state() };
      if (p === '/api/creatures') return { json: CREATURES };
      if (p === '/api/apps') return { json: APPS };
      if (p === '/api/ledger') return { json: this.ledger() };
      if (p === '/api/waves') return { json: this.wavesView() };
      if (seg[0] === 'api' && seg[1] === 'waves' && seg.length >= 4) {
        this.waveRecord(seg[2]);
        if (seg[3] === 'compare' && seg[4]) return { json: this.compare(seg[2], seg[4]) };
        if (seg[3] === 'report' || seg[3] === 'postmortem') {
          const w = this.waveRecord(seg[2]);
          if (!w.endedAt) return fail(404, 'not_ready', `wave ${w.n} has not ended`);
          const start = this.log.events.find((e) => e.type === 'wave_start' && e.wave === w.n);
          const info = { app: String((start?.detail as any)?.app ?? this.app), seed: Number((start?.detail as any)?.seed ?? 0) };
          const report = buildReport(w, waveEvents(this.log.events, w.n), info);
          return seg[3] === 'report' ? { json: report } : { text: buildPostmortem(w, report) };
        }
        if (seg[3] === 'hardening') {
          const w = this.waveRecord(seg[2]);
          const h = w.endedAt ? this.hardening(w.n) : undefined;
          return h ? { json: h } : fail(404, 'not_ready', `no hardening spec for wave ${w.n}`);
        }
      }
      if (seg[0] === 'api' && seg[1] === 'lane' && seg.length >= 4 && seg[3] === 'orders') return { json: this.laneOrders(this.laneOf(seg[2])) };
      if (seg[0] === 'api' && seg[1] === 'lane' && seg[3] === 'log' && seg.length === 4) return { json: this.laneLog(this.laneOf(seg[2]), q) };
      if (seg[0] === 'api' && seg[1] === 'lane' && seg[3] === 'stage' && seg[4]) return { json: this.stageInspector(this.laneOf(seg[2]), seg[4], q.get('order') ?? undefined) };
      return undefined;
    }
    if (method !== 'POST') return undefined;
    switch (p) {
      case '/api/wave/start': return { json: this.startWave(body) };
      case '/api/wave/stop':
        if (!this.waves.active) fail(409, 'no_wave', 'no wave is running');
        this.engine.stopWave?.();
        if (this.waves.active) this.waves.end(true);
        return { json: {} };
      case '/api/speed': {
        if (!SPEEDS.includes(body.speed)) fail(400, 'bad_request', 'bad speed');
        if (this.settings) this.settings.speed = body.speed;
        this.engine.setSpeed?.(body.speed);
        return { json: { speed: body.speed } };
      }
      case '/api/chaos': return { json: this.chaos(body) };
      case '/api/chaos/mode': return { json: this.setChaosMode(body) };
      case '/api/demo/start':
        if (!(DEMO_SCRIPTS as readonly string[]).includes(body.script)) fail(400, 'bad_request', 'bad script');
        if (!this.engine.startDemo) fail(409, 'not_applicable', 'demo needs the engine');
        if (body.speed !== undefined && !SPEEDS.includes(body.speed)) fail(400, 'bad_request', 'bad speed');
        {
          const d = loadDemo(body.script);
          const speed = body.speed ?? 1;
          this.startWave({ orders: d.orders, seed: d.seed, lanes: d.lanes, tiers: d.tiers, pace: d.pace, speed });
          this.demoRunning = body.script;
          this.engine.startDemo!(body.script, speed);
        }
        return { json: {} };
      case '/api/demo/stop':
        this.engine.stopDemo?.();
        this.demoRunning = null;
        return { json: {} };
      case '/api/app':
        if (body.app !== 'orders' && body.app !== 'inbox') fail(400, 'bad_request', 'bad app');
        this.switchApp(body.app);
        return { json: {} };
      default: return undefined;
    }
  }

  // ---- http ----

  private cors(req: IncomingMessage, res: ServerResponse): void {
    const o = req.headers.origin;
    if (o && ORIGIN_RE.test(o)) {
      res.setHeader('access-control-allow-origin', o);
      res.setHeader('vary', 'origin');
      res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
      res.setHeader('access-control-allow-headers', 'content-type');
    }
  }

  private sendJson(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  }

  private sse(req: IncomingMessage, res: ServerResponse, since: number | undefined): void {
    const retained = this.log.events.slice(-RETAINED_EVENTS);
    if (since !== undefined && retained.length > 0 && since < retained[0]!.seq - 1) {
      this.sendJson(res, 410, { error: { code: 'gone', message: 'since is older than the retained events' } });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ type: 'hello', contractVersion: CONTRACT_VERSION, mode: 'live', seq: this.seq, app: this.app })}\n\n`);
    if (since !== undefined) for (const e of retained) if (e.seq > since) res.write(`data: ${JSON.stringify(toWire(e))}\n\n`);
    this.clients.add(res);
    const timer = setInterval(() => res.write(': ping\n\n'), this.pingMs);
    req.on('close', () => { clearInterval(timer); this.clients.delete(res); });
  }

  private serveStatic(url: URL, res: ServerResponse): boolean {
    if (!this.staticDir) return false;
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    const file = join(this.staticDir, rel === '' ? 'index.html' : rel);
    if (file !== this.staticDir && !file.startsWith(this.staticDir + sep)) return false;
    if (!existsSync(file) || !statSync(file).isFile()) return false;
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
    return true;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.cors(req, res);
    try {
      const method = req.method ?? 'GET';
      if (method === 'OPTIONS') { res.writeHead(204).end(); return; }
      const url = new URL(req.url ?? '/', `http://${LIVE_HOST}`);
      let body: Record<string, any> = {};
      if (method === 'POST') {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const c of req) {
          size += (c as Buffer).length;
          if (size > 1_000_000) fail(400, 'bad_request', 'body too large');
          chunks.push(c as Buffer);
        }
        const raw = Buffer.concat(chunks).toString('utf8');
        if (raw.trim()) {
          try { body = JSON.parse(raw); } catch { fail(400, 'bad_request', 'invalid json'); }
          if (body === null || typeof body !== 'object' || Array.isArray(body)) fail(400, 'bad_request', 'body must be an object');
        }
      }
      if (method === 'GET' && url.pathname === '/api/events') {
        const s = url.searchParams.get('since');
        if (s !== null && !/^\d+$/.test(s)) fail(400, 'bad_request', 'bad since');
        this.sse(req, res, s === null ? undefined : Number(s));
        return;
      }
      const out = this.route(method, url, body);
      if (out?.text !== undefined) { res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' }).end(out.text); return; }
      if (out) { this.sendJson(res, out.status ?? 200, out.json); return; }
      if (method === 'GET' && !url.pathname.startsWith('/api/') && this.serveStatic(url, res)) return;
      this.sendJson(res, 404, { error: { code: 'bad_request', message: `no route ${method} ${url.pathname}` } });
    } catch (e) {
      if (e instanceof ApiError) this.sendJson(res, e.status, { error: { code: e.code, message: e.message } });
      else this.sendJson(res, 500, { error: { code: 'bad_request', message: 'internal error' } });
    }
  }
}
