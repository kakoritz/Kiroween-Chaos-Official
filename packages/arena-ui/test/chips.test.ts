import { describe, expect, it } from 'vitest';
import { chipState, chipTip, foldHeat, fromLegacy, heatAlpha, heatAt, heatTip, isIssue, newHeat } from '../src/arena/chips';
import { applyEvent, emptyVM, newLane, stationX } from '../src/arena/model';
import { laneBoxes } from '../src/arena/scene';
import { chipTipAt } from '../src/arena/chiptip';
import type { ArenaEvent } from '../src/api/types';

const IDS = ['a', 'b', 'c'];
let seq = 0;
const ev = (type: string, stage?: string, detail: Record<string, unknown> = {}, ts = ++seq * 100): ArenaEvent =>
  ({ seq: ++seq, ts, type, lane: 1, order: 'o1', ...(stage ? { stage } : {}), detail });
const states = (events: ArenaEvent[]) => chipState(events, IDS).map((c) => c.state);

describe('chipState', () => {
  it('is all pending before the order starts', () => {
    expect(states([])).toEqual(['pending', 'pending', 'pending']);
  });
  it('marks the first stage next after order_start', () => {
    expect(states([ev('order_start')])).toEqual(['next', 'pending', 'pending']);
  });
  it('active on stage_start, next on the following stage after stage_done', () => {
    const e = [ev('order_start'), ev('stage_start', 'a', { attempt: 1 })];
    expect(states(e)).toEqual(['active', 'pending', 'pending']);
    e.push(ev('stage_done', 'a'));
    expect(states(e)).toEqual(['passed', 'next', 'pending']);
  });
  it('passed has zero issues, healed has a flag count', () => {
    const e = [ev('order_start'), ev('stage_start', 'a'), ev('stage_fail', 'a'), ev('recover_start', 'a'), ev('recover_done', 'a'), ev('stage_done', 'a')];
    const c = chipState(e, IDS)[0]!;
    expect(c.state).toBe('healed');
    expect(c.issues).toBe(1);
  });
  it('trouble while a stage is failed or recovering, active again after recovery', () => {
    const e = [ev('order_start'), ev('stage_start', 'a'), ev('stage_fail', 'a')];
    expect(states(e)[0]).toBe('trouble');
    e.push(ev('recover_start', 'a'));
    expect(states(e)[0]).toBe('trouble');
    e.push(ev('recover_done', 'a'));
    expect(states(e)[0]).toBe('active');
  });
  it('trouble while a breaker is open, and the open breaker is an issue', () => {
    const e = [ev('order_start'), ev('stage_start', 'a'), ev('breaker', undefined, { state: 'open' })];
    const c = chipState(e, IDS)[0]!;
    expect(c.state).toBe('trouble');
    expect(c.issues).toBe(1);
    e.push(ev('breaker', undefined, { state: 'closed' }));
    expect(states(e)[0]).toBe('active');
  });
  it('dead between process_dead and process_up, with downtime', () => {
    const e = [ev('order_start'), ev('stage_start', 'a'), ev('process_dead', undefined, {}, 1000)];
    expect(states(e)[0]).toBe('dead');
    e.push(ev('process_up', undefined, {}, 3500), ev('stage_start', 'a', { attempt: 2 }, 3600));
    const c = chipState(e, IDS)[0]!;
    expect(c.state).toBe('active');
    expect(c.issues).toBe(1);
    expect(c.attempts).toBe(2);
    expect(c.downtimeMs).toBe(2500);
  });
  it('counts recovery downtime', () => {
    const e = [ev('order_start'), ev('stage_start', 'a'), ev('stage_fail', 'a'), ev('recover_start', 'a', {}, 1000), ev('recover_done', 'a', {}, 1800), ev('stage_done', 'a', {}, 2000)];
    expect(chipState(e, IDS)[0]!.downtimeMs).toBe(800);
  });
  it('failed at the stage where the order ended failed', () => {
    const e = [ev('order_start'), ev('stage_start', 'a'), ev('stage_done', 'a'), ev('stage_start', 'b'), ev('stage_fail', 'b'), ev('order_failed', 'b', { stage: 'b' })];
    expect(states(e)).toEqual(['passed', 'failed', 'pending']);
  });
  it('replayed for a skipped stage', () => {
    const e = [ev('order_start'), ev('stage_start', 'a'), ev('stage_done', 'a', { skipped: true })];
    expect(states(e)[0]).toBe('replayed');
  });
  it('parked and quarantined', () => {
    const base = [ev('order_start'), ev('stage_start', 'a')];
    expect(states([...base, ev('order_parked', 'a')])[0]).toBe('parked');
    expect(chipState([...base, ev('order_parked', 'a')], IDS)[0]!.issues).toBe(1);
    expect(states([...base, ev('order_quarantined', 'a')])[0]).toBe('quarantined');
  });
  it('a degraded stage counts an issue and ends healed once the next stage starts', () => {
    const e = [ev('order_start'), ev('stage_start', 'a'), ev('stage_fail', 'a', { degraded: true })];
    expect(states(e)[0]).toBe('trouble');
    e.push(ev('stage_start', 'b'));
    expect(states(e).slice(0, 2)).toEqual(['healed', 'active']);
  });
  it('a restart replays earlier stages without losing their issues', () => {
    const e = [ev('order_start'), ev('stage_start', 'a'), ev('stage_done', 'a'), ev('stage_start', 'b'), ev('process_dead'), ev('process_up'), ev('stage_start', 'a', { attempt: 2 })];
    const c = chipState(e, IDS);
    expect(c.map((x) => x.state)).toEqual(['active', 'pending', 'pending']);
    expect(c[1]!.issues).toBe(1);
  });
  it('chaos_absorbed is not an issue', () => {
    expect(isIssue(ev('chaos_absorbed', 'a'))).toBe(false);
    expect(isIssue(ev('repeat', 'a'))).toBe(true);
    expect(isIssue(ev('breaker', undefined, { state: 'half_open' }))).toBe(false);
  });
  it('done order leaves no next chip', () => {
    const e = [ev('order_start'), ev('stage_start', 'a'), ev('stage_done', 'a'), ev('order_done')];
    expect(states(e)).toEqual(['passed', 'pending', 'pending']);
  });
});

describe('heat and tooltips', () => {
  it('folds orders with issues and formats the tooltip', () => {
    const heat = newHeat(3);
    const bad = chipState([ev('order_start'), ev('stage_start', 'b'), ev('stage_fail', 'b'), ev('stage_fail', 'b')], IDS);
    foldHeat(heat, bad); foldHeat(heat, bad);
    foldHeat(heat, chipState([ev('order_start')], IDS));
    expect(heat.issues).toEqual([0, 4, 0]);
    expect(heat.orders).toEqual([0, 2, 0]);
    expect(heatTip('Payment', 4, 3)).toBe('Payment: 4 issues over 3 orders');
    expect(heatTip('Payment', 1, 1)).toBe('Payment: 1 issue over 1 order');
    expect(heatAlpha(0)).toBe(0);
    expect(heatAlpha(1)).toBeLessThan(heatAlpha(4));
    expect(heatAt(heat, bad, false, 1)).toEqual({ issues: 6, orders: 3 });
  });
  it('chip tooltip names the state in words', () => {
    expect(chipTip('Payment', { state: 'healed', issues: 2, attempts: 3, downtimeMs: 1500 })).toBe('Payment: Passed after trouble. Attempts 3, issues 2, downtime 1.5 s');
  });
  it('legacy chips map for snapshot lanes', () => {
    expect(fromLegacy('retrying', 2).state).toBe('trouble');
    expect(fromLegacy('done', 1).state).toBe('passed');
  });
});

describe('model wiring', () => {
  it('derives v2 chips and wave heat from lane events', () => {
    const vm = emptyVM();
    vm.stages = IDS.map((id) => ({ id, label: id.toUpperCase(), workAnimation: 'x' })) as never;
    vm.lanes = [newLane(1, 3, 0)];
    for (const e of [ev('order_start'), ev('stage_start', 'a'), ev('stage_fail', 'a'), ev('recover_start', 'a'), ev('recover_done', 'a'), ev('stage_done', 'a'), ev('order_done')]) applyEvent(vm, e, 0);
    const l = vm.lanes[0]!;
    expect(l.v2![0]!.state).toBe('healed');
    expect(l.heat!.issues[0]).toBe(1);
    const top = laneBoxes(1, 0)[0]!.top + 4;
    expect(chipTipAt(vm, stationX(0, 3), top + 10, 0)).toContain('A: Passed after trouble');
    expect(chipTipAt(vm, stationX(0, 3), top + 46, 0)).toBe('A: 1 issue over 1 order');
  });
});
