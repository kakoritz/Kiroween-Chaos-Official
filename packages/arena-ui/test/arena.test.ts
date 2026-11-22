import { describe, expect, it } from 'vitest';
import { applyEvent, emptyVM, loadSnapshot, newLane, stagesOf, LEGACY_STAGES, stationX, totalScore, type ArenaVM } from '../src/arena/model';
import { laneBoxes } from '../src/arena/scene';
import { ANIMS, frameFor } from '../src/rig/skeleton';
import type { ArenaEvent, ArenaState } from '../src/api/types';

const stages = ['intake', 'account', 'payment'].map((id) => ({ id, label: id, icon: 'mail', workAnimation: 'read_mail' }));
const ev = (type: string, lane: number | undefined, extra: Partial<ArenaEvent> = {}): ArenaEvent => ({ seq: 1, ts: 0, type, wave: 1, ...(lane ? { lane } : {}), ...extra });
const start = (): ArenaVM => {
  const vm = emptyVM(); vm.stages = stages;
  applyEvent(vm, ev('wave_start', undefined, { detail: { lanes: 2, speed: 2 } }), 0);
  return vm;
};

describe('arena model', () => {
  it('builds lanes on wave_start and clears on reset', () => {
    const vm = start();
    expect(vm.lanes).toHaveLength(2); expect(vm.speed).toBe(2);
    applyEvent(vm, ev('reset', undefined), 1);
    expect(vm.lanes).toHaveLength(0);
  });

  it('walks a stage through active, done and cheer', () => {
    const vm = start();
    applyEvent(vm, ev('order_start', 1, { order: 'o1', detail: { index: 1, total: 3 } }), 10);
    applyEvent(vm, ev('stage_start', 1, { stage: 'account', detail: { attempt: 1 } }), 20);
    const l = vm.lanes[0]!;
    expect(l.mode).toBe('working'); expect(l.chips).toEqual(['pending', 'active', 'pending']); expect(l.workAnim).toBe('read_mail');
    applyEvent(vm, ev('stage_progress', 1, { stage: 'account', detail: { pct: 40, label: 'half' } }), 30);
    expect(l.progress).toBe(40);
    applyEvent(vm, ev('stage_done', 1, { stage: 'account', detail: { skipped: false } }), 40);
    expect(l.chips[1]).toBe('done'); expect(l.cheer?.dur).toBe(300);
  });

  it('marks retries, replays and failures, and resets chips when an earlier stage repeats', () => {
    const vm = start();
    applyEvent(vm, ev('order_start', 1, { order: 'o1', detail: { index: 1, total: 1 } }), 0);
    applyEvent(vm, ev('stage_start', 1, { stage: 'intake', detail: { attempt: 1 } }), 0);
    applyEvent(vm, ev('stage_done', 1, { stage: 'intake', detail: { skipped: true } }), 0);
    expect(vm.lanes[0]!.chips[0]).toBe('replayed'); expect(vm.lanes[0]!.cheer).toBeNull();
    applyEvent(vm, ev('stage_start', 1, { stage: 'account', detail: { attempt: 2 } }), 0);
    expect(vm.lanes[0]!.chips[1]).toBe('retrying');
    applyEvent(vm, ev('stage_fail', 1, { stage: 'account', detail: {} }), 0);
    expect(vm.lanes[0]!.chips[1]).toBe('failed'); expect(vm.lanes[0]!.mode).toBe('fail');
    applyEvent(vm, ev('stage_start', 1, { stage: 'intake', detail: { attempt: 1 } }), 0);
    expect(vm.lanes[0]!.chips).toEqual(['active', 'pending', 'pending']);
  });

  it('collapses on process_dead and reassembles on process_up with depth reset', () => {
    const vm = start();
    applyEvent(vm, ev('order_start', 1, { order: 'o1', detail: { index: 1, total: 1 } }), 0);
    applyEvent(vm, ev('stage_start', 1, { stage: 'payment', detail: { attempt: 1 } }), 0);
    applyEvent(vm, ev('chaos', 1, { detail: { depth: 2 } }), 0);
    applyEvent(vm, ev('process_dead', 1, { detail: { restartInMs: 1000 } }), 5);
    const l = vm.lanes[0]!;
    expect(l.mode).toBe('dead'); expect(l.chips[2]).toBe('dead'); expect(l.restartInMs).toBe(1000);
    applyEvent(vm, ev('process_up', 1, { detail: {} }), 9);
    expect(l.mode).toBe('reassembling'); expect(l.depth).toBe(0);
  });

  it('counts outcomes and scores from events only, and ignores unknown types', () => {
    const vm = start();
    applyEvent(vm, ev('order_done', 1, { detail: { clean: false } }), 0);
    applyEvent(vm, ev('score', 1, { detail: { delta: -150, total: -150 } }), 0);
    applyEvent(vm, ev('score', 2, { detail: { delta: 25, total: 25 } }), 0);
    applyEvent(vm, ev('mystery', 1, { detail: {} }), 0);
    expect(vm.lanes[0]!.counts.completed).toBe(1); expect(vm.lanes[0]!.dirty).toBe(true);
    expect(totalScore(vm)).toBe(-125);
  });

  it('loads stage names and lane state from the /api/state snapshot', () => {
    const vm = emptyVM();
    const snap = {
      stages, wave: { n: 3, running: true, speed: 1 },
      lanes: [{ lane: 1, tier: 'phoenix', label: 'Phoenix', state: 'dead', order: 'o9', stage: 'account', stageIndex: 1, orderIndex: 2, ordersTotal: 5, score: 10,
        counts: { completed: 1, failed: 0, parked: 0, quarantined: 0, repeats: 0 }, depth: 1, parts: [{ id: 'retry', label: 'Retry', installed: true }, { id: 'journal', label: 'J', installed: false }] }],
    } as unknown as ArenaState;
    loadSnapshot(vm, snap, 0);
    expect(vm.stages.map((s) => s.id)).toEqual(['intake', 'account', 'payment']);
    expect(vm.lanes[0]!.chips).toEqual(['done', 'dead', 'pending']); expect(vm.lanes[0]!.mode).toBe('dead'); expect(vm.lanes[0]!.parts).toEqual(['retry']);
  });

  it('draws the chips from app.stages (v1.2) first, then stages, then the legacy list', () => {
    const eleven = ['account', 'create', 'submit', 'payment', 'confirmation', 'receive', 'process', 'updates', 'ship', 'transit', 'handoff'];
    const fromApp = stagesOf({ app: { id: 'orders', stages: eleven.map((id) => ({ id, label: id, kind: 'effect' as const })) }, stages } as unknown as ArenaState);
    expect(fromApp.map((s) => s.id)).toEqual(eleven);
    expect(fromApp[0]).toMatchObject({ id: 'account', label: 'account', kind: 'effect' });
    expect(stagesOf({ app: 'orders', stages } as unknown as ArenaState).map((s) => s.id)).toEqual(['intake', 'account', 'payment']);
    const legacy = stagesOf({ app: 'orders', stages: [] } as unknown as ArenaState);
    expect(legacy.map((s) => s.id)).toEqual(LEGACY_STAGES.map((s) => s.id));
    expect(legacy[0]!.id).toBe('intake');
    const vm = emptyVM();
    loadSnapshot(vm, { app: { id: 'orders', stages: eleven.map((id) => ({ id, label: id, kind: 'effect' as const })) }, wave: null, lanes: [] } as unknown as ArenaState, 0);
    expect(vm.stages).toHaveLength(11);
  });

  it('lays out lanes at 768/N capped at 200 and stations evenly', () => {
    expect(laneBoxes(5)[1]!.top - laneBoxes(5)[0]!.top).toBeCloseTo(153.6);
    expect(laneBoxes(1)[0]!.top).toBeGreaterThan(72);
    expect(stationX(0, 8)).toBeLessThan(stationX(7, 8));
    expect(newLane(1, 3, 0).chips).toHaveLength(3);
  });

  it('has finite frames for every skeleton pose', () => {
    for (const a of ANIMS) for (const p of [0, 0.5, 1]) for (const part of frameFor(a.id, p).parts) expect(Number.isFinite(part.xf.x + part.xf.y + part.xf.rot)).toBe(true);
  });
});
