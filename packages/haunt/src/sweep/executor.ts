// Sweep executor: runs each planned cell through an injected runner and builds a deterministic graded report.
import { gradeOf, type Grade } from '../score/grade';
import { buildMatrix, type CellOutcome, type CoverageMatrix, type SweepCell, type SweepPlan } from './matrix';

/** Runs one cell (one creature on one stage) and says what the app did. Supplied by the runner adapter. */
/** A runner may return the bare outcome or detail the grader needs for caps. */
export interface CellDetail {
  outcome: CellOutcome;
  /** Ledger kinds that got extra rows in this cell (for example 'charge'). */
  repeatedKinds?: string[];
  /** The order was paid but not fulfilled, or abandoned. */
  lost?: boolean;
}
export type RunCell = (cell: SweepCell, seed: number) => Promise<CellOutcome | CellDetail> | CellOutcome | CellDetail;

export interface SweepCellResult extends SweepCell {
  outcome: CellOutcome;
  repeatedKinds?: string[];
  lost?: boolean;
  error?: string;
}

export interface SweepReport {
  seed: number;
  matrix: CoverageMatrix;
  cells: SweepCellResult[];
  reliability: number;
  grade: Grade;
}

/** Derives a per-cell seed so a repeated sweep with the same seed replays the same faults. */
export function cellSeed(seed: number, index: number): number {
  return (Math.imul(seed >>> 0, 2654435761) + Math.imul(index + 1, 40503)) >>> 0;
}

/** Design section 8: repeated charge caps at C; a halt or a lost order caps at D. ecovered_late still completed clean. */
export function gradeSweep(matrix: CoverageMatrix, cells: SweepCellResult[] = []) {
  const t = matrix.totals;
  const orders = t.pass + t.repeat + t.recovered_late + t.fail + t.halt;
  return gradeOf({
    orders,
    clean: t.pass + t.recovered_late,
    parkedResumed: 0,
    quarantined: 0,
    extraRows: t.repeat,
    chargeRepeated: cells.some((c) => c.repeatedKinds?.includes('charge')),
    halted: t.halt > 0,
    lostOrders: cells.filter((c) => c.lost).length,
  });
}

export async function runSweep(plan: SweepPlan, runCell: RunCell, seed = 1): Promise<SweepReport> {
  const cells: SweepCellResult[] = [];
  const outcomes: Record<string, CellOutcome> = {};
  for (let i = 0; i < plan.cells.length; i++) {
    const cell = plan.cells[i];
    let outcome: CellOutcome;
    let detail: Partial<CellDetail> = {};
    let error: string | undefined;
    try {
      const r = await runCell(cell, cellSeed(seed, i));
      if (typeof r === 'string') outcome = r;
      else { outcome = r.outcome; detail = r; }
    } catch (e) {
      outcome = 'fail';
      error = e instanceof Error ? e.message : String(e);
    }
    outcomes[`${cell.stage}/${cell.creature}`] = outcome;
    cells.push({
      ...cell,
      outcome,
      ...(detail.repeatedKinds?.length ? { repeatedKinds: detail.repeatedKinds } : {}),
      ...(detail.lost ? { lost: true } : {}),
      ...(error ? { error } : {}),
    });
  }
  const matrix = buildMatrix(plan, outcomes);
  const { reliability, grade } = gradeSweep(matrix, cells);
  return { seed, matrix, cells, reliability, grade };
}
