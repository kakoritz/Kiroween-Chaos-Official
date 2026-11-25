import { describe, expect, it } from 'vitest';
import { allOutcomeRows, resolveOutcome, TIER_ORDER, type AppId, type EffectKind, type TierId } from '@haunt/shared';
import { planLane, type ArmSpec, type LanePlan } from '../src/sim/plan';
import { validateEvents } from '../../haunt/src/contract/validate';
import { assignSeq, toHauntEvents } from '../src/sim/wave';
import { decorateV11 } from '../src/sim/v11';

type Code = 'OK' | 'REPEAT' | 'FAILED' | 'HALT' | 'PARKED_OK' | 'QUAR' | 'CANCELLED';

function runOne(app: AppId, tier: TierId, fault: string, stage: string, point?: string, orders = 1): LanePlan {
  const arm: ArmSpec = { id: 'x', fault, source: 'sweep', point, when: { order: 1, stage, delay: 5 } };
  return planLane({ lane: 1, tier, app, seed: 7, orders, pace: 1 }, [arm]);
}

function classify(plan: LanePlan): { outcome: Code; extraRows: Record<string, number> } {
  const types = plan.events.map((e) => e.type);
  const extraRows: Record<string, number> = {};
  for (const e of plan.events) if (e.type === 'repeat') extraRows[e.detail.kind as EffectKind] = (extraRows[e.detail.kind as EffectKind] ?? 0) + 1;
  const total = Object.values(extraRows).reduce((a: number, b: number) => a + b, 0);
  let outcome: Code;
  if (types.includes('lane_halted')) outcome = 'HALT';
  else if (types.includes('order_quarantined')) outcome = 'QUAR';
  else if (plan.events.some((e) => e.type === 'order_failed' && e.detail.outcome === 'cancelled')) outcome = 'CANCELLED';
  else if (!types.includes('order_done')) outcome = 'FAILED';
  else if (types.includes('order_parked')) outcome = 'PARKED_OK';
  else outcome = total > 0 ? 'REPEAT' : 'OK';
  return { outcome, extraRows };
}

const R: Partial<Record<EffectKind, number>> = {};
// Every effect of the 11-step order: account, order (submit), charge, receipt, store (receive + process), shipment, notices.
const all5 = { account_create: 1, order: 1, charge: 1, email: 1, store: 2, dispatch: 1, notify: 2 };
const early = { account_create: 1, order: 1 };
type Cell = Code | [Code, Partial<Record<EffectKind, number>>];
// Acceptance table A, typed independently of the resolver (rows A1 to A21).
const TABLE_A: { id: string; fault: string; stage: string; point?: string; cells: Cell[] }[] = [
  { id: 'A1', fault: 'crash', stage: 'payment', point: 'before_effect', cells: [['REPEAT', early], ['REPEAT', early], 'OK', 'OK', 'OK'] },
  { id: 'A2', fault: 'crash', stage: 'payment', point: 'after_effect_before_journal', cells: [['REPEAT', { ...early, charge: 1 }], ['REPEAT', { ...early, charge: 1 }], ['REPEAT', { charge: 1 }], 'OK', 'OK'] },
  { id: 'A3', fault: 'crash', stage: 'payment', point: 'after_journal', cells: [['REPEAT', { ...early, charge: 1 }], ['REPEAT', { ...early, charge: 1 }], 'OK', 'OK', 'OK'] },
  { id: 'A4', fault: 'crash', stage: 'account', point: 'after_effect_before_journal', cells: [['REPEAT', { account_create: 1 }], ['REPEAT', { account_create: 1 }], ['REPEAT', { account_create: 1 }], 'OK', 'OK'] },
  // Account now comes first, so a bot with no journal repeats it when the process dies while it reads the input file.
  { id: 'A5', fault: 'crash', stage: 'create', point: 'mid_stage', cells: [['REPEAT', { account_create: 1 }], ['REPEAT', { account_create: 1 }], 'OK', 'OK', 'OK'] },
  { id: 'A5b', fault: 'crash', stage: 'account', point: 'before_effect', cells: ['OK', 'OK', 'OK', 'OK', 'OK'] },
  { id: 'A6', fault: 'crash', stage: 'transit', point: 'mid_stage', cells: [['REPEAT', all5], ['REPEAT', all5], 'OK', 'OK', 'OK'] },
  { id: 'A7', fault: 'power_outage', stage: 'payment', point: 'after_effect_before_journal', cells: [['REPEAT', { ...early, charge: 1 }], ['REPEAT', { ...early, charge: 1 }], ['REPEAT', { charge: 1 }], 'OK', 'OK'] },
  { id: 'A9', fault: 'timeout', stage: 'payment', cells: ['FAILED', ['REPEAT', { charge: 1 }], ['REPEAT', { charge: 1 }], 'OK', 'OK'] },
  { id: 'A10', fault: 'http_404', stage: 'payment', cells: ['FAILED', 'OK', 'OK', 'OK', 'OK'] },
  { id: 'A11', fault: 'http_500', stage: 'payment', cells: ['FAILED', 'OK', 'OK', 'OK', 'OK'] },
  { id: 'A12', fault: 'http_429', stage: 'payment', cells: ['FAILED', 'FAILED', 'FAILED', 'FAILED', 'OK'] },
  { id: 'A13', fault: 'internet_outage', stage: 'payment', cells: ['FAILED', 'FAILED', 'FAILED', 'FAILED', 'PARKED_OK'] },
  { id: 'A14', fault: 'endpoint_down', stage: 'payment', cells: ['FAILED', 'FAILED', 'FAILED', 'FAILED', 'PARKED_OK'] },
  { id: 'A15', fault: 'missing_file', stage: 'create', cells: ['HALT', 'FAILED', 'FAILED', 'FAILED', 'PARKED_OK'] },
  { id: 'A16', fault: 'malformed_payload', stage: 'create', cells: ['HALT', 'FAILED', 'FAILED', 'FAILED', 'QUAR'] },
  { id: 'A17', fault: 'duplicate_request', stage: 'create', cells: [['REPEAT', all5], ['REPEAT', all5], 'OK', 'OK', 'OK'] },
  { id: 'A18', fault: 'disk_full', stage: 'payment', cells: ['OK', 'OK', 'OK', 'OK', 'OK'] },
  { id: 'A19', fault: 'hazard_event', stage: 'transit', cells: ['FAILED', 'FAILED', 'FAILED', 'FAILED', 'OK'] },
  { id: 'A20', fault: 'driver_unreachable', stage: 'transit', cells: ['FAILED', 'FAILED', 'FAILED', 'FAILED', 'OK'] },
  { id: 'A21', fault: 'slow_link', stage: 'payment', cells: ['OK', 'OK', 'OK', 'OK', 'OK'] },
];

describe('acceptance table A', () => {
  for (const row of TABLE_A) {
    TIER_ORDER.forEach((tier, i) => {
      const cell = row.cells[i];
      const [code, rows] = typeof cell === 'string' ? [cell, R] : cell;
      it(`${row.id} ${tier}: ${code}`, () => {
        const o = resolveOutcome('orders', tier, row.fault, row.stage, row.point);
        expect(o?.outcome).toBe(code);
        expect(o?.extraRows).toEqual(rows);
        const plan = runOne('orders', tier, row.fault, row.stage, row.point);
        const got = classify(plan);
        expect(got.outcome).toBe(code);
        expect(got.extraRows).toEqual(rows);
      });
    });
  }
});

describe('planner agrees with the outcome table for every row', () => {
  for (const app of ['orders', 'inbox'] as AppId[]) {
    it(`${app}: every (tier, fault, stage, point)`, () => {
      const rows = allOutcomeRows(app);
      expect(rows.length).toBeGreaterThan(100);
      const bad: string[] = [];
      for (const r of rows) {
        const plan = runOne(app, r.tier, r.fault, r.stage, r.point);
        const got = classify(plan);
        if (got.outcome !== r.outcome || JSON.stringify(got.extraRows) !== JSON.stringify(r.extraRows)) {
          bad.push(`${r.tier} ${r.fault}@${r.stage}${r.point ? '/' + r.point : ''}: table ${r.outcome} ${JSON.stringify(r.extraRows)}, planner ${got.outcome} ${JSON.stringify(got.extraRows)}`);
        }
      }
      expect(bad.slice(0, 15)).toEqual([]);
    });
  }
});

describe('every planned stream is a valid contract stream', () => {
  for (const tier of TIER_ORDER) {
    it(`${tier}: single faults produce valid streams`, () => {
      const problems: string[] = [];
      for (const r of allOutcomeRows('orders')) {
        if (r.tier !== tier) continue;
        const plan = runOne('orders', tier, r.fault, r.stage, r.point, 2);
        const raw = toHauntEvents(plan, { app: 'orders', tier, lane: 1 });
        // Decision events exist only in contract v1.1, so that stream is checked as v1.1.
        const events = r.fault === 'order_typo' ? assignSeq(decorateV11(raw, { pace: 2 })) : raw;
        const v = validateEvents(events);
        if (v.length) problems.push(`${r.fault}@${r.stage}/${r.point ?? '-'}: [${v[0].rule}] seq ${v[0].seq} ${v[0].type}: ${v[0].message}`);
      }
      expect(problems.slice(0, 10)).toEqual([]);
    });
  }
});
