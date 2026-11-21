import { describe, expect, it } from 'vitest';
import { applyEvent, emptyVM } from '../src/arena/model';
import { DROP_MS, dropPoint, dropProgress, queueLeft, queueShape } from '../src/arena/order';
import type { ArenaEvent } from '../src/api/types';

const ev = (type: string, lane: number | undefined, extra: Partial<ArenaEvent> = {}): ArenaEvent => ({ seq: 1, ts: 0, type, wave: 1, ...(lane ? { lane } : {}), ...extra });

describe('parchment orders (UI-S6)', () => {
  it('queue excludes the order in hand and caps the drawn scrolls', () => {
    expect(queueLeft(1, 12)).toBe(11);
    expect(queueLeft(12, 12)).toBe(0);
    expect(queueLeft(0, 0)).toBe(0);
    expect(queueShape(11)).toEqual({ shown: 4, more: 7 });
    expect(queueShape(2)).toEqual({ shown: 2, more: 0 });
  });

  it('order_start stamps a drop and each new order restarts it', () => {
    const vm = emptyVM();
    applyEvent(vm, ev('wave_start', undefined, { detail: { lanes: 1, speed: 1 } }), 0);
    applyEvent(vm, ev('order_start', 1, { order: 'ord-0001', detail: { index: 1, total: 5 } }), 100);
    expect(vm.lanes[0]!.orderDrop).toEqual({ since: 100 });
    applyEvent(vm, ev('order_start', 1, { order: 'ord-0002', detail: { index: 2, total: 5 } }), 900);
    expect(vm.lanes[0]!.orderDrop).toEqual({ since: 900 });
    expect(queueLeft(vm.lanes[0]!.orderIndex, vm.lanes[0]!.ordersTotal)).toBe(3);
  });

  it('drop progress runs 0..1 scaled by speed, and is skipped for reduced motion', () => {
    const d = { since: 1000 };
    expect(dropProgress(d, 1000 + DROP_MS / 2)).toBeCloseTo(0.5);
    expect(dropProgress(d, 1000 + DROP_MS / 4, 2)).toBeCloseTo(0.5);
    expect(dropProgress(d, 1000 + DROP_MS)).toBe(-1);
    expect(dropProgress(d, 1100, 1, true)).toBe(-1);
    expect(dropProgress(null, 1100)).toBe(-1);
  });

  it('drop path starts at the queue and ends at the hand with no tilt', () => {
    const a = { x: 1800, y: 100 }, b = { x: 600, y: 300 };
    const s = dropPoint(0, a, b), e = dropPoint(1, a, b);
    expect(s.x).toBeCloseTo(1800); expect(s.y).toBeCloseTo(100);
    expect(e.x).toBeCloseTo(600); expect(e.y).toBeCloseTo(300);
    expect(e.rot).toBeCloseTo(0); expect(e.scale).toBeCloseTo(1);
  });
});
