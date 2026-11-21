import { describe, expect, it } from 'vitest';
import { applyEvent, emptyVM } from '../src/arena/model';
import { equipPhase, flightPoint, wornParts, FLY_MS } from '../src/arena/equip';
import type { ArenaEvent } from '../src/api/types';

const ev = (type: string, lane: number | undefined, extra: Partial<ArenaEvent> = {}): ArenaEvent => ({ seq: 1, ts: 0, type, wave: 1, ...(lane ? { lane } : {}), ...extra });

describe('equip animation (UI-S4)', () => {
  it('part_added installs the part once and records an equip', () => {
    const vm = emptyVM();
    applyEvent(vm, ev('wave_start', undefined, { detail: { lanes: 1, speed: 1 } }), 0);
    applyEvent(vm, ev('part_added', 1, { detail: { part: 'retry', source: 'hardening_spec', spec: 'W1' } }), 100);
    applyEvent(vm, ev('part_added', 1, { detail: { part: 'retry', source: 'manual' } }), 200);
    const l = vm.lanes[0]!;
    expect(l.parts).toEqual(['retry']);
    expect(l.equips).toHaveLength(1);
    expect(l.equips[0]).toMatchObject({ part: 'retry', since: 200 });
  });

  it('score events record a pop with the delta', () => {
    const vm = emptyVM();
    applyEvent(vm, ev('wave_start', undefined, { detail: { lanes: 1, speed: 1 } }), 0);
    applyEvent(vm, ev('score', 1, { detail: { delta: 50, total: 50 } }), 10);
    expect(vm.lanes[0]!.scorePop).toEqual({ since: 10, delta: 50 });
  });

  it('phases: flying, landed with spark, caption, done', () => {
    const e = { part: 'journal', since: 1000 };
    expect(equipPhase(e, 1000 + FLY_MS / 2).landed).toBe(false);
    const landed = equipPhase(e, 1000 + FLY_MS + 100);
    expect(landed.landed && landed.spark >= 0 && landed.caption >= 0).toBe(true);
    expect(equipPhase(e, 1000 + FLY_MS + 5000).done).toBe(true);
    expect(equipPhase(e, 1000 + FLY_MS / 2, 2).fly).toBeGreaterThan(0.99);
    expect(equipPhase(e, 1000, 1, true).landed).toBe(true);
  });

  it('worn parts hide gear still in flight', () => {
    const e = [{ part: 'retry', since: 0 }];
    expect(wornParts(['retry', 'journal'], e, 100)).toEqual(['journal']);
    expect(wornParts(['retry', 'journal'], e, FLY_MS + 1)).toEqual(['retry', 'journal']);
  });

  it('flight path starts at the edge and ends on the target', () => {
    const a = flightPoint(0, { x: -30, y: 100 }, { x: 500, y: 300 });
    const b = flightPoint(1, { x: -30, y: 100 }, { x: 500, y: 300 });
    expect([a.x, a.y]).toEqual([-30, 100]);
    expect([b.x, b.y]).toEqual([500, 300]);
  });
});
