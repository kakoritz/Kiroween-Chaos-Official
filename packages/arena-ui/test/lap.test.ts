import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyEvent, emptyVM, stationX, type ArenaVM } from '../src/arena/model';
import { grabPoint, grabProgress, lapMotion, newLap, START_X } from '../src/arena/lap';
import type { ArenaEvent } from '../src/api/types';

const STAGES = ['intake', 'check', 'send'].map((id) => ({ id, label: id, icon: '', workAnimation: 'think' }));
let seq = 0;
const ev = (type: string, ts: number, extra: Partial<ArenaEvent> = {}): ArenaEvent => ({ seq: ++seq, ts, type, wave: 1, lane: 1, ...extra });

function start(): ArenaVM {
  const vm = emptyVM();
  vm.stages = STAGES;
  applyEvent(vm, { seq: 0, ts: 0, type: 'wave_start', wave: 1, detail: { lanes: 1, speed: 1 } }, 0);
  return vm;
}

afterEach(() => vi.restoreAllMocks());

describe('lap choreography (PT-U1)', () => {
  it('a new lane stands at the start of the track', () => {
    const vm = start();
    expect(lapMotion(vm.lanes[0]!.lap!, 0)).toEqual({ x: START_X, moving: false, dir: 1 });
  });

  it('order_start puts him at the start with a grab and the intake chip as next', () => {
    const vm = start();
    applyEvent(vm, ev('order_start', 1000, { order: 'o1', detail: { index: 1, total: 3, grabMs: 500 } }), 50);
    const lap = vm.lanes[0]!.lap!;
    expect(lap.grab).toEqual({ since: 50, dur: 500 });
    expect(lap.next).toBe(0);
    expect(lap.empty).toBe(false);
    expect(lapMotion(lap, 300).x).toBe(START_X);
    expect(grabProgress(lap, 300)).toBeCloseTo(0.5);
    expect(grabProgress(lap, 600)).toBe(-1);
  });

  it('stage_start after the grab puts him at the intake station, no violation', () => {
    const vm = start();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    applyEvent(vm, ev('order_start', 1000, { order: 'o1', detail: { grabMs: 500 } }), 0);
    applyEvent(vm, ev('stage_start', 1500, { order: 'o1', stage: 'intake', detail: { attempt: 1 } }), 500);
    const lap = vm.lanes[0]!.lap!;
    expect(lap.violations).toBe(0);
    expect(warn).not.toHaveBeenCalled();
    expect(lap.next).toBe(-1);
    expect(lapMotion(lap, 500).x).toBe(stationX(0, 3));
  });

  it('stage_done with walkMs walks to the next station and marks its chip as next', () => {
    const vm = start();
    applyEvent(vm, ev('order_start', 0, { order: 'o1', detail: { grabMs: 0 } }), 0);
    applyEvent(vm, ev('stage_start', 10, { order: 'o1', stage: 'intake', detail: { attempt: 1 } }), 10);
    applyEvent(vm, ev('stage_done', 1000, { order: 'o1', stage: 'intake', detail: { walkMs: 400 } }), 1000);
    const lap = vm.lanes[0]!.lap!;
    expect(lap.next).toBe(1);
    const a = stationX(0, 3), b = stationX(1, 3);
    expect(lapMotion(lap, 1000)).toMatchObject({ x: a, moving: false });
    const mid = lapMotion(lap, 1200);
    expect(mid.moving).toBe(true);
    expect(mid.x).toBeCloseTo((a + b) / 2);
    expect(lapMotion(lap, 1400)).toMatchObject({ x: b, moving: false });
  });

  it('an early stage_start snaps to the station and counts a travel_violation', () => {
    const vm = start();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    applyEvent(vm, ev('order_start', 0, { order: 'o1', detail: { grabMs: 0 } }), 0);
    applyEvent(vm, ev('stage_start', 10, { order: 'o1', stage: 'intake', detail: { attempt: 1 } }), 10);
    applyEvent(vm, ev('stage_done', 1000, { order: 'o1', stage: 'intake', detail: { walkMs: 400 } }), 1000);
    applyEvent(vm, ev('stage_start', 1100, { order: 'o1', stage: 'check', detail: { attempt: 1 } }), 1100);
    const lap = vm.lanes[0]!.lap!;
    expect(lap.violations).toBe(1);
    expect(warn).toHaveBeenCalledWith('travel_violation', expect.objectContaining({ stage: 'check' }));
    expect(lap.move).toBeNull();
    expect(lapMotion(lap, 1100)).toMatchObject({ x: stationX(1, 3), moving: false });
  });

  it('an early stage_start during the grab also snaps and warns', () => {
    const vm = start();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    applyEvent(vm, ev('order_start', 0, { order: 'o1', detail: { grabMs: 500 } }), 0);
    applyEvent(vm, ev('stage_start', 100, { order: 'o1', stage: 'intake', detail: { attempt: 1 } }), 100);
    expect(vm.lanes[0]!.lap!.violations).toBe(1);
    expect(vm.lanes[0]!.lap!.grab).toBeNull();
  });

  it('judges lateness by event time, so a replayed batch does not warn', () => {
    const vm = start();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    applyEvent(vm, ev('order_start', 0, { order: 'o1', detail: { grabMs: 500 } }), 0);
    applyEvent(vm, ev('stage_start', 500, { order: 'o1', stage: 'intake', detail: { attempt: 1 } }), 1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('skipped replay pairs and a missing walkMs do not walk', () => {
    const vm = start();
    applyEvent(vm, ev('order_start', 0, { order: 'o1', detail: {} }), 0);
    applyEvent(vm, ev('stage_start', 1, { order: 'o1', stage: 'intake', detail: { attempt: 1 } }), 1);
    applyEvent(vm, ev('stage_done', 5, { order: 'o1', stage: 'intake', detail: { skipped: true, walkMs: 400 } }), 5);
    expect(vm.lanes[0]!.lap!.move).toBeNull();
    expect(vm.lanes[0]!.lap!.next).toBe(-1);
  });

  it('order_done empties the hand and runs back after the ceremony', () => {
    const vm = start();
    applyEvent(vm, ev('order_start', 0, { order: 'o1', detail: {} }), 0);
    applyEvent(vm, ev('stage_start', 1, { order: 'o1', stage: 'send', detail: { attempt: 1 } }), 1);
    applyEvent(vm, ev('order_done', 100, { order: 'o1', detail: { ceremonyMs: 1600, returnMs: 1800 } }), 100);
    const lap = vm.lanes[0]!.lap!, end = stationX(2, 3);
    expect(lap.empty).toBe(true);
    expect(lapMotion(lap, 1000)).toMatchObject({ x: end, moving: false });
    const mid = lapMotion(lap, 100 + 1600 + 900);
    expect(mid.moving).toBe(true);
    expect(mid.dir).toBe(-1);
    expect(mid.x).toBeCloseTo((end + START_X) / 2);
    expect(lapMotion(lap, 100 + 1600 + 1800)).toMatchObject({ x: START_X, moving: false });
  });

  it('order_failed keeps the scroll until the cancel sequence ends, then returns', () => {
    const vm = start();
    applyEvent(vm, ev('order_start', 0, { order: 'o1', detail: {} }), 0);
    applyEvent(vm, ev('order_failed', 100, { order: 'o1', detail: { cancelMs: 900, returnMs: 1800 } }), 100);
    const lap = vm.lanes[0]!.lap!;
    expect(lap.empty).toBe(false);
    expect(lap.move).toMatchObject({ delay: 900, dur: 1800, toX: START_X });
  });

  it('process_dead freezes him where he is', () => {
    const vm = start();
    applyEvent(vm, ev('order_start', 0, { order: 'o1', detail: {} }), 0);
    applyEvent(vm, ev('stage_start', 1, { order: 'o1', stage: 'check', detail: { attempt: 1 } }), 1);
    applyEvent(vm, ev('process_dead', 50, { detail: { restartInMs: 500 } }), 50);
    expect(lapMotion(vm.lanes[0]!.lap!, 60).x).toBe(stationX(1, 3));
  });

  it('grabPoint ends in the hand', () => {
    const to = { x: 400, y: 200 };
    expect(grabPoint(1, { x: 270, y: 260 }, to)).toMatchObject({ x: 400, y: 200, scale: 1 });
    expect(grabPoint(0, { x: 270, y: 260 }, to)).toMatchObject({ x: 270, y: 260 });
    expect(newLap().x).toBe(START_X);
  });
});
