import { describe, expect, it } from 'vitest';
import { parseHauntConfig } from '../src/config/haunt-config';
import { CreatureRegistry } from '../src/creatures/plugin';
import { buildMatrix, planSweep, renderMatrix } from '../src/sweep';

const CFG = `
name: demo
start: node bot.js
truth: http://localhost:9000/truth
stages:
  - id: intake
    role: input
  - id: charge
    role: effect
`;

function setup() {
  const r = parseHauntConfig(CFG);
  if (!r.ok) throw new Error(r.errors.join(';'));
  const reg = new CreatureRegistry();
  const noop = () => {};
  reg.register({ id: 'zombie', label: 'Zombie', family: 'network', faults: ['timeout'], inject: noop });
  reg.register({ id: 'poltergeist', label: 'Poltergeist', family: 'data', faults: ['missing_file'], appliesTo: { roles: ['input'] }, inject: noop });
  reg.register({ id: 'ghost', label: 'Ghost', family: 'http', faults: ['404'], appliesTo: { stages: ['charge'] }, inject: noop });
  return { config: r.config, creatures: reg.list() };
}

describe('sweep plan and matrix', () => {
  it('plans applicable cells in stable stage-major order', () => {
    const { config, creatures } = setup();
    const plan = planSweep(config, creatures);
    expect(plan.creatures).toEqual(['ghost', 'poltergeist', 'zombie']);
    expect(plan.cells.map((c) => `${c.stage}/${c.creature}`)).toEqual([
      'intake/poltergeist', 'intake/zombie', 'charge/ghost', 'charge/zombie',
    ]);
  });

  it('marks inapplicable cells n/a and applies outcomes', () => {
    const { config, creatures } = setup();
    const plan = planSweep(config, creatures);
    const m = buildMatrix(plan, { 'charge/zombie': 'repeat', 'intake/zombie': 'pass' });
    expect(m.rows.intake.ghost).toBe('n/a');
    expect(m.rows.charge.poltergeist).toBe('n/a');
    expect(m.rows.charge.zombie).toBe('repeat');
    expect(m.rows.intake.zombie).toBe('pass');
    expect(m.rows.intake.poltergeist).toBe('pending');
    expect(m.totals).toEqual({ pass: 1, repeat: 1, fail: 0, 'n/a': 2, pending: 2 });
  });

  it('is deterministic and renders a table', () => {
    const { config, creatures } = setup();
    const a = JSON.stringify(buildMatrix(planSweep(config, creatures)));
    const b = JSON.stringify(buildMatrix(planSweep(config, [...creatures].reverse())));
    expect(a).toBe(b);
    expect(renderMatrix(buildMatrix(planSweep(config, creatures)))).toContain('intake');
  });
});
