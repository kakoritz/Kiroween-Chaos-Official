import { describe, expect, it } from 'vitest';
import { applyEvent, emptyVM, newLane, reconcileLedger, type ArenaVM } from '../src/arena/model';
import { cellView, DEFAULT_KINDS, kindLabel, ledgerKinds, rankLanes, stateIcon } from '../src/arena/panels';
import type { ArenaEvent } from '../src/api/types';

const ev = (type: string, lane: number | undefined, detail: Record<string, unknown> = {}): ArenaEvent => ({ seq: 1, ts: 0, type, wave: 1, ...(lane ? { lane } : {}), detail });
const vm2 = (): ArenaVM => {
  const vm = emptyVM();
  applyEvent(vm, ev('wave_start', undefined, { lanes: 3 }), 0);
  return vm;
};

describe('rank board', () => {
  it('sorts by score, then fewer repeats, then lane number', () => {
    const a = newLane(1, 0, 0), b = newLane(2, 0, 0), c = newLane(3, 0, 0);
    a.score = 100; b.score = 100; c.score = 250;
    b.counts.repeats = 2; a.counts.repeats = 3;
    expect(rankLanes([a, b, c]).map((l) => l.lane)).toEqual([3, 2, 1]);
    a.counts.repeats = 2;
    expect(rankLanes([b, a, c]).map((l) => l.lane)).toEqual([3, 1, 2]);
  });
  it('does not mutate its input', () => {
    const a = newLane(1, 0, 0), b = newLane(2, 0, 0); b.score = 5;
    const input = [a, b]; rankLanes(input);
    expect(input[0]).toBe(a);
  });
  it('maps states to distinct icons', () => {
    const icons = new Set(['dead', 'halted', 'done', 'working', 'idle'].map((m) => stateIcon(m as never).icon));
    expect(icons.size).toBe(5);
  });
  it('follows score events', () => {
    const vm = vm2();
    applyEvent(vm, ev('score', 2, { delta: 25, total: 25, reason: 'x' }), 1);
    applyEvent(vm, ev('score', 1, { delta: -150, total: -150, reason: 'x' }), 1);
    expect(rankLanes(vm.lanes).map((l) => l.lane)).toEqual([2, 3, 1]);
  });
});

describe('ledger', () => {
  it('counts new rows and ignores replayed effects', () => {
    const vm = vm2();
    applyEvent(vm, ev('effect', 1, { kind: 'charge', key: 'k1', replayed: false }), 1);
    applyEvent(vm, ev('effect', 1, { kind: 'charge', key: 'k1', replayed: true }), 2);
    expect(cellView(vm.lanes[0]!, 'charge').text).toBe('1');
  });
  it('shows repeats once per extra row and flashes', () => {
    const vm = vm2();
    for (let i = 0; i < 3; i++) applyEvent(vm, ev('effect', 1, { kind: 'charge', key: 'k1', replayed: false }), 1);
    applyEvent(vm, ev('repeat', 1, { kind: 'charge', key: 'k1', count: 2 }), 5);
    applyEvent(vm, ev('repeat', 1, { kind: 'charge', key: 'k1', count: 3 }), 6);
    applyEvent(vm, ev('repeat', 1, { kind: 'charge', key: 'k1', count: 3 }), 7);
    const c = cellView(vm.lanes[0]!, 'charge');
    expect(c).toMatchObject({ rows: 3, repeats: 2, dup: true, text: '3 +2' });
    expect(vm.lanes[0]!.flash.charge).toBe(7);
  });
  it('columns: default for the orders app, seen kinds in canonical order', () => {
    const vm = vm2();
    expect(ledgerKinds(vm)).toEqual(DEFAULT_KINDS);
    applyEvent(vm, ev('effect', 1, { kind: 'ticket', key: 't', replayed: false }), 1);
    applyEvent(vm, ev('effect', 1, { kind: 'email', key: 'e', replayed: false }), 1);
    expect(ledgerKinds(vm)).toEqual(['email', 'ticket']);
  });
  it('ledger columns of the 11-step order: Accounts, Orders, Charges, Receipts, Store, Shipments, Notices', () => {
    const vm = vm2();
    expect(DEFAULT_KINDS).toEqual(['account_create', 'order', 'charge', 'email', 'store', 'dispatch', 'notify']);
    for (const kind of ['notify', 'store', 'order', 'dispatch', 'email', 'charge', 'account_create']) applyEvent(vm, ev('effect', 1, { kind, key: kind, replayed: false }), 1);
    const kinds = ledgerKinds(vm);
    expect(kinds).toEqual(DEFAULT_KINDS);
    expect(kinds.map((k) => kindLabel(k, true))).toEqual(['Accounts', 'Orders', 'Charges', 'Receipts', 'Store', 'Shipments', 'Notices']);
    // The inbox app has no charge column: its email stays "Emails".
    expect(kindLabel('email')).toBe('Emails');
  });
  it('reconciles with the server ledger', () => {
    const vm = vm2();
    applyEvent(vm, ev('effect', 2, { kind: 'charge', key: 'a', replayed: false }), 1);
    reconcileLedger(vm, { lanes: [{ lane: 2, byKind: { charge: { rows: 4, repeats: 1 } } }, { lane: 9, byKind: {} }] });
    expect(cellView(vm.lanes[1]!, 'charge').text).toBe('4 +1');
    reconcileLedger(vm, null);
  });
});

describe('ledger warning (BUG b)', () => {
  it('shows the warning only on lanes with repeats > 0, never on Phoenix with a clean ledger', () => {
    const vm = emptyVM();
    applyEvent(vm, ev('wave_start', undefined, { lanes: 5 }), 0);
    for (let lane = 1; lane <= 5; lane++) {
      applyEvent(vm, ev('effect', lane, { kind: 'charge', key: 'ord-0001:charge', replayed: false }), 1);
      applyEvent(vm, ev('effect', lane, { kind: 'account_create', key: 'ord-0001:account', replayed: false }), 1);
    }
    // Rookie (lane 1) repeats the charge; Phoenix (lane 5) replays are idempotent and emit no repeat.
    applyEvent(vm, ev('effect', 1, { kind: 'charge', key: 'ord-0001:charge', replayed: false }), 2);
    applyEvent(vm, ev('repeat', 1, { kind: 'charge', key: 'ord-0001:charge', count: 2 }), 2);
    applyEvent(vm, ev('effect', 5, { kind: 'charge', key: 'ord-0001:charge', replayed: true }), 2);
    reconcileLedger(vm, { lanes: vm.lanes.map((l) => ({ lane: l.lane, byKind: { charge: { rows: l.lane === 1 ? 2 : 1, repeats: l.lane === 1 ? 1 : 0 }, account_create: { rows: 1, repeats: 0 } } })) });
    const dup = (lane: number, kind: string) => cellView(vm.lanes.find((l) => l.lane === lane)!, kind).dup;
    expect(dup(1, 'charge')).toBe(true);
    expect(dup(1, 'account_create')).toBe(false);
    for (const lane of [2, 3, 4, 5]) for (const k of ['charge', 'account_create']) expect(dup(lane, k)).toBe(false);
    expect(vm.lanes.find((l) => l.lane === 5)!.counts.repeats).toBe(0);
  });
});
