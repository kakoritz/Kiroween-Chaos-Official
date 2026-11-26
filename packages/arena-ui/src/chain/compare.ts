// Compare two chain results side by side (chain-wizard-v2 second list, item 5). Pure, no DOM.
import type { ChainReport } from '../../../haunt/src/blocks/cards';

export interface Pinned { name: string; protections: string; report: ChainReport }
export interface CompareRow { stage: string; a?: { failed: number; tried: number }; b?: { failed: number; tried: number }; change: 'better' | 'worse' | 'same' | 'only-a' | 'only-b' }
export interface Comparison {
  verdict: 'better' | 'worse' | 'same';
  gradeA: string; gradeB: string; failedA: number; failedB: number;
  reliabilityA: number; reliabilityB: number;
  rows: CompareRow[];
  summary: string;
}

const ORDER = 'FDCBA';
const rank = (g: string): number => Math.max(0, ORDER.indexOf(g.charAt(0).toUpperCase()));

/** A (pinned) against B (now). Better means a higher grade, or the same grade with fewer failures. */
export function compareChains(a: Pinned, b: Pinned): Comparison {
  const ra = a.report, rb = b.report;
  const stages = [...new Set([...ra.blame.map((x) => x.stage), ...rb.blame.map((x) => x.stage)])];
  const rows: CompareRow[] = stages.map((stage) => {
    const x = ra.blame.find((s) => s.stage === stage), y = rb.blame.find((s) => s.stage === stage);
    const change: CompareRow['change'] = !x ? 'only-b' : !y ? 'only-a' : y.failed < x.failed ? 'better' : y.failed > x.failed ? 'worse' : 'same';
    return { stage, ...(x ? { a: { failed: x.failed, tried: x.tried } } : {}), ...(y ? { b: { failed: y.failed, tried: y.tried } } : {}), change };
  });
  const d = rank(rb.grade) - rank(ra.grade);
  const verdict: Comparison['verdict'] = d > 0 ? 'better' : d < 0 ? 'worse' : rb.failed < ra.failed ? 'better' : rb.failed > ra.failed ? 'worse' : 'same';
  const summary = verdict === 'same'
    ? `Same result: grade ${rb.grade}, ${rb.failed} failures.`
    : `${verdict === 'better' ? 'Better' : 'Worse'}: grade ${ra.grade} to ${rb.grade}, failures ${ra.failed} to ${rb.failed}.`;
  return { verdict, gradeA: ra.grade, gradeB: rb.grade, failedA: ra.failed, failedB: rb.failed, reliabilityA: ra.reliability, reliabilityB: rb.reliability, rows, summary };
}
