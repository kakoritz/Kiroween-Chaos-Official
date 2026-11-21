// Boss mode: hit the app with each boss once and grade whether it survived.
// Spec: engine design.md sections 8 (grading) and 9 (boss), runtime.md section 13, harness tasks.md H3.6.
import { BOSSES, type BossId } from '../chaos';
import type { CoreContext } from '../creatures/core';
import type { CreaturePlugin } from '../creatures/plugin';
import { faultBody } from '../runner/provider';
import { gradeOf, type Grade } from '../score/grade';
import { cellSeed, type CellDetail } from '../sweep/executor';
import { createLiveCellRunner, type LiveCellOptions } from '../sweep/live';
import type { CellOutcome } from '../sweep/matrix';

/** CLI name of each boss. */
export const BOSS_NAMES: Record<string, BossId> = {
  lich: 'boss_power_outage',
  banshee_queen: 'boss_internet_outage',
  horseman: 'boss_hazard_storm',
  headless_horseman: 'boss_hazard_storm',
};

/** Resolves a CLI name or a boss fault id. Returns null when unknown. */
export function parseBoss(name: string): BossId | null {
  if ((BOSSES as readonly string[]).includes(name)) return name as BossId;
  return BOSS_NAMES[name] ?? null;
}

/** Stage each boss is pressed at in the live run (the stage where it bites hardest). */
export const BOSS_STAGE: Record<BossId, string> = {
  boss_power_outage: 'payment',
  boss_internet_outage: 'payment',
  boss_hazard_storm: 'dispatch',
};

export interface BossPlan { bosses: BossId[] }

/** Plans a boss run. With no filter, each boss once in catalog order. */
export function planBoss(only?: readonly string[]): BossPlan {
  if (!only || only.length === 0) return { bosses: [...BOSSES] };
  const out: BossId[] = [];
  for (const n of only) {
    const b = parseBoss(n);
    if (!b) throw new Error(`unknown boss "${n}"`);
    if (!out.includes(b)) out.push(b);
  }
  return { bosses: out };
}

export type RunBoss = (boss: BossId, seed: number) => Promise<CellOutcome | CellDetail> | CellOutcome | CellDetail;

export interface BossResult { boss: BossId; outcome: CellOutcome; survived: boolean; repeatedKinds?: string[]; lost?: boolean; error?: string }

export interface BossReport {
  seed: number;
  results: BossResult[];
  reliability: number;
  grade: Grade;
  /** True when every boss was survived with no repeated side effect and no lost order. */
  passed: boolean;
}

const survives = (o: CellOutcome): boolean => o === 'pass' || o === 'recovered_late';

export async function runBoss(plan: BossPlan, run: RunBoss, seed = 1): Promise<BossReport> {
  const results: BossResult[] = [];
  for (let i = 0; i < plan.bosses.length; i++) {
    const boss = plan.bosses[i];
    let outcome: CellOutcome;
    let detail: Partial<CellDetail> = {};
    let error: string | undefined;
    try {
      const r = await run(boss, cellSeed(seed, i));
      if (typeof r === 'string') outcome = r;
      else { outcome = r.outcome; detail = r; }
    } catch (e) {
      outcome = 'fail';
      error = e instanceof Error ? e.message : String(e);
    }
    results.push({
      boss, outcome, survived: survives(outcome),
      ...(detail.repeatedKinds?.length ? { repeatedKinds: detail.repeatedKinds } : {}),
      ...(detail.lost ? { lost: true } : {}),
      ...(error ? { error } : {}),
    });
  }
  const clean = results.filter((r) => r.survived).length;
  const { reliability, grade } = gradeOf({
    orders: results.length, clean, parkedResumed: 0, quarantined: 0,
    extraRows: results.filter((r) => r.outcome === 'repeat').length,
    chargeRepeated: results.some((r) => r.repeatedKinds?.includes('charge')),
    halted: results.some((r) => r.outcome === 'halt'),
    lostOrders: results.filter((r) => r.lost).length,
  });
  const passed = results.length > 0 && results.every((r) => r.survived && !r.lost && !r.repeatedKinds?.length);
  return { seed, results, reliability, grade, passed };
}

export function bossReportJson(r: BossReport): string {
  return JSON.stringify(r, null, 2) + '\n';
}

export function renderBoss(r: BossReport): string {
  const lines = r.results.map((x) => `${x.survived ? 'survived' : 'DEFEATED'} ${x.boss}: ${x.outcome}${x.repeatedKinds?.length ? ` (repeated ${x.repeatedKinds.join(', ')})` : ''}${x.lost ? ' (lost order)' : ''}`);
  return [...lines, `reliability ${r.reliability}, grade ${r.grade}`, r.passed ? 'boss PASS' : 'boss FAIL'].join('\n');
}

/**
 * Live boss creatures. A boss hits every lane at once; the live adapter runs one lane, so each boss presses its
 * fault set on that lane through the cell context (power outage crashes, internet outage drops every service,
 * hazard storm stalls tracking and rate-limits dispatch).
 */
export function liveBossCreatures(speed: number): CreaturePlugin[] {
  const scale = (ms: number): number => Math.max(50, Math.round(ms / speed));
  const mk = (id: string, label: string, family: CreaturePlugin['family'], fault: BossId, press: (c: CoreContext) => Promise<void>): CreaturePlugin => ({
    id, label, family, faults: [fault],
    async inject(ctx) { await press(ctx as CoreContext); },
  });
  const post = async (c: CoreContext, stage: string, fault: string, forMs?: number): Promise<void> => {
    const body = faultBody(c.lane, stage, { id: 0, fault, ...(forMs !== undefined ? { forMs } : {}) });
    if (!body || !c.postFault) throw new Error(`boss cannot post "${fault}"`);
    await c.postFault(body);
  };
  return [
    mk('lich', 'Lich', 'process', 'boss_power_outage', async (c) => {
      if (!c.armProcess) throw new Error('boss context is missing armProcess');
      await c.armProcess('power_outage');
    }),
    mk('banshee_queen', 'Banshee Queen', 'network', 'boss_internet_outage', (c) => post(c, 'payment', 'internet_outage', scale(12000))),
    mk('headless_horseman', 'Headless Horseman', 'world', 'boss_hazard_storm', async (c) => {
      await post(c, 'tracking', 'hazard_event', scale(5000));
      await post(c, 'dispatch', 'http_429');
    }),
  ];
}

const CREATURE_OF: Record<BossId, string> = {
  boss_power_outage: 'lich',
  boss_internet_outage: 'banshee_queen',
  boss_hazard_storm: 'headless_horseman',
};

/** Live runner: runs each boss against the real bot on one lane and reads the ledger. */
export function createLiveBossRunner(o: LiveCellOptions): RunBoss {
  const cell = createLiveCellRunner({ ...o, creatures: [...o.creatures, ...liveBossCreatures(o.speed ?? 4)] });
  return (boss, seed) => cell({ stage: BOSS_STAGE[boss], creature: CREATURE_OF[boss], fault: boss }, seed);
}
