import { describe, expect, it } from 'vitest';
import { parseHauntConfig } from '../src/config/haunt-config';
import { CreatureRegistry } from '../src/creatures/plugin';
import { buildReport, renderJsonStable, type ReportInput } from '../src/report';
import { runRamp, type RunRampStep } from '../src/ramp';
import { RandomChaos, planBoss } from '../src/runner';
import { fnv1a32, mulberry32, unit } from '../src/shared/rng';
import { cellSeed, planSweep, runSweep, sweepReportJson, type CellOutcome, type RunCell } from '../src/sweep';

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
  - id: ship
    role: effect
`);
  if (!r.ok) throw new Error(r.errors.join(';'));
  const reg = new CreatureRegistry();
  const noop = () => {};
  reg.register({ id: 'zombie', label: 'Zombie', family: 'network', faults: ['timeout'], inject: noop });
  reg.register({ id: 'ghost', label: 'Ghost', family: 'http', faults: ['404'], inject: noop });
  reg.register({ id: 'wraith', label: 'Wraith', family: 'http', faults: ['429'], appliesTo: { stages: ['charge'] }, inject: noop });
  return planSweep(r.config, reg.list());
}

// Outcome depends only on the cell seed, so identical seeds must replay identically.
const seededRunner: RunCell = (_cell, seed) => {
  const u = unit('cell', seed);
  const outcome: CellOutcome = u < 0.5 ? 'pass' : u < 0.7 ? 'repeat' : u < 0.85 ? 'recovered_late' : 'fail';
  return { outcome, repeatedKinds: outcome === 'repeat' ? ['charge'] : undefined };
};

describe('determinism: rng', () => {
  it('mulberry32 replays the same stream for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const sa = Array.from({ length: 50 }, () => a());
    const sb = Array.from({ length: 50 }, () => b());
    expect(sa).toEqual(sb);
    expect(sa.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it('different seeds give different streams', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it('fnv1a32 and unit are stateless', () => {
    expect(fnv1a32('ord-0001')).toBe(fnv1a32('ord-0001'));
    expect(unit('a', 1, 'b')).toBe(unit('a', 1, 'b'));
    expect(unit('a', 1, 'b')).not.toBe(unit('a', 2, 'b'));
  });

  it('matches the pinned reference values (the Python port must agree)', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
  });
});

describe('determinism: chaos schedule', () => {
  const run = (seed: string | number) => {
    const c = new RandomChaos({ seed, frequency: 1 });
    const out: (string | null)[] = [];
    for (let t = 0; t < 400; t++) {
      for (const lane of ['1', '2']) out.push(c.tick(lane, t % 2 ? 'charge' : 'intake', t * 1000)?.fault ?? null);
    }
    return out;
  };

  it('same seed and same timing give the same fault plan', () => {
    const a = run('wave-7');
    expect(a.filter((x) => x !== null).length).toBeGreaterThan(0);
    expect(run('wave-7')).toEqual(a);
    expect(run(7)).toEqual(run(7));
  });

  it('a different seed gives a different plan', () => {
    expect(run('wave-7')).not.toEqual(run('wave-8'));
  });

  it('boss plan is a pure function of its inputs', () => {
    const o = { wave: 3, orders: 12, speed: 4 };
    expect(planBoss(o)).toEqual(planBoss({ ...o }));
  });
});

describe('determinism: sweep', () => {
  it('cell seeds are pure and distinct per index', () => {
    expect(cellSeed(9, 3)).toBe(cellSeed(9, 3));
    const seeds = new Set(Array.from({ length: 40 }, (_, i) => cellSeed(9, i)));
    expect(seeds.size).toBe(40);
  });

  it('two sweeps with a fixed seed give byte-identical report JSON (acceptance P8)', async () => {
    const a = sweepReportJson(await runSweep(plan(), seededRunner, 11));
    const b = sweepReportJson(await runSweep(plan(), seededRunner, 11));
    expect(a).toBe(b);
  });

  it('a different seed can change the outcome mix', async () => {
    const a = sweepReportJson(await runSweep(plan(), seededRunner, 11));
    const seen = new Set<string>();
    for (const s of [1, 2, 3, 4, 5, 6]) seen.add(sweepReportJson(await runSweep(plan(), seededRunner, s)));
    seen.add(a);
    expect(seen.size).toBeGreaterThan(1);
  });

  it('report JSON carries no timestamp field', async () => {
    const json = sweepReportJson(await runSweep(plan(), seededRunner, 11));
    expect(json).not.toMatch(/generatedAt|timestamp/i);
  });

  it('wall-clock noise from a live runner (durations, times) never reaches the report JSON', async () => {
    const noisy: RunCell = (cell, seed) => {
      const base = seededRunner(cell, seed) as { outcome: CellOutcome; repeatedKinds?: string[] };
      return { ...base, durationMs: Math.random() * 1000, finishedAt: Date.now() } as never;
    };
    const a = sweepReportJson(await runSweep(plan(), noisy, 11));
    const b = sweepReportJson(await runSweep(plan(), noisy, 11));
    expect(a).toBe(b);
    expect(a).toBe(sweepReportJson(await runSweep(plan(), seededRunner, 11)));
    expect(a).not.toMatch(/durationMs|finishedAt/);
  });
});

describe('determinism: ramp', () => {
  const sim: RunRampStep = (c, orders, seed) => {
    const base = 100 * (c > 8 ? c / 4 : 1);
    const latenciesMs = Array.from({ length: orders }, (_, i) => base + Math.floor(unit('lat', seed, i) * 50));
    return { latenciesMs, failed: 0, durationMs: (orders / Math.min(c, 12)) * base };
  };

  it('two ramps with the same seed are identical, a different seed differs', async () => {
    const a = JSON.stringify(await runRamp(sim, { seed: 5 }));
    expect(JSON.stringify(await runRamp(sim, { seed: 5 }))).toBe(a);
    expect(JSON.stringify(await runRamp(sim, { seed: 6 }))).not.toBe(a);
  });
});

describe('determinism: report', () => {
  const input: ReportInput = {
    run: 'run-1',
    mode: 'sweep',
    seed: 7,
    app: 'orders',
    generatedAt: '2026-11-20T12:00:00Z',
    grade: 'C',
    reliability: 70,
    matrix: [
      { stage: 'pay', fault: 'crash', point: 'after', result: 'repeat', repeats: [{ kind: 'charge', extra: 1 }], evidenceSeq: [4] },
      { stage: 'intake', fault: 'timeout', result: 'pass', repeats: [], recoverMs: 900, evidenceSeq: [1] },
    ],
    recoveryMs: [900, 1200],
    repeats: [],
    lost: [],
    targets: [],
    findings: [],
  };

  it('stable JSON ignores generatedAt and input row order', () => {
    const a = renderJsonStable(buildReport(input));
    const b = renderJsonStable(buildReport({ ...input, generatedAt: 'later', matrix: [...input.matrix].reverse() }));
    expect(b).toBe(a);
  });
});
