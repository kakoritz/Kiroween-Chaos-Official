// Compare mode: diff two sweep reports (two bots, two commits or two tiers) per cell and per score.
// Spec: engine design.md section 9 (compare A B), harness tasks.md H3.6.
import type { SweepReport } from '../sweep/executor';
import type { CellOutcome } from '../sweep/matrix';

/** Lower is better. */
const RANK: Record<CellOutcome, number> = { pass: 0, recovered_late: 1, repeat: 2, fail: 3, halt: 4 };
const GRADES = ['A', 'B', 'C', 'D', 'F'];

export interface CellDiff {
  stage: string;
  creature: string;
  fault: string;
  a: CellOutcome | null;
  b: CellOutcome | null;
  change: 'improved' | 'regressed' | 'same' | 'added' | 'removed';
}

export interface CompareReport {
  a: { seed: number; reliability: number; grade: string };
  b: { seed: number; reliability: number; grade: string };
  reliabilityDelta: number;
  gradeChange: 'improved' | 'regressed' | 'same';
  cells: CellDiff[];
  improved: number;
  regressed: number;
  same: number;
  /** Cells present in only one report. */
  unmatched: number;
  verdict: 'improved' | 'regressed' | 'same';
}

const key = (c: { stage: string; creature: string; fault: string }): string => `${c.stage}/${c.creature}/${c.fault}`;

export function compareReports(a: SweepReport, b: SweepReport): CompareReport {
  const am = new Map(a.cells.map((c) => [key(c), c]));
  const bm = new Map(b.cells.map((c) => [key(c), c]));
  const keys = [...new Set([...am.keys(), ...bm.keys()])].sort();
  const cells: CellDiff[] = keys.map((k) => {
    const x = am.get(k);
    const y = bm.get(k);
    const ref = (x ?? y)!;
    let change: CellDiff['change'];
    if (!x) change = 'added';
    else if (!y) change = 'removed';
    else if (RANK[y.outcome] < RANK[x.outcome]) change = 'improved';
    else if (RANK[y.outcome] > RANK[x.outcome]) change = 'regressed';
    else change = 'same';
    return { stage: ref.stage, creature: ref.creature, fault: ref.fault, a: x?.outcome ?? null, b: y?.outcome ?? null, change };
  });
  const count = (c: CellDiff['change']): number => cells.filter((d) => d.change === c).length;
  const gd = GRADES.indexOf(b.grade) - GRADES.indexOf(a.grade);
  const gradeChange = gd < 0 ? 'improved' : gd > 0 ? 'regressed' : 'same';
  const reliabilityDelta = Math.round((b.reliability - a.reliability) * 100) / 100;
  const improved = count('improved');
  const regressed = count('regressed');
  let verdict: CompareReport['verdict'] = 'same';
  if (gradeChange === 'regressed' || (gradeChange === 'same' && (regressed > improved || (regressed === improved && reliabilityDelta < 0)))) verdict = 'regressed';
  else if (gradeChange === 'improved' || improved > regressed || reliabilityDelta > 0) verdict = 'improved';
  return {
    a: { seed: a.seed, reliability: a.reliability, grade: a.grade },
    b: { seed: b.seed, reliability: b.reliability, grade: b.grade },
    reliabilityDelta, gradeChange, cells, improved, regressed, same: count('same'),
    unmatched: count('added') + count('removed'), verdict,
  };
}

export function compareReportJson(r: CompareReport): string {
  return JSON.stringify(r, null, 2) + '\n';
}

export function renderCompare(r: CompareReport): string {
  const changed = r.cells.filter((c) => c.change !== 'same').map((c) => `${c.change} ${c.stage}/${c.creature}: ${c.a ?? '-'} -> ${c.b ?? '-'}`);
  return [
    `A grade ${r.a.grade} (${r.a.reliability}), B grade ${r.b.grade} (${r.b.reliability}), reliability ${r.reliabilityDelta >= 0 ? '+' : ''}${r.reliabilityDelta}`,
    `cells: ${r.improved} improved, ${r.regressed} regressed, ${r.same} same, ${r.unmatched} unmatched`,
    ...changed,
    `compare ${r.verdict.toUpperCase()}`,
  ].join('\n');
}
