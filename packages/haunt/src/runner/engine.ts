// Engine wiring: the object the live server calls (startWave, chaos, setSpeed, setChaosMode, stopWave) bound to the
// chaos director, the lane tiers and the provider fault poster. Structurally matches `LiveEngine` in core/live/server.ts.
// Spec: runtime.md sections 4, 7, 18. Process spawning per lane (runLane) is attached by the caller via `onWaveStart`.
import { ChaosDirector, type LaneInfo, type ProviderArm } from '../chaos/director';
import { FAULTS } from '../chaos/catalog';
import type { HauntEvent } from '../score/score';
import type { Part } from '../sdk';
import { tiersForLanes, type TierMode } from './lanes';
import { postProviderArm, type PostFault } from './provider';
import { DEFAULT_LEVEL, OUTAGE_FAULTS, drawOutageMs } from './intensity';

export interface EngineChaosRequest { lane?: number; creature?: string; fault: string; scope?: 'inner' | 'outer'; point?: string; forMs?: number; detect?: 'confirmation' | 'handoff'; source?: 'manual' | 'random' | 'boss' }
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
  /** Dial level, default 3. The outage length of an `endpoint_down` or service-down press is drawn from it. */
  level = DEFAULT_LEVEL;

  constructor(private readonly opts: RunnerEngineOptions = {}) {
    this.director = opts.director ?? new ChaosDirector();
  }

  startWave = (wave: number, settings: EngineWaveSettings, record: (ev: HauntEvent) => void): void => {
    this.wave = wave;
    this.seed = settings.seed;
    this.record = record;
    this.speed = settings.speed;
    this.seq = 0;
    const tiers = tiersForLanes(settings.lanes, settings.tiers, settings.campaign ? { parts: settings.campaign.parts } : undefined);
    this.lanes = tiers.map((_, i) => String(i + 1));
    tiers.forEach((t, i) => this.director.addLane(String(i + 1), t.use));
    this.opts.onWaveStart?.(wave, settings, this.lanes);
  };

  stopWave = (): void => {
    this.record = undefined;
    this.opts.onWaveStop?.();
  };

  setSpeed = (speed: number): void => { this.speed = speed; };

  setChaosMode = (mode: EngineChaosMode): void => { this.chaosMode = mode; };

  chaos = (req: EngineChaosRequest): EngineChaosResult => {
    const lane = String(req.lane ?? this.lanes[0] ?? '1');
    if (!this.lanes.includes(lane)) throw new Error(`lane ${lane} is not in the current wave`);
    const info = this.opts.laneInfo?.(lane) ?? { state: 'working' as const, stage: null };
    const nextId = `c${this.wave}-${this.seq + 1}`;
    // Outage timer (spec 5.4): unless the press fixes its window, draw it from the dial level. The window is 1x ms; real ms is divided by speed.
    const outageMs = req.forMs === undefined && OUTAGE_FAULTS.has(req.fault) ? drawOutageMs(this.seed, lane, nextId, this.level) : undefined;
    const forMs = outageMs !== undefined ? Math.max(50, Math.round(outageMs / (this.speed || 1))) : req.forMs;
    const r = this.director.arm(lane, { fault: req.fault, scope: req.scope, point: req.point as never, forMs, detect: req.detect }, info);
    if (!r.ok) throw new Error(r.error);
    const chaosId = nextId;
    this.seq++;
    const creature = req.creature ?? FAULTS.find((f) => f.id === req.fault)?.creature ?? req.fault;
    this.record?.({ type: 'chaos', lane, detail: { id: chaosId, creature, ...(req.source ? { source: req.source } : {}), ...r.detail } });
    if (outageMs !== undefined) {
      const stage = r.detail.deferredTo ?? info.stage;
      this.record?.({ type: 'outage', lane, ...(stage ? { stage } : {}), detail: { outageMs, seed: this.seed, fault: req.fault, level: this.level } });
    }
    if (r.arm) this.opts.sendArm?.(lane, { k: 'arm', id: String(r.id), ...r.arm });
    if (r.provider && this.opts.post) void postProviderArm(this.opts.post, lane, info.stage, r.provider as ProviderArm);
    return { chaosId, creature, fault: r.detail.fault, depth: r.detail.depth, deferred: r.detail.deferred === true };
  };
}
