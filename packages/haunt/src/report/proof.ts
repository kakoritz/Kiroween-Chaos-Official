// Loop proof: compare a wave 1 report with a wave 2 report. Spec: tasks.md H6.10, acceptance.md H5.
import type { Grade } from '../score/grade';
import type { Report } from './builder';

const GRADE_RANK: Record<string, number> = { F: 0, D: 1, C: 2, B: 3, A: 4 };

export interface ProofDelta {
  app: string;
  gradeBefore: Grade;
  gradeAfter: Grade;
  improved: boolean;
  reliabilityBefore: number;
  reliabilityAfter: number;
  repeatsBefore: number;
  repeatsAfter: number;
  lostBefore: number;
  lostAfter: number;
  resolvedFindings: string[];
  remainingFindings: string[];
  newFindings: string[];
}

function ids(r: Report): string[] {
  return r.findings.map((f) => f.id);
}

/** Pure comparison of two reports for the same app. A grade improves only if its rank rises. */
export function compareWaves(before: Report, after: Report): ProofDelta {
  const b = new Set(ids(before));
  const a = new Set(ids(after));
  return {
    app: after.app,
    gradeBefore: before.grade,
    gradeAfter: after.grade,
    improved: (GRADE_RANK[after.grade] ?? -1) > (GRADE_RANK[before.grade] ?? -1),
    reliabilityBefore: before.reliability,
    reliabilityAfter: after.reliability,
    repeatsBefore: before.repeats.length,
    repeatsAfter: after.repeats.length,
    lostBefore: before.lost.length,
    lostAfter: after.lost.length,
    resolvedFindings: [...b].filter((x) => !a.has(x)).sort(),
    remainingFindings: [...b].filter((x) => a.has(x)).sort(),
    newFindings: [...a].filter((x) => !b.has(x)).sort(),
  };
}

export function renderProofMarkdown(d: ProofDelta): string {
  const list = (xs: string[]) => (xs.length ? xs.join(', ') : 'none');
  return [
    `# Loop proof: ${d.app}`,
    '',
    `| | Wave 1 | Wave 2 |`,
    `|---|---|---|`,
    `| Grade | ${d.gradeBefore} | ${d.gradeAfter} |`,
    `| Reliability | ${d.reliabilityBefore} | ${d.reliabilityAfter} |`,
    `| Repeated effects | ${d.repeatsBefore} | ${d.repeatsAfter} |`,
    `| Lost orders | ${d.lostBefore} | ${d.lostAfter} |`,
    '',
    `Improved: ${d.improved ? 'yes' : 'no'}`,
    `Resolved findings: ${list(d.resolvedFindings)}`,
    `Remaining findings: ${list(d.remainingFindings)}`,
    `New findings: ${list(d.newFindings)}`,
    '',
  ].join('\n');
}
