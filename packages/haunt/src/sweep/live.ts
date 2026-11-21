// Live cell adapter for the sweep: runs one lane of the bot per cell, injects the cell's creature fault at the
// cell's stage, and reads the lane folders and the provider ledger to say what the app did.
// Spec: harness tasks.md H3.2; design.md section 8 (grade caps).
import { mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { LedgerRow } from '../../../core/src/provider';
import { ChaosDirector, JOURNALED_EFFECT_STAGES, faultById } from '../chaos';
import { corruptNext, hauntFile, injectDuplicate, nextOrderFile, prepareLane, runLane } from '../runner';
import { postProviderArm, scanRepeats, type PostFault } from '../runner/provider';
import type { CreatureContext, CreaturePlugin } from '../creatures/plugin';
import type { HookPoint } from '../sdk';
import type { CellDetail, RunCell } from './executor';
import type { CellOutcome, SweepCell } from './matrix';

/** The provider as seen by the adapter (an in-process Provider fits this shape). */
export interface LiveCellProvider {
  url: string;
  reset(): void;
  ledger(lane: string): LedgerRow[];
  /** Applies a /_fault body. */
  post: PostFault;
}

export interface LiveCellOptions {
  /** Process that runs the bot, e.g. process.execPath. */
  command: string;
  args: string[];
  /** Scratch directory; each cell gets its own subfolder. */
  runDir: string;
  provider: LiveCellProvider;
  creatures: readonly CreaturePlugin[];
  env?: Record<string, string>;
  tier?: string;
  /** Orders per cell. Default 2. */
  orders?: number;
  /** Divides fault windows and restart delays. Default 4. */
  speed?: number;
  /** A fault that fired and took longer than this to finish counts as recovered_late. */
  recoverMs?: number;
  /** Stages whose faults are applied before the bot starts (input faults). Default ['intake']. */
  preStages?: readonly string[];
  /** Hard stop on restarts. Default 6. */
  maxStarts?: number;
  /** Aborts a cell that runs longer than this (counts as halt). Default 60000. */
  cellTimeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const LANE = '1';

const count = (dir: string): number => readdirSync(dir).filter((f) => f.endsWith('.json')).length;

/** Builds a RunCell that runs each cell against the live bot. */
export function createLiveCellRunner(o: LiveCellOptions): RunCell {
  const now = o.now ?? Date.now;
  const speed = o.speed ?? 4;
  const orders = o.orders ?? 2;
  const pre = new Set(o.preStages ?? ['intake']);
  const byId = new Map(o.creatures.map((c) => [c.id, c]));
  mkdirSync(o.runDir, { recursive: true });
  const base = mkdtempSync(join(o.runDir, 'sweep-'));
  let cellNo = 0;

  return async (cell: SweepCell, seed: number): Promise<CellDetail> => {
    const creature = byId.get(cell.creature);
    if (!creature) throw new Error(`unknown creature "${cell.creature}"`);
    const dir = join(base, `cell-${++cellNo}`);
    const { paths } = prepareLane(dir, 1, seed, orders);
    o.provider.reset();
    const director = new ChaosDirector();
    director.addLane(LANE, []);
    let send: ((m: Record<string, unknown>) => void) | undefined;
    let stage: string | null = null;
    let fired = false;

    const armProcess = (fault: string, params?: Record<string, unknown>): void => {
      const point: HookPoint = JOURNALED_EFFECT_STAGES.includes(cell.stage) ? 'after_effect_before_journal' : 'mid_stage';
      const r = director.arm(LANE, { fault, point, ...(params?.forMs ? { forMs: Number(params.forMs) } : {}) }, { state: 'working', stage });
      if (!r.ok) throw new Error(r.error);
      if (r.arm) send?.({ k: 'arm', id: String(r.id), ...r.arm });
    };
    const ctx = {
      rng: () => 0.5,
      lane: LANE,
      get stage() { return stage; },
      postFault: o.provider.post,
      armProcess,
      input: {
        removeFile: () => {
          const f = nextOrderFile(paths);
          if (f) {
            const restore = hauntFile(paths, f);
            const t = setTimeout(restore, Math.max(50, 6000 / speed));
            (t as { unref?: () => void }).unref?.();
          }
        },
        duplicateFile: () => { injectDuplicate(paths); },
      },
      corruptInput: () => { corruptNext(paths); },
      fillDisk: () => { send?.({ k: 'arm', fault: 'disk_full' }); },
    } as CreatureContext;

    const inject = async (): Promise<void> => {
      if (fired) return;
      fired = true;
      stage = cell.stage;
      const def = faultById(cell.fault);
      const forMs = def?.forMs !== undefined ? Math.max(50, Math.round(def.forMs / speed)) : undefined;
      await creature.inject(ctx, cell.fault, forMs !== undefined ? { forMs } : {});
    };
    const pending: Promise<unknown>[] = [];
    const t0 = now();
    // missing_file acts at the bot's input_read hook on the head file it is about to read (runtime.md section 20),
    // so a lane with one order is not left empty before it starts.
    const atInputRead = cell.fault === 'missing_file' && cell.stage === 'intake';
    if (pre.has(cell.stage) && !atInputRead) pending.push(inject());

    const ac = new AbortController();
    const guard = setTimeout(() => ac.abort(), o.cellTimeoutMs ?? 60000);
    const res = await runLane({
      signal: ac.signal,
      lane: LANE, director, command: o.command, args: o.args, maxStarts: o.maxStarts ?? 6,
      sleep: o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, Math.max(1, ms / speed)))),
      env: {
        ...o.env,
        HAUNT_RUN_DIR: dir, HAUNT_DIR: paths.root, HAUNT_LANE: LANE, HAUNT_TIER: o.tier ?? '', HAUNT_SEED: String(seed),
        HAUNT_PROVIDER: o.provider.url, HAUNT_ORDERS_DIR: paths.orders, HAUNT_SPEED: String(speed),
        HAUNT_ATTEMPT: '1', HAUNT_APP: 'haunted-orders',
      },
      onProcess: (s) => { send = s; },
      onAtPoint: (point) => { if (atInputRead && point === 'input_read' && !fired) pending.push(inject()); },
      onEvent: (ev) => {
        if (ev.type !== 'stage_start' || typeof ev.stage !== 'string') return;
        stage = ev.stage;
        for (const arm of director.onStageStart(LANE, ev.stage)) pending.push(postProviderArm(o.provider.post, LANE, ev.stage, arm));
        if (ev.stage === cell.stage && !fired) pending.push(inject());
      },
    });
    await Promise.allSettled(pending);
    clearTimeout(guard);
    const durationMs = now() - t0;

    const rows = o.provider.ledger(LANE);
    const repeats = scanRepeats(rows);
    const done = count(paths.done) + count(paths.parked) + count(paths.quarantine);
    const failed = count(paths.failed);
    const left = count(paths.orders);
    const repeatedKinds = [...new Set(repeats.map((r) => r.kind))];
    const doneIds = new Set(readdirSync(paths.done).map((f) => f.replace(/\.json$/, '')));
    const charged = new Set(rows.filter((r) => r.kind === 'charge').map((r) => r.order));
    const dispatched = new Set(rows.filter((r) => r.kind === 'dispatch').map((r) => r.order));
    const lost = [...charged].some((id) => !dispatched.has(id) && !doneIds.has(id));

    let outcome: CellOutcome;
    if (!res.clean || left > 0) outcome = 'halt';
    else if (repeats.length > 0) outcome = 'repeat';
    else if (failed > 0 || done < orders) outcome = 'fail';
    else if (res.kills.length > 0 && o.recoverMs !== undefined && durationMs > o.recoverMs) outcome = 'recovered_late';
    else outcome = 'pass';
    return { outcome, ...(repeatedKinds.length ? { repeatedKinds } : {}), ...(lost ? { lost: true } : {}) };
  };
}
