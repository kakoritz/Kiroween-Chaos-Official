// Engine wiring: the object the live server calls (startWave, chaos, setSpeed, setChaosMode, stopWave) bound to the
// chaos director, the lane tiers and the provider fault poster. Structurally matches `LiveEngine` in core/live/server.ts.
// Spec: runtime.md sections 4, 7, 18. Process spawning per lane (runLane) is attached by the caller via `onWaveStart`.
import { ChaosDirector, type LaneInfo, type ProviderArm } from '../chaos/director';
import { FAULTS } from '../chaos/catalog';
import type { HauntEvent } from '../score/score';
import type { Part } from '../sdk';
import { tiersForLanes, type TierMode } from './lanes';
import { postProviderArm, type PostFault } from './provider';
import { IssueFloor, gremlinVariant } from './floor';
import { CURSE_KINDS, classifyHit, drawCurse, stageOfCall, type CurseKind, type CurseRec, type OrderTrace } from '../tournament/curses';
import { unit } from '../shared/rng';
import { APPS, type AppId } from '../shared/catalog';

/** What the provider tells the engine when a curse lied (see `CurseHit` in the provider). */
export interface ProviderCurseHit { lane: string; service: string; order: string; index?: number; curse: CurseKind; id: string; status: number }
type CurseHit = ProviderCurseHit;
import { tierOfLane } from '../tournament/rounds';
import { tierById } from '../pipeline/pipeline';
import { OUTAGE_FAULTS, drawOutageMs, initialDial, intensityRow, isLevel, type DialState, type FuzzFault } from './intensity';

/** Transit stalls that carry an outage window and a countdown ring. */
const TRANSIT_WINDOW: ReadonlySet<string> = new Set(['weather', 'road_hazard', 'delay', 'out_of_gas', 'not_on_truck', 'wrong_address']);

export interface EngineChaosRequest { lane?: number; creature?: string; fault: string; scope?: 'inner' | 'outer'; point?: string; forMs?: number; detect?: 'confirmation' | 'process' | 'transit' | 'handoff'; source?: 'manual' | 'random' | 'boss' | 'fuzz' | 'gremlin' | 'demo'; fuzz?: FuzzFault; count?: number; outageMs?: number }
export interface EngineChaosResult { chaosId: string; creature: string; fault: string; depth: number; deferred: boolean }
/** A tournament round (TV3-C7): the live lanes are the survivors, lane n runs tier n, and `script` is the one storm every lane meets. */
export interface EngineTournament { round: number; lanes: number[]; level: number; script: unknown }
export interface EngineWaveSettings { orders: number; seed: number; tiers: TierMode; lanes: number; speed: number; pace: 'normal' | 'show' | 'slow'; app: string; campaign?: { night: number; parts: readonly Part[] }; tournament?: EngineTournament }
export interface EngineChaosMode { mode: 'off' | 'manual' | 'random'; frequency: number; seed: number }

export interface RunnerEngineOptions {
  director?: ChaosDirector;
  /** Live state of a lane, as seen by the runner loop. Defaults to a lane that is working with no stage. */
  laneInfo?: (lane: string) => LaneInfo;
  /** POST to the provider's /_fault. Omit to skip provider faults. */
  post?: PostFault;
  /** Send a crash arm to the lane's running bot over stdin (runtime.md section 2). Omit and arms only reach the next `go`. */
  sendArm?: (lane: string, arm: { k: 'arm' } & Record<string, unknown>) => void;
  /** Called after lanes are registered, so the caller can start `runLane` for each. */
  onWaveStart?: (wave: number, settings: EngineWaveSettings, lanes: string[]) => void;
  onWaveStop?: () => void;
}

export class RunnerEngine {
  readonly director: ChaosDirector;
  speed = 1;
  chaosMode: EngineChaosMode = { mode: 'manual', frequency: 0.3, seed: 7 };
  lanes: string[] = [];
  private record?: (ev: HauntEvent) => void;
  private wave = 0;
  private seq = 0;
  private seed: number | string = 7;
  /** The intensity dial (spec 5.1): level 1 to 11, default 3, optional auto-ramp. */
  dial: DialState = initialDial();
  /** True once the dial was set: the random plan then follows the level table instead of the chaos-mode frequency. */
  dialTouched = false;
  private rampOrders = new Set<string>();
  /** Per-lane issue counter for the never-perfect floor (spec 5.3). */
  readonly floor = new IssueFloor();
  /** The outage length of an `endpoint_down` or service-down press is drawn from the dial level. */
  get level(): number { return this.dial.level; }
  set level(n: number) { this.dial.level = n; this.dialTouched = true; }

  constructor(private readonly opts: RunnerEngineOptions = {}) {
    this.director = opts.director ?? new ChaosDirector();
  }

  private appStages = new Set<string>();
  private appId: AppId = 'orders';

  startWave = (wave: number, settings: EngineWaveSettings, record: (ev: HauntEvent) => void): void => {
    this.wave = wave;
    this.seed = settings.seed;
    this.appId = settings.app in APPS ? (settings.app as AppId) : 'orders';
    this.appStages = new Set((APPS[settings.app as keyof typeof APPS] ?? APPS.orders).stages.map((d) => d.id));
    this.record = record;
    this.speed = settings.speed;
    this.seq = 0;
    this.rampOrders.clear();
    if (settings.tournament) {
      this.lanes = settings.tournament.lanes.map(String);
      for (const l of settings.tournament.lanes) this.director.addLane(String(l), tierById(tierOfLane(l)).use);
    } else {
      const tiers = tiersForLanes(settings.lanes, settings.tiers, settings.campaign ? { parts: settings.campaign.parts } : undefined);
      this.lanes = tiers.map((_, i) => String(i + 1));
      tiers.forEach((t, i) => this.director.addLane(String(i + 1), t.use));
    }
    this.floor.reset(this.lanes);
    this.hits.clear(); this.trace.clear(); this.curOrder.clear();
    // The provider may be new: tell it again which curses are in force.
    for (const lane of this.curses.keys()) this.postCurses(lane);
    this.opts.onWaveStart?.(wave, settings, this.lanes);
  };

  stopWave = (): void => {
    this.record = undefined;
    this.opts.onWaveStop?.();
  };

  setSpeed = (speed: number): void => { this.speed = speed; };

  setChaosMode = (mode: EngineChaosMode): void => { this.chaosMode = mode; };

  /** Move the dial (spec 5.1). Takes effect for faults pressed from now on, so it scales orders not yet started. Throws on a bad level. */
  setIntensity = (level: number, opts: { autoRamp?: boolean; everyN?: number; max?: number } = {}): DialState => {
    if (!isLevel(level)) throw new Error(`bad intensity level ${level}`);
    this.dial = {
      level,
      autoRamp: opts.autoRamp ?? this.dial.autoRamp,
      everyN: Number.isInteger(opts.everyN) && opts.everyN! > 0 ? opts.everyN! : this.dial.everyN,
      max: isLevel(opts.max) ? opts.max : this.dial.max,
    };
    this.dialTouched = true;
    this.rampOrders.clear();
    return { ...this.dial };
  };

  getIntensity = (): DialState => ({ ...this.dial });

  /**
   * Feed every recorded event. Auto-ramp counts finished orders (once per order id across lanes) and raises the level by one
   * every `everyN` of them until `max`, emitting `intensity {source: "ramp"}`.
   */
  observe = (ev: HauntEvent): void => {
    this.floor.observe(ev);
    this.observeCurses(ev);
    if (!this.dial.autoRamp || !ev.order) return;
    if (ev.type !== 'order_done' && ev.type !== 'order_failed' && ev.type !== 'order_quarantined') return;
    this.rampOrders.add(String(ev.order));
    if (this.rampOrders.size % this.dial.everyN !== 0 || this.dial.level >= this.dial.max) return;
    this.dial = { ...this.dial, level: this.dial.level + 1 };
    this.record?.({ type: 'intensity', detail: { level: this.dial.level, source: 'ramp', autoRamp: true } });
  };

  /**
   * Floor rule (spec 5.3): inject the lane's gremlin, a mild known fault with a call count of one (slow call, one 500 or a duplicate
   * delivery, seeded by wave and lane). The chaos event reads `fault: "gremlin"`, `creature: "gremlin"`, `source: "gremlin"` with the
   * known fault as `variant`. Returns the variant.
   */
  gremlin = (lane: string): string => {
    const variant = gremlinVariant(this.seed, lane, this.wave);
    this.chaos({ lane: Number(lane), fault: variant, source: 'gremlin', creature: 'gremlin', count: 1 });
    this.floor.markGremlin(lane); // only once it landed: a lane at its depth limit is tried again on the next tick
    return variant;
  };

  /** The engine's assertion of property P19: lanes that have no issue yet. Empty means the floor holds. */
  assertFloor = (): string[] => this.floor.violations();


  // ---------------------------------------------------------------------------------------------------- curses (spec 5.2, TV3-C9)

  /** Curses by lane. They persist across rounds until the plan or the player ends them; a corpse keeps its tag. */
  readonly curses = new Map<number, CurseRec[]>();
  private curseSeq = 0;
  private readonly hits = new Map<string, CurseHit[]>();
  /** What each order did, by lane and order id. The ledger's `effect` events can reach the log before the bot's own `order_start`, so a trace is made by whichever comes first. */
  private readonly trace = new Map<string, Map<string, OrderTrace>>();
  private traceOf(lane: string, order: string): OrderTrace {
    let m = this.trace.get(lane);
    if (!m) this.trace.set(lane, (m = new Map()));
    let t = m.get(order);
    if (!t) m.set(order, (t = { order, effects: [], failed: false, died: false }));
    return t;
  }
  private readonly curOrder = new Map<string, string>();

  /** Where `curse_start` and `curse_end` go: a curse can be put on between waves, so they do not wait for a wave's record callback. */
  private outside?: (ev: HauntEvent) => void;
  bindEmit = (fn: (ev: HauntEvent) => void): void => { this.outside = fn; };
  private emitOutside(ev: HauntEvent): void { (this.outside ?? this.record)?.(ev); }

  private postCurses(lane: number): void {
    const list = (this.curses.get(lane) ?? []).map((c) => ({ id: c.id, kind: c.kind, service: c.endpoint, ...(c.rate !== undefined ? { rate: c.rate } : {}), ...(c.delayMs !== undefined ? { delayMs: c.delayMs } : {}) }));
    void this.opts.post?.({ lane: String(lane), service: '*', mode: 'curse', curses: list } as never);
  }

  /** Put a curse on one endpoint of one lane. Emits `curse_start`. */
  addCurse = (lane: number, kind: CurseKind, endpoint: string, source: 'plan' | 'player' = 'player'): CurseRec => {
    const d = drawCurse(this.seed, lane, ++this.curseSeq, kind, endpoint);
    const rec: CurseRec = { id: `cu-${this.wave}-${this.curseSeq}`, lane, kind, endpoint, ...(d.rate !== undefined ? { rate: d.rate } : {}), ...(d.delayMs !== undefined ? { delayMs: d.delayMs } : {}), source };
    this.curses.set(lane, [...(this.curses.get(lane) ?? []), rec]);
    this.postCurses(lane);
    this.emitOutside({ type: 'curse_start', lane: String(lane), detail: { id: rec.id, kind, endpoint, ...(rec.rate !== undefined ? { rate: rec.rate } : {}), ...(rec.delayMs !== undefined ? { delayMs: rec.delayMs } : {}), source } } as HauntEvent);
    return rec;
  };

  endCurse = (lane: number, id: string): boolean => {
    const list = this.curses.get(lane) ?? [];
    if (!list.some((c) => c.id === id)) return false;
    this.curses.set(lane, list.filter((c) => c.id !== id));
    this.postCurses(lane);
    this.emitOutside({ type: 'curse_end', lane: String(lane), detail: { id } } as HauntEvent);
    return true;
  };

  clearCurses = (): void => { for (const [lane, list] of [...this.curses]) for (const c of list) this.endCurse(lane, c.id); };

  /** The plan gives each live lane as many curses as the level allows (table of spec 5.1), seeded and without repeating a kind. Existing curses stay. */
  assignCurses = (lanes: readonly number[], level: number, seed: string | number, round: number): CurseRec[] => {
    const want = Math.min(CURSE_KINDS.length, intensityRow(level).curses);
    const added: CurseRec[] = [];
    for (const lane of lanes) {
      while ((this.curses.get(lane) ?? []).length < want) {
        const have = new Set((this.curses.get(lane) ?? []).map((c) => c.kind));
        const left = CURSE_KINDS.filter((k) => !have.has(k));
        const n = round * 10 + (this.curses.get(lane) ?? []).length;
        const kind = left[Math.floor(unit(seed, 'curse-pick', lane, n) * left.length)]!;
        const d = drawCurse(seed, lane, n, kind);
        added.push(this.addCurse(lane, kind, d.endpoint, 'plan'));
      }
    }
    return added;
  };

  /** The provider says a curse lied on a call. */
  noteCurse = (h: ProviderCurseHit): void => {
    const lane = h.lane;
    const order = /^ord-/.test(h.order) ? h.order : (this.curOrder.get(lane) ?? h.order);
    this.hits.set(lane, [...(this.hits.get(lane) ?? []), { ...h, order }]);
  };

  private observeCurses(ev: HauntEvent): void {
    if (ev.lane === undefined) return;
    const lane = String(ev.lane);
    const d = (ev.detail ?? {}) as Record<string, any>;
    switch (ev.type) {
      case 'order_start': this.curOrder.set(lane, String(ev.order)); this.traceOf(lane, String(ev.order)); return;
      case 'effect': if (ev.order !== undefined) this.traceOf(lane, String(ev.order)).effects.push({ kind: String(d.kind), key: String(d.key) }); return;
      case 'stage_fail': { const o = ev.order !== undefined ? String(ev.order) : this.curOrder.get(lane); if (o) this.traceOf(lane, o).failed = true; return; }
      case 'process_dead': { const o = this.curOrder.get(lane); if (o && (this.hits.get(lane) ?? []).some((h) => h.order === o)) this.traceOf(lane, o).died = true; return; }
      case 'order_done': case 'order_failed': case 'order_parked': case 'order_quarantined': case 'lane_halted': break;
      default: return;
    }
    const endOrder = ev.order !== undefined ? String(ev.order) : this.curOrder.get(lane);
    const t = endOrder ? this.traceOf(lane, endOrder) : undefined;
    const mine = (this.hits.get(lane) ?? []).filter((h) => (t ? h.order === t.order : true));
    if (t) this.trace.get(lane)?.delete(t.order);
    if (mine.length === 0 || !t) return;
    this.hits.set(lane, (this.hits.get(lane) ?? []).filter((h) => !mine.includes(h)));
    const seen = new Set<string>();
    for (const h of mine) {
      const stage = stageOfCall(h.service, h.index, this.appId);
      const key = `${stage}|${h.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const cls = classifyHit(ev.type as never, t, h.service, h.index, this.appId);
      this.record?.({ type: 'curse_response', lane, order: t.order, stage, detail: { order: t.order, stage, curse: h.curse, class: cls, id: h.id, endpoint: h.service, status: h.status } } as HauntEvent);
    }
  }

  chaos = (req: EngineChaosRequest): EngineChaosResult => {
    const lane = String(req.lane ?? this.lanes[0] ?? '1');
    if (!this.lanes.includes(lane)) throw new Error(`lane ${lane} is not in the current wave`);
    const info = this.opts.laneInfo?.(lane) ?? { state: 'working' as const, stage: null };
    const nextId = `c${this.wave}-${this.seq + 1}`;
    // Outage timer (spec 5.4): unless the press fixes its window, draw it from the dial level. The window is 1x ms; real ms is divided by speed.
    const fz = req.fuzz;
    const fixedMs = fz?.forMs !== undefined ? Math.max(50, Math.round(fz.forMs / (this.speed || 1))) : req.forMs;
    // Transit faults (V1_2 section 4) keep their tuned window (the bot's poll and backoff are timed against it) but show the same countdown ring.
    const transitMs = fixedMs === undefined && TRANSIT_WINDOW.has(req.fault) ? FAULTS.find((f) => f.id === req.fault)?.forMs : undefined;
    const outageMs = req.outageMs !== undefined ? req.outageMs : transitMs !== undefined ? transitMs : fixedMs === undefined && OUTAGE_FAULTS.has(req.fault) ? drawOutageMs(this.seed, lane, nextId, this.level) : undefined;
    const forMs = outageMs !== undefined ? Math.max(50, Math.round(outageMs / (this.speed || 1))) : fixedMs;
    const r = this.director.arm(lane, {
      fault: req.fault, scope: req.scope, point: req.point as never, forMs, detect: req.detect,
      ...(fz?.status !== undefined ? { status: fz.status } : {}), ...(fz?.truncated ? { truncated: true } : {}),
      ...(fz?.clockJumpMs !== undefined ? { clockJumpMs: fz.clockJumpMs } : {}), ...((fz?.count ?? req.count) !== undefined ? { count: fz?.count ?? req.count } : {}),
    }, info);
    if (!r.ok) throw new Error(r.error);
    const chaosId = nextId;
    this.seq++;
    const creature = req.creature ?? FAULTS.find((f) => f.id === req.fault)?.creature ?? req.fault;
    const gremlin = req.source === 'gremlin';
    this.record?.({ type: 'chaos', lane, detail: { id: chaosId, creature, source: req.source === undefined || req.source === 'manual' ? 'user' : req.source, ...r.detail, ...(gremlin ? { fault: 'gremlin', variant: req.fault } : {}),
      ...(fz ? { unknown: true, fingerprint: fz.fingerprint, fuzz: { fault: fz.fault, ...(fz.status !== undefined ? { status: fz.status } : {}), ...(fz.forMs !== undefined ? { forMs: fz.forMs } : {}), ...(fz.count !== undefined ? { count: fz.count } : {}), ...(fz.truncated ? { truncated: true } : {}), ...(fz.clockJumpMs !== undefined ? { clockJumpMs: fz.clockJumpMs } : {}) } } : {}) } });
    if (outageMs !== undefined) {
      // A transit or updates stall deferred to a stage the running app does not have (the inbox) names no stage: the outage window still shows.
      const wanted = r.detail.deferredTo ?? info.stage;
      const stage = wanted && this.appStages.has(wanted) ? wanted : undefined;
      this.record?.({ type: 'outage', lane, ...(stage ? { stage } : {}), detail: { outageMs, seed: this.seed, fault: req.fault, level: this.level } });
    }
    if (r.arm) this.opts.sendArm?.(lane, { k: 'arm', id: String(r.id), ...r.arm });
    if (r.provider && this.opts.post) void postProviderArm(this.opts.post, lane, info.stage, r.provider as ProviderArm);
    return { chaosId, creature, fault: r.detail.fault, depth: r.detail.depth, deferred: r.detail.deferred === true };
  };
}
