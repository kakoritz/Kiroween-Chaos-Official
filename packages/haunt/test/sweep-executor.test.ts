import { describe, expect, it } from 'vitest';
import { parseHauntConfig } from '../src/config/haunt-config';
import { CreatureRegistry } from '../src/creatures/plugin';
import { planSweep, runSweep, type RunCell } from '../src/sweep';

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
});
