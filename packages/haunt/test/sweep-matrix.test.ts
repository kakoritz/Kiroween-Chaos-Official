import { describe, expect, it } from 'vitest';
import { parseHauntConfig } from '../src/config/haunt-config';
import { CreatureRegistry } from '../src/creatures/plugin';
import { CORE_CREATURES, EXTRA_CREATURES } from '../src/creatures';
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
    expect(m.totals).toMatchObject({ pass: 1, repeat: 1, fail: 0, 'n/a': 2, pending: 2 });
  });

  it('is deterministic and renders a table', () => {
    const { config, creatures } = setup();
    const a = JSON.stringify(buildMatrix(planSweep(config, creatures)));
    const b = JSON.stringify(buildMatrix(planSweep(config, [...creatures].reverse())));
    expect(a).toBe(b);
    expect(renderMatrix(buildMatrix(planSweep(config, creatures)))).toContain('intake');
  });
});

describe('sweep columns for second faults (PT-C11)', () => {
  const cfg = parseHauntConfig(`
name: demo
start: node bot.js
truth: http://localhost:9000/truth
stages:
  - id: confirmation
    role: effect
  - id: transit
    role: effect
  - id: handoff
    role: effect
`);
  if (!cfg.ok) throw new Error(cfg.errors.join(';'));
  const all = [...CORE_CREATURES, ...EXTRA_CREATURES];

  it('adds creature:fault columns for the world and transit faults on their catalog stages only', () => {
    const plan = planSweep(cfg.config, all, { catalogStages: true });
    const has = (stage: string, column: string) => plan.cells.some((c) => c.stage === stage && (c.column ?? c.creature) === column);
    expect(has('confirmation', 'gargoyle:sms_down')).toBe(true);
    expect(has('handoff', 'black_cat:gated_house')).toBe(true);
    expect(has('handoff', 'black_cat')).toBe(true);
    expect(has('transit', 'scarecrow:delay')).toBe(true);
    expect(has('handoff', 'scarecrow:delay')).toBe(false);
    expect(plan.creatures).toContain('black_cat:gated_house');
    expect(plan.cells.find((c) => c.column === 'black_cat:gated_house')).toMatchObject({ creature: 'black_cat', fault: 'gated_house' });
    const m = buildMatrix(plan, { 'handoff/black_cat': 'pass', 'handoff/black_cat:gated_house': 'repeat' });
    expect(m.rows.handoff['black_cat']).toBe('pass');
    expect(m.rows.handoff['black_cat:gated_house']).toBe('repeat');
  });

  it('adds no extra columns without catalogStages (a custom app keeps one column per creature)', () => {
    const plan = planSweep(cfg.config, all);
    expect(plan.creatures.some((c) => c.includes(':'))).toBe(false);
  });
});
