// Sweep plan and stage-by-creature coverage matrix. Spec: harness requirements (Sweep), tasks.md H3.2.
import type { HauntConfig, StageDef } from '../config/haunt-config';
import type { CreaturePlugin } from '../creatures/plugin';
import { faultById } from '../chaos/catalog';

export type CellStatus = 'pass' | 'repeat' | 'recovered_late' | 'fail' | 'halt' | 'n/a' | 'pending';
export type CellOutcome = Exclude<CellStatus, 'n/a' | 'pending'>;

export interface SweepCell {
  stage: string;
  creature: string;
  fault: string;
  /** Matrix column when it is not the creature id: `creature:fault` for a creature's second and later faults (PT-C11). */
  column?: string;
}

export const cellColumn = (c: { creature: string; column?: string }): string => c.column ?? c.creature;

export interface SweepPlan {
  stages: string[];
  creatures: string[];
  /** Applicable cells in stable stage-major order, one per creature (its first fault). */
  cells: SweepCell[];
}

export function appliesToStage(c: CreaturePlugin, s: StageDef, catalogStages = false, fault: string = c.faults[0]): boolean {
  const a = c.appliesTo;
  if (a) {
    if (a.roles && !a.roles.includes(s.role)) return false;
    if (a.stages && !a.stages.includes(s.id)) return false;
  }
  // Opt-in for the reference app: a catalog fault only lands on the stages the catalog lists (design.md section 5).
  if (catalogStages) {
    const def = faultById(fault);
    if (def && !def.stages.includes(s.id)) return false;
  }
  return true;
}

export interface PlanOptions {
  /** Drop cells whose catalog fault never lands on that stage id (stage ids of the reference app). */
  catalogStages?: boolean;
}

export function planSweep(config: HauntConfig, creatures: CreaturePlugin[], opts: PlanOptions = {}): SweepPlan {
  const sorted = [...creatures].sort((a, b) => a.id.localeCompare(b.id));
  const cells: SweepCell[] = [];
  const columns = new Set(sorted.map((c) => c.id));
  for (const s of config.stages) {
    for (const c of sorted) {
      if (appliesToStage(c, s, opts.catalogStages)) cells.push({ stage: s.id, creature: c.id, fault: c.faults[0] });
      // Second and later faults of one creature (sms_down, no_answer, wrong_address ...) get their own column, catalog stages only.
      if (opts.catalogStages) {
        for (const f of c.faults.slice(1)) {
          if (!faultById(f) || !appliesToStage(c, s, true, f)) continue;
          const column = `${c.id}:${f}`;
          columns.add(column);
          cells.push({ stage: s.id, creature: c.id, fault: f, column });
        }
      }
    }
  }
  return { stages: config.stages.map((s) => s.id), creatures: [...columns].sort((a, b) => a.localeCompare(b)), cells };
}

export interface CoverageMatrix {
  stages: string[];
  creatures: string[];
  rows: Record<string, Record<string, CellStatus>>;
  totals: Record<CellStatus, number>;
}

export function buildMatrix(plan: SweepPlan, outcomes: Record<string, CellOutcome> = {}): CoverageMatrix {
  const totals: Record<CellStatus, number> = { pass: 0, repeat: 0, recovered_late: 0, fail: 0, halt: 0, 'n/a': 0, pending: 0 };
  const applicable = new Set(plan.cells.map((c) => `${c.stage}/${cellColumn(c)}`));
  const rows: CoverageMatrix['rows'] = {};
  for (const s of plan.stages) {
    rows[s] = {};
    for (const c of plan.creatures) {
      const key = `${s}/${c}`;
      const st: CellStatus = !applicable.has(key) ? 'n/a' : (outcomes[key] ?? 'pending');
      rows[s][c] = st;
      totals[st]++;
    }
  }
  return { stages: plan.stages, creatures: plan.creatures, rows, totals };
}

/** Fixed-width text rendering for CLI output. */
export function renderMatrix(m: CoverageMatrix): string {
  const w = Math.max(5, ...m.stages.map((s) => s.length));
  const head = ['stage'.padEnd(w), ...m.creatures].join(' | ');
  const lines = [head, '-'.repeat(head.length)];
  for (const s of m.stages) {
    lines.push([s.padEnd(w), ...m.creatures.map((c) => m.rows[s][c].padEnd(c.length))].join(' | '));
  }
  return lines.join('\n');
}
