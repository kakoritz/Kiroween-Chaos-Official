import { describe, expect, it } from 'vitest';
import { DetailNormalizer, SettleGate } from '../src/live/normalize';
import { createLiveRuntime } from '../src/live';
import { RunnerEngine } from '../../haunt/src/runner/engine';

type Ev = Record<string, any>;
const shapeAll = (evs: Ev[], lane = '1'): Ev[] => {
  const n = new DetailNormalizer(() => 0);
  n.begin(2);
  return evs.flatMap((e) => n.shape(lane, e));
};

describe('wire shaping of bot events (PROTOCOL.md rules 6, 13, 27, 29)', () => {
  it('a tier with no journal gets a restart pair, the repeated order_start is dropped and attempt keeps counting', () => {
    const out = shapeAll([
      { type: 'order_start', order: 'ord-0001' },
      { type: 'stage_start', order: 'ord-0001', stage: 'create' },
      { type: 'process_dead' },
      { type: 'process_up' },
      { type: 'order_start', order: 'ord-0001' },
      { type: 'stage_start', order: 'ord-0001', stage: 'create' },
    ]);
    expect(out.map((e) => e.type)).toEqual(['order_start', 'stage_start', 'process_dead', 'process_up', 'recover_start', 'recover_done', 'stage_start']);
    expect(out[4]!.detail).toMatchObject({ action: 'restart' });
    expect(out[5]!.detail).toMatchObject({ action: 'restart' });
    expect(out[6]!.detail.attempt).toBe(2);
  });

  it('a replay gets a stage_start before each skipped stage_done and recover_done carries its pair action', () => {
    const out = shapeAll([
      { type: 'order_start', order: 'ord-0001' },
      { type: 'stage_start', order: 'ord-0001', stage: 'create' },
      { type: 'process_dead' },
      { type: 'process_up' },
      { type: 'order_start', order: 'ord-0001' },
      { type: 'recover_start', order: 'ord-0001', detail: { action: 'replay' } },
      { type: 'stage_done', order: 'ord-0001', stage: 'create', detail: { skipped: true } },
      { type: 'recover_start', order: 'ord-0001', detail: { action: 'reconcile' } },
      { type: 'recover_done', order: 'ord-0001', detail: { action: 'reconciled' } },
      { type: 'recover_done', order: 'ord-0001', detail: { action: 'replay' } },
    ]);
    expect(out.map((e) => e.type)).toEqual([
      'order_start', 'stage_start', 'process_dead', 'process_up', 'recover_start',
      'stage_start', 'stage_done', 'recover_start', 'recover_done', 'recover_done',
    ]);
    expect(out[5]).toMatchObject({ stage: 'create', detail: { attempt: 2 } });
    expect(out[8]!.detail.action).toBe('reconcile');
    expect(out[9]!.detail.action).toBe('replay');
  });
});

describe('settle gate (PROTOCOL.md rules 7, 10, 20)', () => {
  it('holds boss_end until lanes settle and absorbs chaos that never fired at wave end', () => {
    const seen: Ev[] = [];
    const g = new SettleGate((e) => seen.push(e));
    g.push({ type: 'boss_start' });
    g.push({ type: 'chaos', lane: '1', detail: { creature: 'wraith', fault: 'power_outage' } });
    g.push({ type: 'process_dead', lane: '1' });
    g.push({ type: 'boss_end' });
    expect(seen.map((e) => e.type)).toEqual(['boss_start', 'chaos', 'process_dead']);
    g.push({ type: 'process_up', lane: '1' });
    expect(seen.at(-1)!.type).toBe('boss_end');
    g.push({ type: 'chaos', lane: '2', detail: { creature: 'ghost', fault: 'http_404' } });
    g.finish();
    expect(seen.at(-1)).toMatchObject({ type: 'chaos_absorbed', lane: '2', detail: { creature: 'ghost', fault: 'http_404' } });
  });
});

describe('ledger rows on the live stream (PROTOCOL.md rule 8)', () => {
  it('emits an effect per row with the contract kind, and a repeat right after the effect that caused it', () => {
    const rt = createLiveRuntime({ clock: false });
    const evs: Ev[] = [];
    rt.live.startWave!(1, { orders: 1, seed: 1, tiers: 'race', lanes: 1, speed: 1, pace: 'normal', app: 'orders' }, (e) => evs.push(e as Ev), () => {});
    const row = { id: 'acct_1', lane: '1', kind: 'account' as const, order: 'ord-0001', key: null, amount: null, index: null, ts: 1 };
    rt.ledgerRow(row);
    rt.ledgerRow({ ...row, id: 'acct_2' });
    rt.ledgerRow(row, true);
    expect(evs.map((e) => e.type)).toEqual(['effect', 'effect', 'repeat', 'effect']);
    expect(evs[0]!.detail).toEqual({ kind: 'account_create', key: 'ord-0001:account', replayed: false });
    expect(evs[2]!.detail).toMatchObject({ kind: 'account_create', count: 2 });
    expect(evs[3]!.detail.replayed).toBe(true);
  });

  it('chaos without a creature gets the creature that owns the fault', () => {
    const evs: Ev[] = [];
    const e = new RunnerEngine();
    e.startWave(1, { orders: 1, seed: 1, tiers: 'race', lanes: 1, speed: 1, pace: 'normal', app: 'orders' }, (ev) => evs.push(ev as Ev));
    const r = e.chaos({ lane: 1, fault: 'power_outage', source: 'random' });
    expect(r.creature).toBe('wraith');
    expect(evs.find((x) => x.type === 'chaos')!.detail.creature).toBe('wraith');
  });
});

describe('stage on park, fail and resume; skipped only for a bare pair (PROTOCOL.md rules 3, 11, 23, 27)', () => {
  it('order_parked, order_failed and order_resumed carry the stage the order was in', () => {
    const out = shapeAll([
      { type: 'order_start', order: 'ord-0001' },
      { type: 'stage_start', order: 'ord-0001', stage: 'payment' },
      { type: 'order_parked', order: 'ord-0001', detail: { reason: 'breaker_open' } },
      { type: 'order_resumed', order: 'ord-0001' },
      { type: 'order_start', order: 'ord-0001' },
      { type: 'stage_start', order: 'ord-0001', stage: 'submit' },
      { type: 'order_failed', order: 'ord-0001', detail: { reason: 'boom' } },
    ]);
    const by = (t: string) => out.find((e) => e.type === t)!;
    expect(by('order_parked').detail).toMatchObject({ stage: 'payment', reason: 'breaker_open' });
    expect(by('order_resumed').detail).toMatchObject({ stage: 'payment' });
    expect(by('order_failed').detail).toMatchObject({ stage: 'submit', error: 'boom' });
  });

  it('a skipped stage_done after progress does not get a second stage_start and is not a skip', () => {
    const out = shapeAll([
      { type: 'order_start', order: 'ord-0001' },
      { type: 'stage_start', order: 'ord-0001', stage: 'submit' },
      { type: 'stage_progress', order: 'ord-0001', stage: 'submit', detail: { pct: 10 } },
      { type: 'stage_done', order: 'ord-0001', stage: 'submit', detail: { skipped: true } },
    ]);
    expect(out.filter((e) => e.type === 'stage_start')).toHaveLength(1);
    expect(out.at(-1)!.detail.skipped).toBe(false);
  });

  it('a bare replayed pair stays skipped', () => {
    const out = shapeAll([
      { type: 'order_start', order: 'ord-0001' },
      { type: 'stage_done', order: 'ord-0001', stage: 'create', detail: { skipped: true } },
    ]);
    expect(out.map((e) => e.type)).toEqual(['order_start', 'stage_start', 'stage_done']);
    expect(out[2]!.detail.skipped).toBe(true);
  });
});
