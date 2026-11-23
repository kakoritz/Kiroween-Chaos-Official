import { describe, expect, it } from 'vitest';
import { laneMessage } from '../src/arena/lanes-ticker';
import { tickerLine } from '../src/arena/ticker';
import { logEntries } from '../src/arena/lane-popup-model';
import { applyEvent, emptyVM, loadSnapshot, reconcileLedger } from '../src/arena/model';
import { appIdOf, displayId } from '../src/arena/vocab';
import type { ArenaEvent } from '../src/api/types';

const label = (id: string) => id;
const ev = (type: string, extra: Partial<ArenaEvent> = {}): ArenaEvent => ({ type, lane: 1, order: 'ord-0003', ts: 1, seq: 1, ...extra } as ArenaEvent);

describe('app-aware wording', () => {
  it('orders keep their words', () => {
    expect(laneMessage(ev('order_start'), label)?.text).toBe('grabbed order ord-0003');
    expect(laneMessage(ev('order_done'), label)?.text).toBe('order ord-0003 delivered');
    expect(tickerLine(ev('order_done'), label)?.text).toBe('L1 order ord-0003 done');
  });
  it('inbox talks tickets', () => {
    const texts = [laneMessage(ev('order_start'), label, 'inbox'), laneMessage(ev('order_done'), label, 'inbox'), laneMessage(ev('order_failed'), label, 'inbox'), laneMessage(ev('order_parked'), label, 'inbox'),
      tickerLine(ev('order_start'), label, 'inbox'), tickerLine(ev('order_failed'), label, 'inbox')].map((m) => m?.text ?? '');
    expect(texts).toEqual(['picked up ticket tkt-0003', 'ticket tkt-0003 resolved', 'TICKET CANCELLED', 'ticket parked', 'L1 ticket tkt-0003 started', 'L1 ticket tkt-0003 failed']);
    expect(texts.join(' ')).not.toMatch(/order|grabbed|delivered/i);
  });
  it('popup log', () => {
    expect(logEntries([ev('order_done')], label, 'inbox')[0]?.text).toBe('Ticket tkt-0003 resolved');
    expect(logEntries([ev('order_done')], label)[0]?.text).toBe('Order ord-0003 delivered');
  });
  it('ids and app id', () => {
    expect(displayId('inbox', 'msg-0012')).toBe('tkt-0012');
    expect(displayId('orders', 'ord-0012')).toBe('ord-0012');
    expect(appIdOf({ id: 'inbox', stages: [] })).toBe('inbox');
    expect(appIdOf('weird')).toBe('orders');
    const vm = emptyVM();
    loadSnapshot(vm, { app: { id: 'inbox', stages: [{ id: 'login', label: 'SSO login' }] }, lanes: [] } as never, 0);
    expect(vm.app).toBe('inbox');
  });
  it('ledger reconcile merges provider kinds, no duplicate account column', () => {
    const vm = emptyVM();
    loadSnapshot(vm, { app: 'orders', stages: [{ id: 'account', label: 'A', icon: '', workAnimation: '' }], lanes: [{ lane: 1, tier: 'rookie', label: '', parts: [], state: 'idle', order: null, orderIndex: 0, ordersTotal: 0, stageIndex: 0, score: 0, counts: { completed: 0, failed: 0, parked: 0, quarantined: 0, repeats: 0 }, depth: 0 }] } as never, 0);
    applyEvent(vm, ev('effect', { detail: { kind: 'account_create', key: 'k' } }), 0);
    reconcileLedger(vm, { lanes: [{ lane: 1, byKind: { account: { rows: 3, repeats: 1 }, charge: { rows: 2, repeats: 0 } } }] });
    expect(Object.keys(vm.lanes[0]!.ledger).sort()).toEqual(['account_create', 'charge']);
    expect(vm.lanes[0]!.ledger.account_create).toEqual({ rows: 3, repeats: 1 });
  });
});
