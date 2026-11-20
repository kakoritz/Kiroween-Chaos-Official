import { describe, expect, it } from 'vitest';
import { parseHauntConfig } from '../src/config/haunt-config';
import { CreatureRegistry } from '../src/creatures/plugin';
import { gradeSweep, planSweep, runSweep, type RunCell } from '../src/sweep';

function plan() {
  const r = parseHauntConfig(`
name: demo
start: node bot.js
truth: http://localhost:9000/truth
stages:
  - id: intake
    role: input
  - id: charge
    role: effect
`);
  if (!r.ok) throw new Error(r.errors.join(';'));
  const reg = new CreatureRegistry();
  const noop = () => {};
  reg.register({ id: 'zombie', label: 'Zombie', family: 'network', faults: ['timeout'], inject: noop });
  reg.register({ id: 'ghost', label: 'Ghost', family: 'http', faults: ['404'], appliesTo: { stages: ['charge'] }, inject: noop });
  return planSweep(r.config, reg.list());
}

describe('sweep executor', () => {
  it('fills the matrix and grades a clean sweep A', async () => {
    const rep = await runSweep(plan(), () => 'pass', 5);
    expect(rep.matrix.totals.pass).toBe(3);
    expect(rep.matrix.totals.pending).toBe(0);
    expect(rep.matrix.rows.intake.ghost).toBe('n/a');
    expect(rep.grade).toBe('A');
  });

  it('grades repeats and failures down and records thrown errors as fail', async () => {
    const run: RunCell = (c) => {
      if (c.creature === 'ghost') throw new Error('boom');
      return c.stage === 'charge' ? 'repeat' : 'pass';
    };
    const rep = await runSweep(plan(), run);
    expect(rep.matrix.totals).toMatchObject({ pass: 1, repeat: 1, fail: 1 });
    expect(rep.cells.find((c) => c.creature === 'ghost')?.error).toBe('boom');
    expect(rep.grade).toBe('F');
  });

  it('P8: same seed twice gives byte-identical report JSON, and seeds reach the runner', async () => {
    const seen: number[] = [];
    const run: RunCell = (_c, seed) => { seen.push(seed); return seed % 2 ? 'pass' : 'fail'; };
    const a = JSON.stringify(await runSweep(plan(), run, 42));
    const n = seen.length;
    const b = JSON.stringify(await runSweep(plan(), run, 42));
    expect(a).toBe(b);
    expect(seen.slice(0, n)).toEqual(seen.slice(n));
    expect(new Set(seen.slice(0, n)).size).toBe(n);
  });

  it('caps the grade: repeated charge at C, lost order at D, halt at D', async () => {
    const totals = { pass: 19, repeat: 0, recovered_late: 0, fail: 0, halt: 0, 'n/a': 0, pending: 0 };
    const big = { stages: [], creatures: [], rows: {}, totals };
    const cell = { stage: 'charge', creature: 'zombie', fault: 'timeout', outcome: 'pass' as const };
    expect(gradeSweep(big).grade).toBe('A');
    expect(gradeSweep(big, [{ ...cell, repeatedKinds: ['charge'] }]).grade).toBe('C');
    expect(gradeSweep(big, [{ ...cell, repeatedKinds: ['notify'] }]).grade).toBe('A');
    const lost = await runSweep(plan(), (c) => (c.stage === 'charge' && c.creature === 'zombie' ? { outcome: 'fail', lost: true } : 'pass'));
    expect(lost.grade).toBe('D');
    const halt = await runSweep(plan(), (c) => (c.creature === 'ghost' ? 'halt' : 'pass'));
    expect(halt.matrix.totals.halt).toBe(1);
    expect(halt.grade).toBe('D');
  });

  it('counts recovered_late as a clean completion', async () => {
    const rep = await runSweep(plan(), (c) => (c.stage === 'intake' ? 'recovered_late' : 'pass'));
    expect(rep.matrix.totals.recovered_late).toBe(1);
    expect(rep.grade).toBe('A');
  });
});
