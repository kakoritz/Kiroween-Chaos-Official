import { describe, expect, it } from 'vitest';
import { applyEvent, emptyVM, type ArenaVM } from '../src/arena/model';
import { ArenaScene } from '../src/arena/scene';
import { burnAt, ceremonyProgress, ceremonyStep, doorOpenAmount, handoverAt, starColor, starIcons, starsFloat, STARS_MS } from '../src/arena/handoff';
import { lapMotion, START_X } from '../src/arena/lap';
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

describe('handoff ceremony (PT-U2)', () => {
  it('order_done starts a done ceremony of ceremonyMs and a running return of returnMs after it', () => {
    const vm = start();
    applyEvent(vm, ev('stage_start', 10, { order: 'o1', stage: 'send' }), 0);
    applyEvent(vm, ev('order_done', 20, { order: 'o1', detail: { ceremonyMs: 1600, returnMs: 1800 } }), 100);
    const lap = vm.lanes[0]!.lap!;
    expect(lap.ceremony).toMatchObject({ kind: 'done', since: 100, dur: 1600, stars: null });
    expect(lap.move).toMatchObject({ delay: 1600, dur: 1800, gait: 'run', toX: START_X });
    expect(lapMotion(lap, 100 + 1600 + 900).moving).toBe(true);
    expect(lapMotion(lap, 100 + 1000).moving).toBe(false);
  });

  it('order_failed starts a cancel sequence and a slow trudge', () => {
    const vm = start();
    applyEvent(vm, ev('order_failed', 20, { order: 'o1', detail: { cancelMs: 900, returnMs: 1800, stage: 'send' } }), 50);
    const lap = vm.lanes[0]!.lap!;
    expect(lap.ceremony).toMatchObject({ kind: 'cancel', since: 50, dur: 900 });
    expect(lap.move).toMatchObject({ delay: 900, dur: 1800, gait: 'trudge' });
  });

  it('review attaches stars to the ceremony', () => {
    const vm = start();
    applyEvent(vm, ev('order_done', 20, { order: 'o1', detail: { ceremonyMs: 1600, returnMs: 1800 } }), 100);
    applyEvent(vm, ev('review', 20, { order: 'o1', detail: { stars: 4.5 } }), 120);
    expect(vm.lanes[0]!.lap!.ceremony).toMatchObject({ stars: 4.5, starsAt: 120 });
    const c = vm.lanes[0]!.lap!.ceremony;
    expect(starsFloat(c, 120 + STARS_MS - 1, false)).not.toBeNull();
    expect(starsFloat(c, 120 + STARS_MS + 1, false)).toBeNull();
    expect(starsFloat(c, 119, false)).toBeNull();
  });

  it('door timeline: opens, stays open for the handover, closes; scroll is taken mid-way', () => {
    expect(doorOpenAmount(0)).toBe(0);
    expect(doorOpenAmount(0.1)).toBeCloseTo(0.5);
    expect(doorOpenAmount(0.5)).toBe(1);
    expect(doorOpenAmount(0.99)).toBeLessThan(0.1);
    expect(handoverAt(0.1)).toEqual({ reach: 0, taken: false });
    expect(handoverAt(0.5).taken).toBe(true);
    expect(handoverAt(0.9).reach).toBe(0);
    const c = { kind: 'done' as const, since: 0, dur: 1000, stars: null, starsAt: 0 };
    expect([100, 300, 600, 900].map((t) => ceremonyStep(c, t))).toEqual(['open', 'hand', 'take', 'close']);
    expect(ceremonyProgress(c, 1000)).toBe(-1);
    expect(burnAt(0.35)).toBeCloseTo(0.5);
    expect(burnAt(1)).toBe(1);
  });

  it('stars: colours by rating, icons with halves, 5 stars burst and 1 star droops', () => {
    expect(starColor(5)).toBe('#ffd86b');
    expect(starColor(3.5)).toBe('#ff9a3c');
    expect(starColor(1)).toBe('#ff4d5e');
    expect(starIcons(4.5)).toBe('★★★★½');
    const hi = { kind: 'done' as const, since: 0, dur: 0, stars: 5, starsAt: 0 };
    const lo = { kind: 'cancel' as const, since: 0, dur: 0, stars: 1, starsAt: 0 };
    expect(starsFloat(hi, 400, false)!.dy).toBeLessThan(-20);
    expect(starsFloat(hi, 400, false)!.scale).toBeGreaterThan(1);
    expect(starsFloat(lo, 1400, false)!.dy).toBeGreaterThan(starsFloat(lo, 400, false)!.dy);
    expect(starsFloat(hi, 800, true)!.dy).toBe(-34);
  });

  it('the run back is faster than the trudge', () => {
    const vm = start();
    applyEvent(vm, ev('order_done', 20, { order: 'o1', detail: { ceremonyMs: 10, returnMs: 100 } }), 0);
    const run = ArenaScene.poseOf({ ...vm.lanes[0]!, cheer: null }, 60, true, 1);
    const l2 = start().lanes[0]!;
    l2.lap!.move = { since: 0, delay: 0, dur: 100, fromX: 1500, toX: START_X, gait: 'trudge' };
    const slow = ArenaScene.poseOf({ ...l2, mode: 'fail' }, 60, true, 1);
    expect(run.anim).toBe('walk');
    expect(slow.anim).toBe('walk');
    expect(run.p).not.toBe(slow.p);
  });
});
