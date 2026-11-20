import { describe, expect, it } from 'vitest';
import { planStack, renderStackCurve, runStack, stackReportJson } from '../src/stack';

describe('stack mode', () => {
  it('plans depths 1..5 and clamps to the director limit', () => {
    expect(planStack(['a']).depths).toEqual([1, 2, 3, 4, 5]);
    expect(planStack(['a'], 9).depths).toHaveLength(5);
    expect(planStack(['a'], 0).depths).toEqual([1]);
  });

  it('reports max survived depth per stage and stops a stage at its first failure', async () => {
    const calls: string[] = [];
    const rep = await runStack(planStack(['intake', 'charge']), (s, d) => {
      calls.push(`${s}${d}`);
      return s === 'charge' && d >= 3 ? 'repeat' : 'pass';
    }, 3);
    expect(rep.curve).toEqual([
      { stage: 'intake', maxSurvived: 5, firstFailure: null, failureOutcome: null },
      { stage: 'charge', maxSurvived: 2, firstFailure: 3, failureOutcome: 'repeat' },
    ]);
    expect(calls).not.toContain('charge4');
    expect(rep.weakest).toBe(2);
    expect(rep.passed).toBe(false);
  });

  it('counts a thrown runner as fail and is byte-identical for the same seed', async () => {
    const run = (s: string, d: number) => { if (d === 2) throw new Error('boom'); return 'pass' as const; };
    const a = await runStack(planStack(['x']), run, 7);
    const b = await runStack(planStack(['x']), run, 7);
    expect(a.cells[1]).toMatchObject({ outcome: 'fail', survived: false, error: 'boom' });
    expect(stackReportJson(a)).toBe(stackReportJson(b));
    expect(renderStackCurve(a)).toContain('depth 2 (fail)');
  });
});
