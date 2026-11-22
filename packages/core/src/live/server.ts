// Live server: the contract's REST and SSE surface on top of the real event log and wave manager.
// Spec: contract/PROTOCOL.md. Binds to loopback only. The engine (runner process loop) plugs in through `LiveEngine`;
// without one the server still serves every read endpoint and validates every write.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { EventLog } from '../../../haunt/src/events/eventlog';
import { WaveManager } from '../../../haunt/src/score/wave';
import type { HauntEvent } from '../../../haunt/src/score/score';
import { tiersForLanes, type CrewSpec, type TierMode } from '../../../haunt/src/runner/lanes';
import { MAX_DEPTH } from '../../../haunt/src/chaos/catalog';
import { fnv1a32, mulberry32 } from '../../../haunt/src/shared/rng';
import { loadCampaign } from '../../../haunt/src/campaign/nights';
import { campaignWaveConfig, parseCampaignRequest, type CampaignRequest } from '../../../haunt/src/campaign/wave-config';
import { APPS, APP_STAGES, CONTRACT_VERSION, CREATURES, DEMO_SCRIPTS, FAULT_IDS, type AppId } from './catalog';
import { LapTracker } from './lap-tracker';
import { laneLaps, orderRecord, waveLaps, waveStars } from './laps';
import { PACE_FACTOR } from '../../../haunt/src/runner/travel';
import { buildPostmortem, buildReport, waveEvents } from './report';
import { loadDemo } from './demo';
import { CAPTION_SCRIPTS, loadCaptions } from './captions';
import type { HardeningBody } from './runtime';
import { applyEvent, logLine, newLane, toWire, type LaneView } from './lanes';
import { Tournament, type Corpse } from '../../../haunt/src/tournament/tournament';
import { tierOfLane } from '../../../haunt/src/tournament/rounds';
import { tierById } from '../../../haunt/src/pipeline/pipeline';
import { roundScript } from './tournament-script';
import { CURSE_KINDS, CURSE_ENDPOINTS, curseTable, type CurseKind } from '../../../haunt/src/tournament/curses';
import { LessonsStore, lessonEvent, policyOf } from '../../../haunt/src/tournament/lessons';
import { laneCases } from '../../../haunt/src/tournament/signature';
import { buildCasebook, caseEvents } from '../../../haunt/src/tournament/casebook';
import { PatternStore, THRESHOLDS, costOf, minePatterns, patternEvent, qualifies } from '../../../haunt/src/miner/patterns';
import { lintSpecDir, writeFixSpec } from '../../../haunt/src/miner/specs';
import { improve as runImprove, type ImproveReport, type RunResult } from '../../../haunt/src/miner/improve';
import { join as joinPath } from 'node:path';

export const LIVE_HOST = '127.0.0.1';
export const LIVE_PORT = 7070;
export const RETAINED_EVENTS = 5000;
export const PING_MS = 15000;
const SPEEDS = [0.5, 1, 2, 4];

export interface ChaosRequest { lane?: number; creature?: string; fault: string; scope?: 'inner' | 'outer'; point?: string; detect?: 'confirmation' | 'handoff' }
export interface ChaosResult { chaosId: string; creature: string; fault: string; depth: number; deferred: boolean }
export interface WaveSettings { orders: number; seed: number; tiers: TierMode; lanes: number; speed: number; pace: 'normal' | 'show' | 'slow'; app: AppId; campaign?: CampaignRequest; tournament?: { round: number; lanes: number[]; level: number; script: unknown } }

/** What the runner provides. Every hook is optional so the server is usable (read-only) before the runner exists. */
export interface LiveEngine {
  startWave?(wave: number, settings: WaveSettings, record: (ev: HauntEvent) => void, end?: () => void): void;
  /** Events about the finished wave `prev` (hardening_spec, fix_applied, part_added), emitted before the next `wave_start` (PROTOCOL rule 26). */
  betweenWaves?(prev: number, next: number, settings: WaveSettings): HauntEvent[];
  stopWave?(): void;
  setSpeed?(speed: number): void;
  chaos?(req: ChaosRequest): ChaosResult;
  /** POST /api/decision: the user answered a wrong order. 
o_decision when nothing is pending for that order. */
  decide?(lane: number, order: string, choice: string): 'ok' | 'no_decision' | 'bad_choice';
  setChaosMode?(mode: ChaosMode): void;
  /** Intensity dial (TV3-C4). The engine owns the level; the server mirrors it for `state`. */
  /** Curses (TV3-C9): add one to a lane, end one, end all, give the live lanes theirs by level. */
  addCurse?(lane: number, kind: CurseKind, endpoint: string, source?: 'plan' | 'player'): { id: string; lane: number; kind: string; endpoint: string; rate?: number; delayMs?: number };
  endCurse?(lane: number, id: string): boolean;
  clearCurses?(): void;
  /** Events the engine publishes outside a wave (curse_start, curse_end). */
  bindEmit?(fn: (ev: HauntEvent) => void): void;
  assignCurses?(lanes: readonly number[], level: number, seed: string | number, round: number): unknown[];
  setIntensity?(level: number, opts?: { autoRamp?: boolean; everyN?: number; max?: number }): { level: number; autoRamp: boolean; everyN: number; max: number };
  getIntensity?(): { level: number; autoRamp: boolean; everyN: number; max: number };
  /** Property P19: lanes with no issue this wave. Empty means the never-perfect floor held. */
  assertFloor?(): string[];
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
  /** Where lessons are kept (`<lane>.json` and `lane-<lane>.policy.json`). Defaults to `.haunt/lessons` under the working folder. */
  lessonsDir?: string;
  /** Pattern store file. Defaults to `.haunt/patterns.json` under the working folder. */
  patternsFile?: string;
  /** Run folder of the bots (for journal evidence). Defaults to `.haunt` under the working folder. */
  runDir?: string;
  /** Where fix specs are written (`hardening-<runId>/`). Without it no spec is written by the server. */
  specsDir?: string;
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
  /** Intensity dial (V1_2 section 5): default level 3. Moved by POST /api/intensity and by auto-ramp. */
  intensity = { level: 3, autoRamp: false, everyN: 4, max: 11 };
  demoRunning: string | null = null;
  /** The running tournament (TV3-C7), if any. */
  tourney?: { t: Tournament; speed: number; pace: 'normal' | 'show' | 'slow'; wave: number; id: string; firstWave?: number; autoSpecs?: boolean };
  /** The improve loop (TV3-C13): one job at a time. */
  improveJob?: { id: string; phase: string; startedAt: number; request: Record<string, unknown>; report?: ImproveReport; error?: string; spec?: unknown };
  /** Casebook of the Crew lane for the last finished campaign night (GET /api/casebook when no tournament runs). */
  nightCasebook?: { night: number; wave: number } & ReturnType<typeof buildCasebook>;
  /** Corpses of the tournament, rebuilt from `corpse` events so a late page sees them (rule 51). */
  corpses: Corpse[] = [];
  /** Curses in force, rebuilt from `curse_start` and `curse_end` (state shows them to a late page). */
  curses: { id: string; lane: number; kind: string; endpoint: string; rate?: number; delayMs?: number; source?: string }[] = [];
  private chaosCount = 0;
  private readonly staticDir?: string;
  private readonly ledger: () => { lanes: unknown[] };
  private readonly pingMs: number;
  private readonly hardening: (wave: number) => HardeningBody | undefined;
  private tracker?: LapTracker;
  /** Lessons ledger and policy overlays (TV3-C8). */
  readonly lessons: LessonsStore;
  /** Patterns the miner keeps across runs and rounds (TV3-C11). */
  readonly patterns: PatternStore;
  protected readonly runDir: string;
  protected readonly specsDir?: string;
  private readonly clients = new Set<ServerResponse>();
  private http?: Server;

  constructor(opts: LiveOptions = {}) {
    this.log = opts.log ?? new EventLog();
    this.waves = new WaveManager(this.log);
    this.engine = opts.engine ?? {};
    this.engine.bindEmit?.((ev) => { this.log.emit({ ...ev, ...(this.waves.n > 0 ? { wave: this.waves.n } : {}) } as HauntEvent); });
    this.app = opts.app ?? 'orders';
    this.ledger = opts.ledger ?? (() => ({ lanes: [] }));
    this.pingMs = opts.pingMs ?? PING_MS;
    this.lessons = new LessonsStore(opts.lessonsDir ?? joinPath(process.cwd(), '.haunt', 'lessons'));
    this.patterns = new PatternStore(opts.patternsFile ?? joinPath(process.cwd(), '.haunt', 'patterns.json'));
    this.runDir = opts.runDir ?? joinPath(process.cwd(), '.haunt');
    this.specsDir = opts.specsDir;
    this.hardening = opts.hardening ?? (() => undefined);
    const dist = opts.staticDir ?? resolve(process.cwd(), 'packages', 'arena-ui', 'dist');
    this.staticDir = existsSync(dist) ? dist : undefined;
    this.log.subscribe((ev) => {
      applyEvent(this.lanes, ev, APP_STAGES[this.app]);
      if (ev.type === 'wave_end') this.demoRunning = null;
      if (ev.type === 'corpse') { const d = (ev.detail ?? {}) as any; this.corpses.push({ lane: Number(d.lane), stage: String(d.stage), kind: d.kind, round: Number(d.round), epitaph: String(d.epitaph ?? '') }); }
      if (ev.type === 'reset') { this.corpses = []; this.curses = []; }
      if (ev.type === 'curse_start') { const d = (ev.detail ?? {}) as any; this.curses.push({ id: d.id, lane: Number(ev.lane), kind: d.kind, endpoint: d.endpoint, ...(d.rate !== undefined ? { rate: d.rate } : {}), ...(d.delayMs !== undefined ? { delayMs: d.delayMs } : {}), ...(d.source ? { source: d.source } : {}) }); }
      if (ev.type === 'curse_end') { const d = (ev.detail ?? {}) as any; this.curses = this.curses.filter((c) => !(c.id === d.id && c.lane === Number(ev.lane))); }
      if (ev.type === 'intensity') {
        const d = (ev.detail ?? {}) as { level?: number; autoRamp?: boolean };
        if (typeof d.level === 'number') this.intensity = { ...this.intensity, level: d.level, ...(typeof d.autoRamp === 'boolean' ? { autoRamp: d.autoRamp } : {}) };
      }
      const line = `data: ${JSON.stringify(toWire(ev))}\n\n`;
      for (const c of this.clients) c.write(line);
    });
    this.log.emit({ type: 'reset', detail: {} });
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
      intensity: { ...this.intensity },
      corpses: [...this.corpses],
      curses: [...this.curses],
      ...(this.tourney ? { tournament: { round: this.tourney.t.round, total: this.tourney.t.total, phase: this.tourney.t.phase, alive: [...this.tourney.t.alive], ...(this.tourney.t.champion !== undefined ? { champion: this.tourney.t.champion } : {}) } } : {}),
      awaitingNext: this.tourney?.t.phase === 'awaiting_next',
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

  private startWave(body: Record<string, any>, tour?: { round: number; total: number; lanes: number[]; orders: number; seed: number; level: number; script: unknown; speed: number; pace: 'normal' | 'show' | 'slow' }) {
    if (this.waves.active) fail(409, 'wave_running', 'a wave is running');
    if (tour) body = { orders: tour.orders, seed: tour.seed, lanes: tour.lanes.length, speed: tour.speed, pace: tour.pace };
    const num = (k: string, def: number, ok: (n: number) => boolean) => {
      const v = body[k] ?? def;
      if (typeof v !== 'number' || !ok(v)) fail(400, 'bad_request', `bad ${k}`);
      return v as number;
    };
    let orders = num('orders', 12, (n) => Number.isInteger(n) && n >= 1 && n <= 200);
    let seed = num('seed', 7, Number.isInteger);
    let lanes = num('lanes', 5, (n) => Number.isInteger(n) && n >= 1 && n <= 5);
    const speed = num('speed', 1, (n) => SPEEDS.includes(n));
    let tiers = body.tiers ?? 'race';
    if (tiers !== 'race' && tiers !== 'allPhoenix') fail(400, 'bad_request', 'bad tiers');
    let pace = body.pace ?? 'slow';
    if (pace !== 'normal' && pace !== 'show' && pace !== 'slow') fail(400, 'bad_request', 'bad pace');
    let app = body.app ?? this.app;
    if (app !== 'orders' && app !== 'inbox') fail(400, 'bad_request', 'bad app');
    // Campaign night (CP-C2, additive): the night fixes orders, seed, pace, lanes and app. Lane 1 becomes the Crew.
    let campaign: CampaignRequest | undefined;
    let crew: CrewSpec | undefined;
    if (body.campaign !== undefined) {
      try {
        const nights = loadCampaign().nights;
        campaign = parseCampaignRequest(body.campaign, nights);
        const cfg = campaignWaveConfig(nights.find((n) => n.id === campaign!.night)!, campaign.parts, app);
        ({ orders, seed, pace, lanes, tiers, app, crew } = cfg);
      } catch (e) {
        fail(400, 'bad_request', e instanceof Error ? e.message : 'bad campaign');
      }
    }
    if (app !== this.app) this.switchApp(app);
    this.nightCasebook = undefined;

    const laneNos = tour ? tour.lanes : Array.from({ length: lanes }, (_, i) => i + 1);
    const defs = tour ? tour.lanes.map((n) => tierById(tierOfLane(n))) : tiersForLanes(lanes, tiers, crew);
    // Fallen lanes stay on the board as corpses until the tournament ends.
    const fallen = tour ? [...this.lanes.values()].filter((l) => l.fallen) : [];
    this.lanes.clear();
    for (const l of fallen) this.lanes.set(l.lane, l);
    const perLane: Record<string, number> = {};
    defs.forEach((t, i) => {
      this.lanes.set(laneNos[i], newLane(laneNos[i], t.id, t.label, t.use, orders));
      perLane[String(laneNos[i])] = orders;
    });
    const settings: WaveSettings = { orders, seed, tiers, lanes, speed, pace, app, ...(campaign ? { campaign } : {}), ...(tour ? { tournament: { round: tour.round, lanes: tour.lanes, level: tour.level, script: tour.script } } : {}) };
    const prev = this.waves.waves.at(-1)?.n ?? 0;
    if (prev > 0) for (const ev of this.engine.betweenWaves?.(prev, prev + 1, settings) ?? []) this.log.emit({ ...ev, wave: prev });
    const n = this.waves.start({ lanes: perLane, info: { orders, seed, tiers, lanes, speed, app, pace, ...(campaign ? { campaign } : {}) } });
    this.settings = { ...settings, startedAt: this.waves.waves.at(-1)!.startedAt };
    defs.forEach((t, i) => this.waves.record({ type: 'lane_ready', lane: String(laneNos[i]), detail: { tier: t.id, label: t.label, parts: [...t.use] } }));
    if (tour) this.waves.record({ type: 'round_start', detail: { round: tour.round, total: tour.total, lanes: tour.lanes, orders: tour.orders, intensity: tour.level, seed: this.tourney?.t.seed ?? tour.seed } } as HauntEvent);
    const tracker = new LapTracker({ app, pace: PACE_FACTOR[pace] ?? 1, speed });
    this.tracker = tracker;
    this.engine.startWave?.(n, settings, (ev) => { if (this.waves.active) for (const e of tracker.process(ev)) this.waves.record(e); }, () => { if (this.waves.active && this.waves.n === n) this.endWave(); });
    return { wave: n };
  }

  /** POST /api/tournament/start {lanes?, rounds?, seed?, speed?, pace?} (V1_2 section 2). Round 1 starts at once. */
  private startTournament(body: Record<string, any>) {
    if (this.waves.active) fail(409, 'wave_running', 'a wave is running');
    const seed = body.seed ?? 7;
    if (!Number.isInteger(seed)) fail(400, 'bad_request', 'bad seed');
    const speed = body.speed ?? 1;
    if (!SPEEDS.includes(speed)) fail(400, 'bad_request', 'bad speed');
    const pace = body.pace ?? 'slow';
    if (pace !== 'normal' && pace !== 'show' && pace !== 'slow') fail(400, 'bad_request', 'bad pace');
    if (body.lanes !== undefined && !(Number.isInteger(body.lanes) && body.lanes >= 2 && body.lanes <= 5)) fail(400, 'bad_request', 'lanes must be 2 to 5');
    let t: Tournament;
    try { t = new Tournament({ seed, rounds: body.rounds, lanes: body.lanes }); } catch (e) { return fail(400, 'bad_request', e instanceof Error ? e.message : 'bad rounds'); }
    if (this.app !== 'orders') this.switchApp('orders');
    this.lanes.clear();
    this.corpses = [];
    this.engine.setChaosMode?.({ mode: 'manual', frequency: 0.3, seed });
    this.chaosMode = { mode: 'manual', frequency: 0.3, seed };
    if (body.resetLessons === true) this.lessons.reset();
    this.engine.clearCurses?.();
    this.tourney = { t, speed, pace, wave: 0, id: 't' + Date.now().toString(36), firstWave: this.waves.n + 1, ...(body.autoSpecs === false ? { autoSpecs: false } : {}) };
    return { tournament: true, ...this.beginRound() };
  }

  private beginRound() {
    const tn = this.tourney!;
    const rs = tn.t.beginRound();
    // The plan curses the live lanes by the level's table (spec 5.1); curses already in force stay, also on corpses, until the tournament ends.
    this.engine.assignCurses?.(rs.lanes, rs.intensity, tn.t.seed, rs.round);
    // The overlay of every live lane is written before its bot starts: lessons carry into the round.
    for (const lane of rs.lanes) this.lessons.writePolicy(this.lessons.get(lane, tierOfLane(lane)));
    const cfg = tn.t.cfgOf(rs.round);
    const waveSeed = fnv1a32(String(tn.t.seed) + '|round' + rs.round) % 1_000_000;
    const script = roundScript(tn.t.seed, rs.round, cfg, rs.lanes, waveSeed);
    const r = this.startWave({}, { round: rs.round, total: rs.total, lanes: rs.lanes, orders: rs.orders, seed: waveSeed, level: rs.intensity, script, speed: tn.speed, pace: tn.pace });
    tn.wave = r.wave;
    return { round: rs.round, wave: r.wave, lanes: rs.lanes };
  }

  /** The wave of a tournament round ended: score it, drop a lane, publish round_end and awaiting_next (rule 49). */
  private finishTournamentRound(n: number) {
    const tn = this.tourney;
    if (!tn || tn.wave !== n || tn.t.phase !== 'running') return;
    const evs = waveEvents(this.log.events, n);
    const out = tn.t.finishRound(evs as never, this.roundExtras(tn.t, evs, n));
    const learned = ((out[0]?.detail?.lessons ?? []) as { lane: number; suggestion?: boolean; signature: string; stage: string; mechanism: string; via: 'overcame' | 'suggested'; learnedRound: number; action?: string }[]).filter((l) => !l.suggestion);
    const roundCases = (out[0]?.detail?.cases ?? []) as Parameters<typeof caseEvents>[0];
    out.forEach((e, i) => {
      this.log.emit({ ...(e as HauntEvent), wave: n });
      // `lesson` and `case` events follow round_end, before any lane is announced fallen.
      if (i === 0) {
        for (const l of learned) this.log.emit({ ...(lessonEvent(l.lane, l as never) as unknown as HauntEvent), wave: n });
        for (const c of caseEvents(roundCases)) this.log.emit({ ...(c as unknown as HauntEvent), wave: n });
      }
    });
    this.minePatterns(tn.id, tn.t.round, n, evs, evs.map((e) => Number(e.lane)).filter((l) => Number.isInteger(l)));
    if ((tn.t.phase as string) === 'done') {
      this.log.emit({ ...(tn.t.endEvent(this.finalExtras(tn.t)) as HauntEvent), wave: n });
      if (this.specsDir && tn.autoSpecs !== false && this.patterns.list().some((p) => qualifies(p) && (p.status === 'new'))) { try { this.writeSpecs(tn.id, n); } catch { /* a spec that cannot be written must not stop the tournament */ } }
    }
  }

  /** Mine the round's events into the pattern store and publish a `pattern` event for each qualifying pattern that changed (TV3-C11). */
  protected minePatterns(runId: string, round: number, wave: number, evs: HauntEvent[], lanes: number[]): void {
    const journals = [...new Set(lanes)].map((lane) => ({ lane, path: joinPath(this.runDir, 'wave-' + wave, 'lane-' + lane, 'journal.jsonl') }));
    const mined = minePatterns({ run: runId, round, events: evs as never, journals, reportLink: '/api/waves/' + wave + '/report' });
    for (const c of this.patterns.ingest(mined, runId + '#r' + round)) {
      if (qualifies(c.pattern)) this.log.emit({ ...(patternEvent(c.pattern, c.kind) as unknown as HauntEvent), wave });
    }
  }

  /**
   * Write the fix spec for the qualifying patterns that are still `new` (spec 8.2): `hardening-<runId>/` with requirements, design, tasks and
   * README, linted. Their status becomes `suggested`; a `spec_written` event follows. Nothing is applied.
   */
  writeSpecs(runId: string, wave?: number): { runId: string; path: string; patterns: string[]; refused: string[]; lint: { ok: boolean; issues: unknown[] } } {
    if (!this.specsDir) fail(409, 'not_applicable', 'no specs folder is configured');
    const todo = this.patterns.list().filter((p) => qualifies(p) && p.status === 'new');
    if (todo.length === 0) fail(409, 'not_ready', 'no qualifying pattern is waiting for a spec');
    const w = wave ?? this.waves.n;
    const out = writeFixSpec(this.specsDir!, { runId, patterns: todo, plan: this.tourney ? 'the tournament with seed ' + this.tourney.t.seed + ' and the same rounds' : 'the same plan and seed', reports: [...new Set(todo.flatMap((p) => p.evidence.map((e) => e.report).filter(Boolean) as string[]))] });
    const ids = out.included.map((p) => p.id);
    for (const p of this.patterns.setStatuses(ids, 'suggested')) this.log.emit({ ...(patternEvent(p, 'updated') as unknown as HauntEvent), wave: w });
    const result = { runId, path: '.kiro/specs/hardening-' + runId, patterns: ids, refused: out.refused.map((r) => r.pattern.signature), lint: { ok: out.lint.ok, issues: out.lint.issues } };
    this.log.emit({ type: 'spec_written', wave: w, detail: result } as unknown as HauntEvent);
    return result;
  }

  /**
   * POST /api/improve {seed?, rounds?, speed?, pace?} (TV3-C13): run the plan, mine, apply the cheap patterns as policy overlay, write a spec for the
   * rest, rerun the same plan and seed and compare. Answers at once; `GET /api/improve` follows the job. Never applies code.
   */
  /** POST /api/curse {lane, kind, endpoint} (V1_2 section 6): the player curses one endpoint of one lane. */
  private postCurse(body: Record<string, any>) {
    if (!Number.isInteger(body.lane) || body.lane < 1 || body.lane > 5) fail(400, 'bad_lane', 'lane must be 1 to 5');
    if (!(CURSE_KINDS as readonly string[]).includes(body.kind)) fail(400, 'bad_request', 'kind must be one of ' + CURSE_KINDS.join(', '));
    if (!(CURSE_ENDPOINTS as readonly string[]).includes(body.endpoint)) fail(400, 'bad_request', 'endpoint must be one of ' + CURSE_ENDPOINTS.join(', '));
    if (!this.engine.addCurse) fail(409, 'not_applicable', 'no engine is attached');
    const c = this.engine.addCurse!(body.lane, body.kind, body.endpoint, 'player');
    return { ...c };
  }

  private endCurse(body: Record<string, any>) {
    if (!Number.isInteger(body.lane) || typeof body.id !== 'string') fail(400, 'bad_request', 'lane and id are required');
    if (!this.engine.endCurse?.(body.lane, body.id)) fail(404, 'not_found', 'no such curse');
    return {};
  }

  private startImprove(body: Record<string, any>) {
    if (this.waves.active) fail(409, 'wave_running', 'a wave is running');
    if (this.improveJob && !['done', 'error'].includes(this.improveJob.phase)) fail(409, 'wave_running', 'an improve run is already going');
    const seed = body.seed ?? 7;
    const rounds = body.rounds;
    // Validate the request now (a bad plan is a 400, not a failed job).
    try { new Tournament({ seed, rounds }); } catch (e) { fail(400, 'bad_request', e instanceof Error ? e.message : 'bad rounds'); }
    if (!Number.isInteger(seed)) fail(400, 'bad_request', 'bad seed');
    const job = { id: 'imp-' + Date.now().toString(36), phase: 'before', startedAt: Date.now(), request: { seed, ...(rounds ? { rounds } : {}), speed: body.speed ?? 1, pace: body.pace ?? 'slow' } };
    this.improveJob = job;
    void this.improveRun(job, { seed, rounds, speed: body.speed ?? 1, pace: body.pace ?? 'slow' });
    return { improve: job.id, phase: job.phase };
  }

  private async improveRun(job: NonNullable<LiveServer['improveJob']>, plan: { seed: number; rounds?: unknown; speed: number; pace: string }): Promise<void> {
    const planText = 'the tournament with seed ' + plan.seed + (plan.rounds ? ' and the same rounds' : ' and the default rounds');
    const runPlan = (label: 'before' | 'after'): Promise<RunResult> => this.runTournamentToEnd({ ...plan, resetLessons: label === 'before', autoSpecs: false }, job.id + '-' + label);
    try {
      const report = await runImprove({
        runPlan, store: this.patterns, lessons: this.lessons, ...(this.specsDir ? { specsDir: this.specsDir } : {}), plan: planText, specRunId: job.id,
        onPhase: (p) => { job.phase = p; },
        onStatus: (p) => this.log.emit({ ...(patternEvent(p, 'updated') as unknown as HauntEvent), wave: this.waves.n }),
        onSpec: (s) => { this.log.emit({ type: 'spec_written', wave: this.waves.n, detail: s } as unknown as HauntEvent); job.spec = s; },
      });
      job.report = report;
      job.phase = 'done';
    } catch (e) {
      job.error = e instanceof Error ? e.message : String(e);
      job.phase = 'error';
    }
  }

  /** Run a whole tournament, pressing Next itself (the improve loop is the explicit "auto-continue"), and return what the loop needs to judge it. */
  private runTournamentToEnd(body: Record<string, any>, run: string): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      let first = 0;
      const unsub = this.log.subscribe((ev) => {
        if (ev.type === 'awaiting_next') setTimeout(() => { try { this.tournamentNext(); } catch (e) { unsub(); reject(e); } }, 0);
        if (ev.type === 'tournament_end') {
          unsub();
          setTimeout(() => {
            const last = ev.wave ?? this.waves.n;
            const evs = this.log.events.filter((e) => typeof e.wave === 'number' && e.wave >= first && e.wave <= last);
            const roundEnds = evs.filter((e) => e.type === 'round_end');
            const lanes = (e: HauntEvent) => (e.detail as { lanes?: number[] } | undefined)?.lanes ?? [];
            const orders = evs.filter((e) => e.type === 'round_start').reduce((n, e) => n + lanes(e).length * Number((e.detail as { orders?: number }).orders ?? 0), 0);
            const score = roundEnds.reduce((n, e) => n + ((e.detail as { standings?: { rp: number }[] }).standings ?? []).reduce((m, s) => m + s.rp, 0), 0);
            resolve({
              run, events: evs as never, orders, ok: evs.filter((e) => e.type === 'order_done').length, lost: evs.filter((e) => e.type === 'order_failed').length,
              repeats: evs.filter((e) => e.type === 'repeat').length, score, reports: [...new Set(evs.filter((e) => e.type === 'wave_end').map((e) => '/api/waves/' + e.wave + '/report'))].slice(0, 3),
            });
          }, 0);
        }
      });
      try {
        this.startTournament(body);
        first = this.tourney?.firstWave ?? this.waves.n;
      } catch (e) { unsub(); reject(e); }
    });
  }

  /** Hooks for lessons and the Casebook (TV3-C8, C10). */
  protected roundExtras(t: Tournament, evs: HauntEvent[], wave: number): Record<string, unknown> {
    const lessonsBonus: Record<number, number> = {};
    const lessons: unknown[] = [];
    const cases: ReturnType<typeof laneCases> = [];
    for (const lane of t.alive) {
      const tier = tierOfLane(lane);
      const mine = laneCases(evs as never, lane, t.round);
      cases.push(...mine);
      const r = this.lessons.learn(lane, tier, mine, t.round);
      lessonsBonus[lane] = 25 * r.firstOvercome.length;
      for (const l of r.newLessons) lessons.push({ lane, ...l });
      for (const s of r.newSuggestions) lessons.push({ lane, suggestion: true, ...s });
    }
    return { wave, lessonsBonus, lessons, cases, curseTable: curseTable(evs as never) };
  }
  protected finalExtras(t: Tournament): Record<string, unknown> {
    const first = this.tourney?.firstWave ?? 0;
    return { curseTable: curseTable(this.log.events.filter((e) => typeof e.wave === 'number' && e.wave >= first) as never) };
  }

  private tournamentNext() {
    const tn = this.tourney;
    if (!tn || tn.t.phase !== 'awaiting_next') fail(409, 'not_awaiting_next', 'no round is waiting for Next');
    return this.beginRound();
  }

  private endWave(stopped = false) {
    const t = this.tracker;
    const bad = new Set(this.engine.assertFloor?.() ?? []);
    const waveNo = this.waves.n;
    this.waves.end(stopped, t ? (lane, row) => ({ ...t.summary(lane), ...(bad.has(String(lane)) ? { floorOk: false } : {}), orders: { ...(t.summary(lane).orders as object), parked: row.parked } }) : undefined);
    if (this.tourney) { if (stopped) this.tourney = undefined; else this.finishTournamentRound(waveNo); }
    // A campaign night keeps the Casebook of the Crew lane, so the results screen can show what the night taught (GET /api/casebook with no tournament).
    const night = this.settings?.campaign?.night;
    if (night !== undefined && !stopped) this.nightCasebook = { night, wave: waveNo, ...buildCasebook(laneCases(waveEvents(this.log.events, waveNo) as never, 1, 1), 1) };
  }

  private switchApp(app: AppId) {
    if (this.waves.active) fail(409, 'wave_running', 'a wave is running');
    this.app = app;
    this.lanes.clear();
    this.log.emit({ type: 'reset', detail: {} });
  }

  /** POST /api/intensity {level 1..11, autoRamp?, everyN?, max?}. Emits `intensity {source: "player"}` (V1_2 section 5). */
  private setIntensity(body: Record<string, any>) {
    const level = body.level;
    if (!(typeof level === 'number' && Number.isInteger(level) && level >= 1 && level <= 11)) fail(400, 'bad_request', 'level must be an integer from 1 to 11');
    if (body.autoRamp !== undefined && typeof body.autoRamp !== 'boolean') fail(400, 'bad_request', 'autoRamp must be a boolean');
    if (body.everyN !== undefined && !(Number.isInteger(body.everyN) && body.everyN >= 1)) fail(400, 'bad_request', 'everyN must be a positive integer');
    const opts = { ...(body.autoRamp !== undefined ? { autoRamp: body.autoRamp as boolean } : {}), ...(body.everyN !== undefined ? { everyN: body.everyN as number } : {}), ...(body.max !== undefined ? { max: body.max as number } : {}) };
    const next = this.engine.setIntensity?.(level, opts) ?? { ...this.intensity, level, ...opts };
    this.intensity = { ...this.intensity, ...next };
    const wave = this.waves.n > 0 ? this.waves.n : undefined;
    this.log.emit({ type: 'intensity', ...(wave !== undefined ? { wave } : {}), detail: { level, source: 'player', autoRamp: this.intensity.autoRamp } } as HauntEvent);
    return { ...this.intensity };
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
    if (body.detect !== undefined) {
      if (body.detect !== 'confirmation' && body.detect !== 'handoff') fail(400, 'bad_request', 'detect must be confirmation or handoff');
      if (f === 'order_typo') req.detect = body.detect;
    }
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

  /** `POST /api/decision {lane, order, choice}` (V1_1 section 7): answers the wrong order the lane is waiting on. */
  private decision(body: Record<string, any>) {
    if (typeof body.lane !== 'number') fail(400, 'bad_lane', 'lane must be 1 to 5');
    const lane = this.laneOf(String(body.lane));
    if (typeof body.order !== 'string' || typeof body.choice !== 'string') fail(400, 'bad_request', 'order and choice are required');
    const order: string = body.order;
    const choice: string = body.choice;
    // Open decision: the last decision_needed of this order with no decision_made after it.
    let open: HauntEvent | undefined;
    for (const e of this.laneEvents(lane.lane)) {
      if (e.order !== order) continue;
      if (e.type === 'decision_needed') open = e;
      else if (e.type === 'decision_made') open = undefined;
    }
    if (!open) fail(409, 'no_decision', 'no decision is pending for that order');
    const options = ((open!.detail ?? {}) as { options?: string[] }).options ?? [];
    if (!options.includes(choice)) fail(400, 'bad_request', 'choice is not one of the options');
    const r = this.engine.decide?.(lane.lane, order, choice) ?? 'no_decision';
    if (r === 'bad_choice') fail(400, 'bad_request', 'choice is not one of the options');
    if (r !== 'ok') fail(409, 'no_decision', 'no decision is pending for that order');
    return {};
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
      if (p === '/api/campaign') return { json: loadCampaign() };
      if (p === '/api/apps') return { json: APPS };
      if (seg[0] === 'api' && seg[1] === 'demo' && seg[2] === 'captions' && seg.length === 4) {
        if (!(CAPTION_SCRIPTS as readonly string[]).includes(seg[3])) fail(404, 'not_found', 'unknown demo script');
        return { json: loadCaptions(seg[3]) };
      }
      if (p === '/api/ledger') return { json: this.ledger() };
      if (seg[0] === 'api' && seg[1] === 'lessons' && seg.length === 3) {
        const lane = Number(seg[2]);
        if (!Number.isInteger(lane) || lane < 1 || lane > 5) fail(400, 'bad_lane', 'bad lane ' + seg[2]);
        const l = this.lessons.get(lane, tierOfLane(lane));
        return { json: { ...l, policy: policyOf(l) } };
      }
      if (seg[0] === 'api' && seg[1] === 'specs' && seg.length === 3) {
        if (!this.specsDir || !/^hardening-[A-Za-z0-9._-]+$/.test(seg[2]!)) fail(404, 'not_found', 'no such spec');
        const dir = joinPath(this.specsDir!, seg[2]!);
        return { json: lintSpecDir(dir) };
      }
      if (p === '/api/curses') return { json: { curses: [...this.curses], table: curseTable(this.log.events as never), kinds: CURSE_KINDS, endpoints: CURSE_ENDPOINTS } };
      if (p === '/api/improve') {
        const j = this.improveJob;
        return { json: j ? { id: j.id, phase: j.phase, startedAt: j.startedAt, request: j.request, ...(j.report ? { report: j.report } : {}), ...(j.error ? { error: j.error } : {}), ...(j.spec ? { spec: j.spec } : {}) } : { phase: 'idle' } };
      }
      if (p === '/api/patterns') {
        const all = this.patterns.list().map((x) => ({ ...x, qualifies: qualifies(x), cost: costOf(x) })).sort((a, b) => b.cost - a.cost || a.signature.localeCompare(b.signature));
        return { json: { thresholds: THRESHOLDS, patterns: all, qualifying: all.filter((x) => x.qualifies).length } };
      }
      if (p === '/api/casebook') return { json: this.nightCasebook ? { ...this.nightCasebook, awards: [] } : this.tourney ? { ...this.tourney.t.casebook(), awards: this.tourney.t.awards() } : { rounds: 0, cases: [], open: [], awards: [], note: 'No tournament yet.' } };
      if (p === '/api/tournament') return { json: this.tourney ? { ...this.tourney.t.view(), wave: this.tourney.wave } : { phase: 'idle' } };
      if (p === '/api/waves') return { json: this.wavesView() };
      if (seg[0] === 'api' && seg[1] === 'waves' && seg.length >= 4) {
        this.waveRecord(seg[2]);
        if ((seg[3] === 'laps' || seg[3] === 'stars') && seg.length === 4) {
          const w = this.waveRecord(seg[2]);
          const tiers = new Map([...this.lanes.values()].map((l) => [l.lane, l.tier]));
          return { json: seg[3] === 'laps' ? waveLaps(waveEvents(this.log.events, w.n), tiers) : waveStars(waveEvents(this.log.events, w.n)) };
        }
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
      if (seg[0] === 'api' && seg[1] === 'lane' && seg[3] === 'order' && seg.length === 5) {
        const rec = orderRecord(this.log.events, this.laneOf(seg[2]).lane, decodeURIComponent(seg[4]!), this.waves.n);
        return rec ? { json: rec } : fail(404, 'not_found', `no order ${seg[4]} on lane ${seg[2]}`);
      }
      if (seg[0] === 'api' && seg[1] === 'lane' && seg[3] === 'laps' && seg.length === 4) return { json: laneLaps(this.log.events, this.laneOf(seg[2]).lane, this.waves.n) };
      if (seg[0] === 'api' && seg[1] === 'lane' && seg.length >= 4 && seg[3] === 'orders') return { json: this.laneOrders(this.laneOf(seg[2])) };
      if (seg[0] === 'api' && seg[1] === 'lane' && seg[3] === 'log' && seg.length === 4) return { json: this.laneLog(this.laneOf(seg[2]), q) };
      if (seg[0] === 'api' && seg[1] === 'lane' && seg[3] === 'stage' && seg[4]) return { json: this.stageInspector(this.laneOf(seg[2]), seg[4], q.get('order') ?? undefined) };
      return undefined;
    }
    if (method === 'DELETE' && p === '/api/lessons') { this.lessons.reset(); return { json: {} }; }
    if (method === 'DELETE' && p === '/api/patterns') { this.patterns.reset(); return { json: {} }; }
    if (method !== 'POST') return undefined;
    switch (p) {
      case '/api/wave/start': return { json: this.startWave(body) };
      case '/api/wave/stop':
        if (!this.waves.active) fail(409, 'no_wave', 'no wave is running');
        this.engine.stopWave?.();
        if (this.waves.active) this.endWave(true);
        return { json: {} };
      case '/api/speed': {
        if (!SPEEDS.includes(body.speed)) fail(400, 'bad_request', 'bad speed');
        if (this.settings) this.settings.speed = body.speed;
        this.engine.setSpeed?.(body.speed);
        return { json: { speed: body.speed } };
      }
      case '/api/chaos': return { json: this.chaos(body) };
      case '/api/chaos/mode': return { json: this.setChaosMode(body) };
      case '/api/intensity': return { json: this.setIntensity(body) };
      case '/api/specs': return { json: this.writeSpecs(typeof body.runId === 'string' && body.runId ? body.runId : (this.tourney?.id ?? 'run-' + Date.now().toString(36))) };
      case '/api/improve': return { json: this.startImprove(body) };
      case '/api/curse': return { json: this.postCurse(body) };
      case '/api/curse/end': return { json: this.endCurse(body) };
      case '/api/tournament/start': return { json: this.startTournament(body) };
      case '/api/next': return { json: this.tournamentNext() };
      case '/api/decision': return { json: this.decision(body) };
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
      res.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
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
    const replay = since === undefined ? [] : retained.filter((e) => e.seq > since);
    // On a replay the hello carries the cursor, not the head, so seq and ts stay monotonic across hello and the replayed events.
    const hello = replay.length > 0 ? { seq: since!, ts: replay[0]!.ts } : { seq: this.seq, ts: Date.now() };
    res.write(`data: ${JSON.stringify({ type: 'hello', contractVersion: CONTRACT_VERSION, mode: 'live', ...hello, app: this.app, stages: this.stages })}\n\n`);
    for (const e of replay) res.write(`data: ${JSON.stringify(toWire(e))}\n\n`);
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
