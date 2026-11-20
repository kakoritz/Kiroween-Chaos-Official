// Sweep executor: runs each planned cell through an injected runner and builds a deterministic graded report.
import { gradeOf, type Grade } from '../score/grade';
import { buildMatrix, type CellOutcome, type CoverageMatrix, type SweepCell, type SweepPlan } from './matrix';

/** Runs one cell (one creature on one stage) and says what the app did. Supplied by the runner adapter. */
export type RunCell = (cell: SweepCell, seed: number) => Promise<CellOutcome> | CellOutcome;

export interface SweepCellResult extends SweepCell { outcome: CellOutcome; error?: string }

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

export function gradeSweep(matrix: CoverageMatrix) {
  const t = matrix.totals;
  const orders = t.pass + t.repeat + t.fail;
  return gradeOf({ orders, clean: t.pass, parkedResumed: 0, quarantined: 0, extraRows: t.repeat });
}

export async function runSweep(plan: SweepPlan, runCell: RunCell, seed = 1): Promise<SweepReport> {
  const cells: SweepCellResult[] = [];
  const outcomes: Record<string, CellOutcome> = {};
  for (let i = 0; i < plan.cells.length; i++) {
    const cell = plan.cells[i];
    let outcome: CellOutcome;
    let error: string | undefined;
    try {
      outcome = await runCell(cell, cellSeed(seed, i));
    } catch (e) {
      outcome = 'fail';
      error = e instanceof Error ? e.message : String(e);
    }
    outcomes[`${cell.stage}/${cell.creature}`] = outcome;
    cells.push({ ...cell, outcome, ...(error ? { error } : {}) });
  }
  const matrix = buildMatrix(plan, outcomes);
  const { reliability, grade } = gradeSweep(matrix);
  return { seed, matrix, cells, reliability, grade };
}
