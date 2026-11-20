// Stack mode: nest crash faults 1..N deep per stage and report the deepest depth the app survives.
// Spec: engine design.md sections 8 (depth curve) and 9 (stack), harness tasks.md H3.3.
import { MAX_DEPTH } from '../chaos';
import type { CreaturePlugin } from '../creatures/plugin';
import { cellSeed } from '../sweep/executor';
import type { CellOutcome } from '../sweep/matrix';
import { createLiveCellRunner, type LiveCellOptions } from '../sweep/live';

export interface StackPlan { stages: string[]; depths: number[] }

export function planStack(stages: readonly string[], maxDepth: number = MAX_DEPTH): StackPlan {
  const top = Math.max(1, Math.min(MAX_DEPTH, Math.floor(maxDepth)));
  return { stages: [...stages], depths: Array.from({ length: top }, (_, i) => i + 1) };
}

/** Result of one (stage, depth) run. Survived means the order completed or was parked, with no repeated side effect. */
export interface StackRunDetail { outcome: CellOutcome; repeatedKinds?: string[] }
export type RunStackCell = (stage: string, depth: number, seed: number) => Promise<CellOutcome | StackRunDetail> | CellOutcome | StackRunDetail;

export interface StackCellResult { stage: string; depth: number; outcome: CellOutcome; survived: boolean; error?: string }
export interface StackStageCurve { stage: string; maxSurvived: number; firstFailure: number | null; failureOutcome: CellOutcome | null }
export interface StackReport {
  seed: number;
  maxDepth: number;
  cells: StackCellResult[];
  curve: StackStageCurve[];
  /** Lowest max survived depth across stages. */
  weakest: number;
  /** True when every stage survived every depth tried. */
  passed: boolean;
}

const survives = (o: CellOutcome): boolean => o === 'pass' || o === 'recovered_late';

/** Runs each stage at depth 1..N, stopping a stage at its first failure (deeper depths cannot count as survived). */
export async function runStack(plan: StackPlan, run: RunStackCell, seed = 1): Promise<StackReport> {
  const cells: StackCellResult[] = [];
  const curve: StackStageCurve[] = [];
  let index = 0;
  for (const stage of plan.stages) {
    let maxSurvived = 0;
    let firstFailure: number | null = null;
    let failureOutcome: CellOutcome | null = null;
    for (const depth of plan.depths) {
      const s = cellSeed(seed, index++);
      let outcome: CellOutcome;
      let error: string | undefined;
      try {
        const r = await run(stage, depth, s);
        outcome = typeof r === 'string' ? r : r.outcome;
      } catch (e) {
        outcome = 'fail';
        error = e instanceof Error ? e.message : String(e);
      }
      const ok = survives(outcome);
      cells.push({ stage, depth, outcome, survived: ok, ...(error ? { error } : {}) });
      if (!ok) { firstFailure = depth; failureOutcome = outcome; break; }
      maxSurvived = depth;
    }
    curve.push({ stage, maxSurvived, firstFailure, failureOutcome });
  }
  const maxDepth = plan.depths.length === 0 ? 0 : plan.depths[plan.depths.length - 1];
  const weakest = curve.length === 0 ? 0 : Math.min(...curve.map((c) => c.maxSurvived));
  return { seed, maxDepth, cells, curve, weakest, passed: curve.every((c) => c.firstFailure === null) };
}

/** Deterministic JSON (no timestamps). */
export function stackReportJson(r: StackReport): string {
  return JSON.stringify(r, null, 2) + '\n';
}

export function renderStackCurve(r: StackReport): string {
  const w = Math.max(5, ...r.curve.map((c) => c.stage.length));
  const lines = [`${'stage'.padEnd(w)} | max depth | first failure`, '-'.repeat(w + 28)];
  for (const c of r.curve) {
    lines.push(`${c.stage.padEnd(w)} | ${String(c.maxSurvived).padStart(9)} | ${c.firstFailure === null ? 'none' : `depth ${c.firstFailure} (${c.failureOutcome})`}`);
  }
  return lines.join('\n');
}

export interface LiveStackOptions extends Omit<LiveCellOptions, 'creatures'> {
  /** Crash creature (the Reaper) from the catalog; its first fault is stacked. */
  crash: CreaturePlugin;
}

/** Live runner: injects the crash fault `depth` times at the stage; the director nests them and restarts double. */
export function createLiveStackRunner(o: LiveStackOptions): RunStackCell {
  const fault = o.crash.faults[0];
  let depth = 1;
  const stacked: CreaturePlugin = {
    ...o.crash,
    inject: async (ctx, f, params) => { for (let i = 0; i < depth; i++) await o.crash.inject(ctx, f, params); },
  };
  const cell = createLiveCellRunner({ ...o, creatures: [stacked] });
  return async (stage, d, seed) => {
    depth = d;
    const r = await cell({ stage, creature: stacked.id, fault }, seed);
    return typeof r === 'string' ? r : { outcome: r.outcome, ...(r.repeatedKinds ? { repeatedKinds: r.repeatedKinds } : {}) };
  };
}
