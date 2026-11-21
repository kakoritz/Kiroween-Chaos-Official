// Wire types for the arena client. Mirrors contract/PROTOCOL.md (contract v1).
// Kept local so the browser bundle has no dependency on other workspaces.

export const CONTRACT_VERSION = 1;

export type RunMode = 'mock' | 'live' | 'browser';

/** Event envelope. Unknown types and unknown fields must be ignored by consumers (rule 17). */
export interface ArenaEvent {
  seq: number;
  ts: number;
  type: string;
  wave?: number;
  lane?: number;
  order?: string;
  stage?: string;
  detail?: Record<string, any>;
  // hello only
  contractVersion?: number;
  mode?: string;
  app?: string;
  [extra: string]: unknown;
}

export interface StageInfo { id: string; label: string; icon: string; workAnimation: string }
export interface PartInfo { id: string; label: string; installed: boolean }

export interface LaneState {
  lane: number;
  tier: string;
  label: string;
  state: 'idle' | 'working' | 'recovering' | 'dead' | 'halted' | 'done';
  order: string | null;
  stage: string | null;
  stageIndex: number;
  orderIndex: number;
  ordersTotal: number;
  score: number;
  counts: { completed: number; failed: number; parked: number; quarantined: number; repeats: number };
  depth: number;
  parts: PartInfo[];
}

export interface ArenaState {
  contractVersion: number;
  mode: RunMode | string;
  app: string;
  wave: null | { n: number; running: boolean; seed: number; speed: number; orders: number; tiers: string; startedAt: number };
  chaos: { mode: 'off' | 'manual' | 'random'; frequency: number; seed: number };
  stages: StageInfo[];
  lanes: LaneState[];
  boss: { next: string | null; startsInMs: number | null; active: boolean };
  demo: { scripts: string[]; running: string | null };
}

export interface Health { ok?: boolean; mode: RunMode | string; contractVersion?: number; [extra: string]: unknown }

export interface Creature {
  id: string; label: string; family: string; sprite: string; causes: string[];
  boss: boolean; apps: string[]; description: string;
}

export interface AppInfo { id: string; label: string; stages: StageInfo[] | string[] }

export interface WaveOptions {
  orders?: number; seed?: number; tiers?: 'race' | 'allPhoenix'; lanes?: number;
  speed?: 0.5 | 1 | 2 | 4; pace?: 'normal' | 'show'; app?: string;
}
export interface ChaosOptions {
  lane?: number; creature?: string; fault?: string; scope?: 'inner' | 'outer'; point?: string;
}
export interface ChaosModeOptions { mode: 'off' | 'manual' | 'random'; frequency?: number; seed?: number }
export interface ChaosResult { chaosId: string; creature: string; fault: string; depth: number; deferred: boolean }

/** One caption of a demo captions track. `at` is a time offset (ms) or an event trigger. */
export interface Caption { at: { ms?: number; event?: string; lane?: number; stage?: string; order?: string; attempt?: number }; text: string; ms: number }
export type DemoScript = 'hero' | 'full' | 'loop' | (string & {});

export interface LogLine { seq: number; ts: number; level: 'info' | 'warn' | 'error' | 'good'; type: string; stage?: string; order?: string; text: string }
export interface WaveSummary { n: number; startedAt: number; endedAt?: number; grade?: string; grades?: Record<string, string>; score: number }

/** Error shape from the server and from window.__haunt: {code, message}. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

/** Every operation the arena needs. HTTP and in-page transports both implement this. */
export interface ArenaApi {
  getHealth(): Promise<Health>;
  getState(): Promise<ArenaState>;
  startWave(opts?: WaveOptions): Promise<{ wave: number }>;
  stopWave(): Promise<unknown>;
  setSpeed(speed: number): Promise<{ speed: number }>;
  chaos(opts?: ChaosOptions): Promise<ChaosResult>;
  setChaosMode(opts: ChaosModeOptions): Promise<unknown>;
  startDemo(script: DemoScript, speed?: number): Promise<unknown>;
  stopDemo(): Promise<unknown>;
  getCaptions?(script: DemoScript): Promise<Caption[]>;
  getCreatures(): Promise<Creature[]>;
  getApps(): Promise<AppInfo[]>;
  setApp(app: string): Promise<unknown>;
  getLaneStage(lane: number, stage: string, order?: string): Promise<any>;
  getLaneLog(lane: number, opts?: { order?: string; since?: number }): Promise<{ lines: LogLine[] }>;
  getLaneOrders(lane: number): Promise<any>;
  getLaneOrder(lane: number, order: string): Promise<any>;
  getLaneLaps(lane: number): Promise<any>;
  getWaveLaps(n: number): Promise<any>;
  getWaveStars(n: number): Promise<any>;
  decide(lane: number, order: string, choice: string): Promise<any>;
  getLedger(): Promise<any>;
  getWaves(): Promise<WaveSummary[]>;
  getReport(n: number): Promise<any>;
  getCompare(n: number, m: number): Promise<any>;
  getPostmortem(n: number): Promise<string>;
  getHardening(n: number): Promise<any>;
  subscribe(handlers: SubscribeHandlers, opts?: { since?: number }): Unsubscribe;
}

export type Unsubscribe = () => void;

export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'version_mismatch' | 'closed';

export interface SubscribeHandlers {
  onEvent(event: ArenaEvent): void;
  /** The server no longer holds events since `seq` (410). The client resubscribes without `since`; reload /api/state here. */
  onGone?(): void;
  onStatus?(status: ConnectionStatus): void;
}
