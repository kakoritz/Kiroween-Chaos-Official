// Reliability, grade and caps (design.md section 8, runtime.md sections 8 and 23).
import type { LaneCounts } from './score';

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

const ORDER: Grade[] = ['A', 'B', 'C', 'D', 'F'];

export function gradeFromScore(score: number): Grade {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 65) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}

export function worstGrade(grades: Grade[]): Grade | undefined {
  let worst = -1;
  for (const g of grades) worst = Math.max(worst, ORDER.indexOf(g));
  return worst < 0 ? undefined : ORDER[worst];
}

function capAt(g: Grade, cap: Grade): Grade {
  return ORDER.indexOf(g) < ORDER.indexOf(cap) ? cap : g;
}

export interface GradeInput {
  orders: number;
  clean: number;
  parkedResumed: number;
  quarantined: number;
  extraRows: number;
  chargeRepeated?: boolean;
  halted?: boolean;
  lostOrders?: number;
}

export function reliability(i: GradeInput): number {
  if (i.orders <= 0) return 0;
  const base = (100 * (i.clean + 0.5 * i.parkedResumed + 0.5 * i.quarantined)) / i.orders;
  return Math.max(0, base - 15 * i.extraRows);
}

export function gradeOf(i: GradeInput): { reliability: number; grade: Grade } {
  const r = reliability(i);
  let g = gradeFromScore(r);
  if (i.chargeRepeated) g = capAt(g, 'C');
  if (i.halted || (i.lostOrders ?? 0) > 0) g = capAt(g, 'D');
  return { reliability: r, grade: g };
}

/** Wave grade for one lane, from the score engine counts. `orders` is the number of orders the lane was given. */
export function laneGrade(c: LaneCounts, orders: number, extra: { chargeRepeated?: boolean; lostOrders?: number } = {}) {
  return gradeOf({
    orders,
    clean: c.clean,
    parkedResumed: c.parkedResumed,
    quarantined: c.quarantined,
    extraRows: c.repeats,
    halted: c.halted,
    chargeRepeated: extra.chargeRepeated,
    lostOrders: (extra.lostOrders ?? 0) + c.abandoned,
  });
}
