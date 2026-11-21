import { describe, expect, it } from 'vitest';
import { tickerLine } from '../src/arena/ticker';
import type { ArenaEvent } from '../src/api/types';

const ev = (type: string, extra: Partial<ArenaEvent> = {}): ArenaEvent => ({ seq: 1, ts: 0, type, ...extra });
const label = (id: string) => id.toUpperCase();

describe('tickerLine', () => {
  it('formats notable events with an icon and lane', () => {
    expect(tickerLine(ev('order_done', { lane: 2, order: 'A1' }), label)).toMatchObject({ tone: 'ok', text: 'L2 order A1 done' });
    expect(tickerLine(ev('stage_fail', { lane: 1, stage: 'payment' }), label)).toMatchObject({ tone: 'bad', text: 'L1 PAYMENT failed' });
    expect(tickerLine(ev('process_dead', { lane: 3 }), label)?.icon).toBeTruthy();
  });
  it('skips chatty events', () => {
    for (const t of ['stage_progress', 'effect', 'score', 'stage_start', 'hello']) expect(tickerLine(ev(t), label)).toBeNull();
  });
});
