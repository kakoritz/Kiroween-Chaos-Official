// EPIC 1 part B: the inbox path of the live stream must pass the contract validator (R19, R-breaker, schema).
import { describe, expect, it } from 'vitest';
import { DetailNormalizer } from '../src/live/normalize';
import { RunnerEngine } from '../../haunt/src/runner/engine';
import { INBOX_STAGES, ORDERS_STAGES } from '../../haunt/src/shared/catalog';
import { validateEvents } from '../../haunt/src/contract/validate';

type Ev = Record<string, any>;
const shapeAll = (evs: Ev[]): Ev[] => {
  const n = new DetailNormalizer(() => 0);
  n.begin(1);
  return evs.flatMap((e) => n.shape('1', e));
};

describe('inbox stage list (R19)', () => {
  it('an inbox wave after an orders hello is checked against the inbox stages', () => {
    const view = (defs: typeof ORDERS_STAGES) => defs.map((d) => ({ id: d.id, label: d.label, kind: 'effect' }));
    const events: Ev[] = [
      { seq: 1, ts: 1, type: 'hello', contractVersion: 1, mode: 'live', app: 'orders', stages: view(ORDERS_STAGES) },
      { seq: 2, ts: 2, type: 'wave_start', wave: 1, detail: { orders: 1, seed: 1, tiers: 'race', lanes: 1, speed: 4, app: 'inbox', pace: 'normal' } },
      { seq: 3, ts: 3, type: 'lane_ready', wave: 1, lane: 1, detail: { tier: 'rookie', label: 'Rookie', parts: [] } },
      { seq: 4, ts: 4, type: 'order_start', wave: 1, lane: 1, order: 'msg-0001', detail: { index: 1, total: 1 } },
      { seq: 5, ts: 5, type: 'stage_start', wave: 1, lane: 1, order: 'msg-0001', stage: 'login', detail: { attempt: 1 } },
    ];
    expect(validateEvents(events as never, { requireWaveEnd: false }).filter((v) => v.rule === 'R19')).toEqual([]);
    expect(INBOX_STAGES[0]!.id).toBe('login');
  });
});

describe('inbox bot messages on the wire', () => {
  it('drops a bot-private message that is not a contract event (desk_fault)', () => {
    expect(shapeAll([{ type: 'desk_fault', order: 'msg-0001', detail: { mode: 'x', provider: 'ticket' } }])).toEqual([]);
  });

  it('a restarted bot reporting an open breaker the wire already shows open is not a second transition', () => {
    const out = shapeAll([
      { type: 'breaker', order: 'a', detail: { service: 'notify', state: 'open' } },
      { type: 'process_dead' }, { type: 'process_up' },
      { type: 'breaker', order: 'b', detail: { service: 'notify', state: 'open' } },
      { type: 'breaker', order: 'b', detail: { service: 'notify', state: 'half_open' } },
      { type: 'breaker', order: 'b', detail: { service: 'ticket', state: 'open' } },
    ]);
    expect(out.filter((e) => e.type === 'breaker').map((e) => `${e.detail.service}:${e.detail.state}`)).toEqual(['notify:open', 'notify:half_open', 'ticket:open']);
  });
});

describe('engine chaos on the inbox', () => {
  const run = (app: string, fault: string, req: Record<string, unknown> = {}): Ev[] => {
    const out: Ev[] = [];
    const eng = new RunnerEngine();
    eng.startWave(1, { orders: 2, seed: 3, tiers: 'race', lanes: 1, speed: 4, pace: 'normal', app }, (e) => { out.push(e as Ev); });
    eng.chaos({ lane: 1, fault, ...req });
    return out;
  };

  it('a hand-pressed chaos carries the contract source "user"', () => {
    const chaos = run('inbox', 'crash').find((e) => e.type === 'chaos')!;
    expect(chaos.detail.source).toBe('user');
  });

  it('an outage deferred to an orders-only stage names no stage in an inbox wave, and keeps it in an orders wave', () => {
    const inbox = run('inbox', 'weather').find((e) => e.type === 'outage')!;
    expect(inbox.stage).toBeUndefined();
    const orders = run('orders', 'weather').find((e) => e.type === 'outage')!;
    expect(orders.stage).toBe('transit');
  });
});
