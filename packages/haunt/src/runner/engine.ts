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
import { OUTAGE_FAULTS, drawOutageMs, initialDial, isLevel, type DialState, type FuzzFault } from './intensity';

export interface EngineChaosRequest { lane?: number; creature?: string; fault: string; scope?: 'inner' | 'outer'; point?: string; forMs?: number; detect?: 'confirmation' | 'handoff'; source?: 'manual' | 'random' | 'boss' | 'fuzz' | 'gremlin'; fuzz?: FuzzFault; count?: number }
export interface EngineChaosResult { chaosId: string; creature: string; fault: string; depth: number; deferred: boolean }
export interface EngineWaveSettings { orders: number; seed: number; tiers: TierMode; lanes: number; speed: number; pace: 'normal' | 'show' | 'slow'; app: string; campaign?: { night: number; parts: readonly Part[] } }
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

  startWave = (wave: number, settings: EngineWaveSettings, record: (ev: HauntEvent) => void): void => {
    this.wave = wave;
    this.seed = settings.seed;
    this.record = record;
    this.speed = settings.speed;
    this.seq = 0;
    this.rampOrders.clear();
    const tiers = tiersForLanes(settings.lanes, settings.tiers, settings.campaign ? { parts: settings.campaign.parts } : undefined);
    this.lanes = tiers.map((_, i) => String(i + 1));
    tiers.forEach((t, i) => this.director.addLane(String(i + 1), t.use));
    this.floor.reset(this.lanes);
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

  chaos = (req: EngineChaosRequest): EngineChaosResult => {
    const lane = String(req.lane ?? this.lanes[0] ?? '1');
    if (!this.lanes.includes(lane)) throw new Error(`lane ${lane} is not in the current wave`);
    const info = this.opts.laneInfo?.(lane) ?? { state: 'working' as const, stage: null };
    const nextId = `c${this.wave}-${this.seq + 1}`;
    // Outage timer (spec 5.4): unless the press fixes its window, draw it from the dial level. The window is 1x ms; real ms is divided by speed.
    const fz = req.fuzz;
    const fixedMs = fz?.forMs !== undefined ? Math.max(50, Math.round(fz.forMs / (this.speed || 1))) : req.forMs;
    const outageMs = fixedMs === undefined && OUTAGE_FAULTS.has(req.fault) ? drawOutageMs(this.seed, lane, nextId, this.level) : undefined;
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
    this.record?.({ type: 'chaos', lane, detail: { id: chaosId, creature, ...(req.source ? { source: req.source } : {}), ...r.detail, ...(gremlin ? { fault: 'gremlin', variant: req.fault } : {}),
      ...(fz ? { unknown: true, fingerprint: fz.fingerprint, fuzz: { fault: fz.fault, ...(fz.status !== undefined ? { status: fz.status } : {}), ...(fz.forMs !== undefined ? { forMs: fz.forMs } : {}), ...(fz.count !== undefined ? { count: fz.count } : {}), ...(fz.truncated ? { truncated: true } : {}), ...(fz.clockJumpMs !== undefined ? { clockJumpMs: fz.clockJumpMs } : {}) } } : {}) } });
    if (outageMs !== undefined) {
      const stage = r.detail.deferredTo ?? info.stage;
      this.record?.({ type: 'outage', lane, ...(stage ? { stage } : {}), detail: { outageMs, seed: this.seed, fault: req.fault, level: this.level } });
    }
    if (r.arm) this.opts.sendArm?.(lane, { k: 'arm', id: String(r.id), ...r.arm });
    if (r.provider && this.opts.post) void postProviderArm(this.opts.post, lane, info.stage, r.provider as ProviderArm);
    return { chaosId, creature, fault: r.detail.fault, depth: r.detail.depth, deferred: r.detail.deferred === true };
  };
}
