import { describe, expect, it } from 'vitest';
import { BOSS_STAGE, liveBossCreatures, parseBoss, planBoss, renderBoss, runBoss } from '../src/boss';
import { compareReports, renderCompare } from '../src/compare';
import { bossTargets } from '../src/report/ci';
import { gradeSweep, type SweepCellResult, type SweepReport } from '../src/sweep/executor';
import { buildMatrix, type CellOutcome } from '../src/sweep/matrix';

const spec = { recoverMs: 1000, repeats: 0, throughputPerMin: 0, concurrency: 1 } as never;

describe('boss mode', () => {
  it('plans each boss once and resolves names', () => {
    expect(planBoss().bosses).toEqual(['boss_power_outage', 'boss_internet_outage', 'boss_hazard_storm']);
    expect(planBoss(['lich', 'boss_power_outage']).bosses).toEqual(['boss_power_outage']);
    expect(parseBoss('horseman')).toBe('boss_hazard_storm');
    expect(parseBoss('nope')).toBeNull();
    expect(() => planBoss(['nope'])).toThrow(/unknown boss/);
    expect(Object.keys(BOSS_STAGE)).toHaveLength(3);
  });

  it('is deterministic and passes when every boss is survived', async () => {
    const seeds: number[] = [];
    const run = (_b: string, s: number) => { seeds.push(s); return 'pass' as const; };
    const a = await runBoss(planBoss(), run, 7);
    const b = await runBoss(planBoss(), run, 7);
    expect(a).toEqual(b);
    expect(a.passed).toBe(true);
    expect(a.grade).toBe('A');
    expect(bossTargets(spec, a).every((t) => t.pass)).toBe(true);
    expect(renderBoss(a)).toContain('boss PASS');
  });

  it('fails and caps the grade when a boss repeats a charge, halts a lane or throws', async () => {
    const r = await runBoss(planBoss(), (b) => {
      if (b === 'boss_power_outage') return { outcome: 'repeat', repeatedKinds: ['charge'] };
      if (b === 'boss_internet_outage') throw new Error('boom');
      return 'halt';
    });
    expect(r.passed).toBe(false);
    expect(r.results[1].error).toBe('boom');
    expect(['D', 'F']).toContain(r.grade);
    const t = bossTargets(spec, r);
    expect(t.find((x) => x.name === 'bossSurvived')?.pass).toBe(false);
    expect(t.find((x) => x.name === 'repeats')?.pass).toBe(false);
  });

  it('counts recovered_late as survived', async () => {
    const r = await runBoss(planBoss(), () => 'recovered_late');
    expect(r.passed).toBe(true);
  });

  it('defines one live creature per boss', () => {
    expect(liveBossCreatures(4).map((c) => c.id)).toEqual(['lich', 'banshee_queen', 'headless_horseman']);
  });

  it('presses the hazard storm on tracking and dispatch', async () => {
    const posted: { service: string; mode: string }[] = [];
    const c = liveBossCreatures(4)[2];
    await c.inject({ lane: '1', stage: 'dispatch', postFault: async (b: never) => { posted.push(b); } } as never, 'boss_hazard_storm');
    expect(posted.map((p) => p.service)).toEqual(['tracking', 'dispatch']);
    expect(posted[1].mode).toBe('status');
  });
});

function sweep(outcomes: Record<string, CellOutcome>, seed = 1): SweepReport {
  const cells: SweepCellResult[] = Object.entries(outcomes).map(([k, outcome]) => {
    const [stage, creature] = k.split('/');
    return { stage, creature, fault: 'f', outcome };
  });
  const stages = [...new Set(cells.map((c) => c.stage))];
  const creatures = [...new Set(cells.map((c) => c.creature))];
  const matrix = buildMatrix({ stages, creatures, cells: cells.map((c) => ({ stage: c.stage, creature: c.creature, fault: c.fault })) }, Object.fromEntries(cells.map((c) => [`${c.stage}/${c.creature}`, c.outcome])));
  const g = gradeSweep(matrix, cells);
  return { seed, matrix, cells, reliability: g.reliability, grade: g.grade };
}

describe('compare mode', () => {
  const rookie = sweep({ 'pay/reaper': 'repeat', 'pay/zombie': 'fail', 'ship/reaper': 'pass' });
  const phoenix = sweep({ 'pay/reaper': 'pass', 'pay/zombie': 'pass', 'ship/reaper': 'pass' });

  it('reports an improvement per cell and per score', () => {
    const r = compareReports(rookie, phoenix);
    expect(r.improved).toBe(2);
    expect(r.regressed).toBe(0);
    expect(r.same).toBe(1);
    expect(r.gradeChange).toBe('improved');
    expect(r.reliabilityDelta).toBeGreaterThan(0);
    expect(r.verdict).toBe('improved');
    expect(renderCompare(r)).toContain('improved pay/reaper: repeat -> pass');
  });

  it('reports a regression when the order is swapped', () => {
    const r = compareReports(phoenix, rookie);
    expect(r.regressed).toBe(2);
    expect(r.verdict).toBe('regressed');
  });

  it('says same for identical reports and counts unmatched cells', () => {
    expect(compareReports(phoenix, phoenix).verdict).toBe('same');
    const r = compareReports(phoenix, sweep({ 'pay/reaper': 'pass', 'pay/zombie': 'pass', 'ship/reaper': 'pass', 'ship/ghost': 'pass' }));
    expect(r.unmatched).toBe(1);
    expect(r.cells.find((c) => c.creature === 'ghost')?.change).toBe('added');
  });
});
