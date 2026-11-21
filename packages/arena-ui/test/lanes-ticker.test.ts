import { describe, expect, it } from 'vitest';
import { FAST_SHOW_MS, LaneTickerModel, MAX_QUEUE, MIN_SHOW_MS, bossMessage, laneMessage } from '../src/arena/lanes-ticker';
import type { ArenaEvent } from '../src/api/types';

const ev = (type: string, extra: Partial<ArenaEvent> = {}): ArenaEvent => ({ seq: 1, ts: 0, type, lane: 1, ...extra });
const label = (id: string) => id[0]!.toUpperCase() + id.slice(1);

describe('laneMessage', () => {
  it('builds the v2 templates', () => {
    expect(laneMessage(ev('order_start', { order: 'A1' }), label)?.text).toBe('grabbed order A1');
    expect(laneMessage(ev('stage_done', { stage: 'payment', detail: { attempts: 3 } }), label)?.text).toBe('passed Payment after 2 retries');
    expect(laneMessage(ev('review', { detail: { stars: 4.5, text: 'Lightning fast' } }), label)?.text).toBe('\u2605 4.5 "Lightning fast"');
    expect(laneMessage(ev('decision_needed', { detail: { detectedAt: 'confirmation' } }), label)?.text).toBe('WRONG ORDER at Confirmation: choose');
    expect(laneMessage(ev('score', { detail: { reason: 'downtime', delta: -2 } }), label)?.text).toBe('downtime -2');
    expect(laneMessage(ev('order_failed'), label)).toMatchObject({ tone: 'error', text: 'ORDER CANCELLED' });
  });
  it('stays quiet for trivial events', () => {
    expect(laneMessage(ev('stage_done', { stage: 'payment' }), label)).toBeNull();
    expect(laneMessage(ev('stage_done', { stage: 'payment', detail: { skipped: true, attempts: 4 } }), label)).toBeNull();
    expect(laneMessage(ev('score', { detail: { reason: 'order done', delta: 50 } }), label)).toBeNull();
    expect(laneMessage(ev('stage_progress'), label)).toBeNull();
  });
  it('colours reviews by stars', () => {
    expect(laneMessage(ev('review', { detail: { stars: 5 } }), label)?.tone).toBe('good');
    expect(laneMessage(ev('review', { detail: { stars: 3 } }), label)?.tone).toBe('warn');
    expect(laneMessage(ev('review', { detail: { stars: 1 } }), label)?.tone).toBe('error');
  });
  it('has boss messages', () => {
    expect(bossMessage(ev('boss_warning'))?.text).toBe('Boss incoming');
    expect(bossMessage(ev('order_start'))).toBeNull();
  });
});

describe('LaneTickerModel', () => {
  const start = (n: string) => ev('order_start', { order: n });
  it('shows the first message at once and queues the rest for 1.8 s', () => {
    const m = new LaneTickerModel(label);
    m.push(start('A1'), 0);
    expect(m.row(1).cur?.text).toBe('grabbed order A1');
    m.push(ev('order_done', { order: 'A1' }), 100);
    expect(m.step(1799)).toBe(false);
    expect(m.row(1).cur?.text).toBe('grabbed order A1');
    expect(m.step(1800)).toBe(true);
    expect(m.row(1).cur?.text).toBe('order A1 delivered');
    expect(MIN_SHOW_MS).toBe(1800);
  });
  it('fast-forwards when more than one is waiting and caps the queue', () => {
    const m = new LaneTickerModel(label);
    m.push(start('A1'), 0);
    for (let i = 0; i < 6; i++) m.push(ev('stage_fail', { stage: 'payment' }), 10);
    expect(m.row(1).queue.length).toBe(MAX_QUEUE);
    expect(m.step(FAST_SHOW_MS - 1)).toBe(false);
    expect(m.step(FAST_SHOW_MS)).toBe(true);
    expect(m.row(1).queue.length).toBe(MAX_QUEUE - 1);
  });
  it('keeps lanes independent and counts issues per order', () => {
    const m = new LaneTickerModel(label);
    m.push(start('A1'), 0);
    m.push(ev('stage_fail', { stage: 'payment' }), 5);
    m.push(ev('stage_fail', { stage: 'payment', lane: 2 }), 5);
    m.push(ev('chaos_absorbed', { stage: 'payment' }), 6);
    expect(m.row(1).issues).toBe(1);
    expect(m.row(2).issues).toBe(1);
    m.push(start('A2'), 10);
    expect(m.row(1).issues).toBe(0);
    expect(m.row(2).issues).toBe(1);
  });
  it('shows boss messages on every known lane and clears on reset', () => {
    const m = new LaneTickerModel(label);
    m.row(1); m.row(2);
    m.push({ seq: 1, ts: 0, type: 'boss_start' }, 0);
    expect(m.row(1).cur?.text).toBe('Boss attack');
    expect(m.row(2).cur?.text).toBe('Boss attack');
    m.push({ seq: 2, ts: 0, type: 'reset' }, 1);
    expect(m.rows.size).toBe(0);
  });
});
