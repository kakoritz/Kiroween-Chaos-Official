// Sweep plan and stage-by-creature coverage matrix. Spec: harness requirements (Sweep), tasks.md H3.2.
import type { HauntConfig, StageDef } from '../config/haunt-config';
import type { CreaturePlugin } from '../creatures/plugin';

export type CellStatus = 'pass' | 'repeat' | 'recovered_late' | 'fail' | 'halt' | 'n/a' | 'pending';
export type CellOutcome = Exclude<CellStatus, 'n/a' | 'pending'>;

export interface SweepCell { stage: string; creature: string; fault: string }

export interface SweepPlan {
  stages: string[];
  creatures: string[];
  /** Applicable cells in stable stage-major order, one per creature (its first fault). */
  cells: SweepCell[];
}

export function appliesToStage(c: CreaturePlugin, s: StageDef): boolean {
  const a = c.appliesTo;
  if (!a) return true;
  if (a.roles && !a.roles.includes(s.role)) return false;
  if (a.stages && !a.stages.includes(s.id)) return false;
  return true;
}

export function planSweep(config: HauntConfig, creatures: CreaturePlugin[]): SweepPlan {
  const sorted = [...creatures].sort((a, b) => a.id.localeCompare(b.id));
  const cells: SweepCell[] = [];
  for (const s of config.stages) {
    for (const c of sorted) {
      if (appliesToStage(c, s)) cells.push({ stage: s.id, creature: c.id, fault: c.faults[0] });
    }
  }
  return { stages: config.stages.map((s) => s.id), creatures: sorted.map((c) => c.id), cells };
}

export interface CoverageMatrix {
  stages: string[];
  creatures: string[];
  rows: Record<string, Record<string, CellStatus>>;
  totals: Record<CellStatus, number>;
}

export function buildMatrix(plan: SweepPlan, outcomes: Record<string, CellOutcome> = {}): CoverageMatrix {
  const totals: Record<CellStatus, number> = { pass: 0, repeat: 0, recovered_late: 0, fail: 0, halt: 0, 'n/a': 0, pending: 0 };
  const applicable = new Set(plan.cells.map((c) => `${c.stage}/${c.creature}`));
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
