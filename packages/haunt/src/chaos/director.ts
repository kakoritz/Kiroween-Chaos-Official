// Chaos director: per-lane fault stack, nesting, deferral, depth limit, bosses, restart delays.
// Spec: design.md section 5 (Nesting, Crash points); runtime.md sections 3, 19, 29.
import type { HookPoint, Part } from '../sdk/sdk';
import {
  BOSSES, JOURNALED_EFFECT_STAGES, MAX_DEPTH, faultById, injectedAtFor, nextApplicableStage, restartDelay,
  type BossId, type FaultDef, type InjectedAt,
} from './catalog';
import { innerPoints, matchesHook, type ArmMsg } from './hooks';

export type Scope = 'inner' | 'outer';
export type LaneState = 'idle' | 'working' | 'recovering' | 'dead';

export interface LaneInfo {
  state: LaneState;
  /** Stage in flight, or null between orders. */
  stage: string | null;
}

export interface ArmRequest {
  fault: string;
  point?: HookPoint;
  scope?: Scope;
  /** Overrides the catalog window (the Banshee Queen's 12000 ms). */
  forMs?: number;
  /** order_typo: where the wrong order is found, `confirmation` (default) or `handoff`. */
  detect?: 'confirmation' | 'process' | 'transit' | 'handoff';
  /** Fuzz faults (TV3-C4): an odd HTTP status, a truncated body, a clock jump, a call count that replace the catalog defaults. */
  status?: number;
  truncated?: boolean;
  clockJumpMs?: number;
  count?: number;
}

/** The `chaos` event detail. It is emitted at the press, never at the kill. */
export interface ChaosDetail {
  fault: string;
  scope: Scope;
  depth: number;
  injectedAt: InjectedAt;
  point?: HookPoint;
  deferred?: boolean;
  /** Stage a deferred fault waits for. */
  deferredTo?: string;
}

export type ArmResult =
  | { ok: true; id: number; detail: ChaosDetail; arm: ArmMsg | null; provider: ProviderArm | null }
  | { ok: false; status: 409; error: 'depth_limit' }
  | { ok: false; status: 400; error: 'unknown_fault' | 'bad_point' };

/** What the runner POSTs to the provider's `/_fault` (provider, file and disk faults). */
export interface ProviderArm {
  id: number;
  fault: string;
  forMs?: number;
  count?: number;
  nextCaller?: 'recovery';
  /** order_typo: the order whose file was swapped, and the stage that finds it (default confirmation). */
  order?: string;
  detect?: 'confirmation' | 'process' | 'transit' | 'handoff';
  status?: number;
  truncated?: boolean;
  clockJumpMs?: number;
}

interface Entry {
  id: number;
  def: FaultDef;
  scope: Scope;
  point: HookPoint | null;
  fired: boolean;
  forMs: number | null;
  /** order_typo: where the wrong order is found. */
  detect: 'confirmation' | 'process' | 'transit' | 'handoff' | null;
  /** Waiting for this stage (deferral). Null when ready. */
  waitStage: string | null;
  fuzz: Pick<ArmRequest, 'status' | 'truncated' | 'clockJumpMs' | 'count'>;
}

interface Lane {
  entries: Entry[];
  inner: readonly HookPoint[];
  /** Crashes fired since the stack was last empty. Drives the doubling restart delay. */
  streak: number;
}

export interface Fired {
  fault: string;
  point: HookPoint;
  restartMs: number;
  /** 0 for the first crash, then 1, 2, ... */
  nested: number;
}

export class ChaosDirector {
  private readonly lanes = new Map<string, Lane>();
  private nextId = 1;

  /** Register a lane with the parts of its bot. Needed to know the bot's recovery hooks. */
  addLane(lane: string, parts: readonly Part[]): void {
    this.lanes.set(lane, { entries: [], inner: innerPoints(parts), streak: 0 });
  }

  private lane(l: string): Lane {
    const x = this.lanes.get(l);
    if (!x) throw new Error(`unknown lane ${l}`);
    return x;
  }

  /** Stack length for the lane. */
  depth(lane: string): number {
    return this.lane(lane).entries.length;
  }

  /** Crash arms the bot must hold, for the `go` message after a restart. */
  pendingArms(lane: string): ArmMsg[] {
    return this.lane(lane).entries
      .filter((e) => !e.fired && e.def.kind === 'process')
      .map((e) => armMsg(e));
  }

  arm(lane: string, req: ArmRequest, info: LaneInfo): ArmResult {
    const L = this.lane(lane);
    const def = faultById(req.fault);
    if (!def) return { ok: false, status: 400, error: 'unknown_fault' };
    if (req.point && def.kind !== 'process') return { ok: false, status: 400, error: 'bad_point' };
    if (L.entries.length >= MAX_DEPTH) return { ok: false, status: 409, error: 'depth_limit' };

    const recovering = info.state === 'recovering' || info.state === 'dead';
    const scope: Scope = req.scope ?? (recovering ? 'inner' : 'outer');
    // A dead lane has no stage hook to reach: whatever is armed lands in recovery.
    const eff: Scope = info.state === 'dead' ? 'inner' : scope;
    const entry: Entry = { id: this.nextId++, def, scope: eff, point: req.point ?? null, fired: false, forMs: req.forMs ?? null, detect: req.detect ?? null, waitStage: null,
      fuzz: { ...(req.status !== undefined ? { status: req.status } : {}), ...(req.truncated ? { truncated: true } : {}), ...(req.clockJumpMs !== undefined ? { clockJumpMs: req.clockJumpMs } : {}), ...(req.count !== undefined ? { count: req.count } : {}) } };

    const detail: ChaosDetail = {
      fault: def.id, scope: eff, depth: L.entries.length + 1,
      injectedAt: injectedAtFor(def, entry.point, eff),
    };
    if (entry.point) detail.point = entry.point;

    let provider: ProviderArm | null = null;
    if (def.id === 'order_typo' || def.kind === 'file') {
      // The wrong order needs the file swapped first: it waits for the bot's next `input_read` hook (`onInputRead`),
      // which also names the order the provider complains about. The input faults (missing file, duplicate, malformed) act on
      // the same hook: the runner changes the order file just before the bot reads it.
      entry.waitStage = INPUT_READ;
      if (info.stage !== null && info.stage !== 'create') {
        detail.deferred = true;
        detail.deferredTo = 'create';
      }
    } else if (def.kind !== 'process') {
      const applies = info.stage !== null && def.stages.includes(info.stage);
      // Inner provider faults go to the next call made by recovery code, whatever the stage.
      if (!applies && eff === 'outer') {
        const next = nextApplicableStage(def, info.stage);
        entry.waitStage = next.stage;
        detail.deferred = true;
        detail.deferredTo = next.stage;
      }
      if (entry.waitStage === null) {
        entry.fired = true;
        provider = providerArm(entry);
      }
    }
    L.entries.push(entry);
    return { ok: true, id: entry.id, detail, arm: def.kind === 'process' ? armMsg(entry) : null, provider };
  }

  /** A stage starts. Returns deferred non-process faults that now apply, for the runner to post. */
  onStageStart(lane: string, stage: string): ProviderArm[] {
    const out: ProviderArm[] = [];
    for (const e of this.lane(lane).entries) {
      if (e.waitStage === stage && !e.fired) {
        e.fired = true;
        e.waitStage = null;
        out.push(providerArm(e));
      }
    }
    return out;
  }

  /**
   * The bot reached its `input_read` hook for `order`. Returns the armed wrong-order fault (order_typo) that now acts, for
   * the runner to swap the file and post to the provider, or null when none is waiting.
   */
  onInputRead(lane: string, order: string): ProviderArm | null {
    const e = this.lane(lane).entries.find((x) => (x.def.id === 'order_typo' || x.def.kind === 'file') && x.waitStage === INPUT_READ && !x.fired);
    if (!e) return null;
    e.fired = true;
    e.waitStage = null;
    const { nextCaller: _recovery, ...arm } = providerArm(e);
    return { ...arm, order };
  }

  /**
   * The bot reached an armed hook and sent `at_point`. If it matches a pending crash, consume it and say
   * how long to wait before the restart. Null means this hook does not fire (a stale message).
   */
  onAtPoint(lane: string, point: HookPoint): Fired | null {
    const L = this.lane(lane);
    const e = L.entries.find((x) => !x.fired && x.def.kind === 'process'
      && matchesHook({ fault: x.def.id, scope: x.scope, ...(x.point ? { point: x.point } : {}) }, point, L.inner));
    if (!e) return null;
    e.fired = true;
    const nested = L.streak++;
    return { fault: e.def.id, point, restartMs: restartDelay(e.def.restartMs ?? 1000, nested), nested };
  }

  /** The process is back. Fired crashes leave the stack, so depth falls to what is still pending. */
  processUp(lane: string): void {
    const L = this.lane(lane);
    L.entries = L.entries.filter((e) => !(e.fired && e.def.kind === 'process'));
  }

  /** The stage completed, or the order was parked, failed or finished. The stack empties. */
  stageComplete(lane: string): void {
    const L = this.lane(lane);
    // Fired entries are done. Unfired crash arms and deferred faults survive until the order ends.
    L.entries = L.entries.filter((e) => !e.fired);
    if (L.entries.length === 0) L.streak = 0;
  }

  /** The order left the queue. Returns the faults that never fired, for `chaos_absorbed`. */
  orderEnd(lane: string): string[] {
    const L = this.lane(lane);
    // An input fault (missing file, duplicate, malformed) waits for a later order's `input_read`, so it outlives the order that ended.
    const keep = (e: Entry): boolean => e.def.kind === 'file' && !e.fired;
    const unused = L.entries.filter((e) => !e.fired && !keep(e)).map((e) => e.def.id);
    L.entries = L.entries.filter(keep);
    L.streak = 0;
    return unused;
  }

  /**
   * Boss arms: the faults to press on every lane. Power outage crashes at the hero point when the
   * lane's stage has an effect, else `mid_stage`. The others defer by the normal rules.
   */
  bossArms(boss: BossId, lanes: Record<string, LaneInfo>): { lane: string; req: ArmRequest }[] {
    if (!(BOSSES as readonly string[]).includes(boss)) throw new Error(`unknown boss ${boss}`);
    const out: { lane: string; req: ArmRequest }[] = [];
    for (const [lane, info] of Object.entries(lanes)) {
      if (boss === 'boss_power_outage') {
        const point: HookPoint = info.stage !== null && JOURNALED_EFFECT_STAGES.includes(info.stage)
          ? 'after_effect_before_journal' : 'mid_stage';
        out.push({ lane, req: { fault: 'power_outage', point } });
      } else if (boss === 'boss_internet_outage') {
        out.push({ lane, req: { fault: 'internet_outage', forMs: 12000 } });
      } else {
        out.push({ lane, req: { fault: 'hazard_event' } }, { lane, req: { fault: 'http_429' } });
      }
    }
    return out;
  }
}

function armMsg(e: Entry): ArmMsg {
  return { fault: e.def.id, scope: e.scope, ...(e.point ? { point: e.point } : {}) };
}

function providerArm(e: Entry): ProviderArm {
  const a: ProviderArm = { id: e.id, fault: e.def.id };
  const forMs = e.forMs ?? e.def.forMs;
  // An explicit call count (fuzz, gremlin) replaces the catalog window.
  if (forMs !== undefined && e.fuzz.count === undefined) a.forMs = forMs;
  const count = e.fuzz.count ?? e.def.count;
  if (count !== undefined) a.count = e.scope === 'inner' ? 1 : count;
  if (e.fuzz.status !== undefined) a.status = e.fuzz.status;
  if (e.fuzz.truncated) a.truncated = true;
  if (e.fuzz.clockJumpMs !== undefined) a.clockJumpMs = e.fuzz.clockJumpMs;
  if (e.scope === 'inner') a.nextCaller = 'recovery';
  if (e.detect !== null) a.detect = e.detect;
  return a;
}

/** Marker for a fault that waits for the bot's `input_read` hook instead of a stage. */
const INPUT_READ = 'input_read';
