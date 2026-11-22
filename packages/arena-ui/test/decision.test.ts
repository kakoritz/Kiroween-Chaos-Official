import { describe, expect, it } from 'vitest';
import { CHOICES, DECISION_CARDS, DecisionTracker, choiceForKey, countdown, decisionTitle, resultCaption, waitLine } from '../src/arena/decision';
import { isWorld, tintOf, worldProp } from '../src/arena/world-events';
import { captionOf } from '../src/arena/creatures';
import { applyEvent, emptyVM, loadSnapshot } from '../src/arena/model';
import { outageAt, outageFrame } from '../src/arena/outage';
import type { ArenaEvent } from '../src/api/types';

const ev = (type: string, lane: number | undefined, detail: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({ type, ...(lane === undefined ? {} : { lane }), detail, ...extra });

describe('decision popup model (PT-U11)', () => {
  it('three cards with their consequences, keys 1 2 3', () => {
    expect(DECISION_CARDS.map((c) => [c.key, c.choice, c.cost])).toEqual([['1', 'refund', '-150 credits'], ['2', 'discount', '-60 credits'], ['3', 'redo', 'No credit loss']]);
    expect(DECISION_CARDS[1]!.effect).toMatch(/3/);
    expect(DECISION_CARDS[2]!.effect).toMatch(/4/);
    expect(CHOICES.map((c) => choiceForKey(DECISION_CARDS.find((d) => d.choice === c)!.key))).toEqual([...CHOICES]);
    expect(choiceForKey('4')).toBeNull();
    expect(choiceForKey('a')).toBeNull();
  });

  it('opens on decision_needed, hands the made decision over, and clears with the order', () => {
    const t = new DecisionTracker();
    const need = ev('decision_needed', 2, { order: 'ord-0001', kind: 'wrong_order', detectedAt: 'process', options: ['refund', 'discount', 'redo'], defaultChoice: 'discount', timeoutMs: 6000 });
    const r = t.onEvent(need, 1000);
    expect(r.opened).toMatchObject({ lane: 2, order: 'ord-0001', detectedAt: 'process', defaultChoice: 'discount', timeoutMs: 6000, shownAt: 1000 });
    expect(t.size).toBe(1);
    const made = t.onEvent(ev('decision_made', 2, { order: 'ord-0001', choice: 'redo', source: 'user' }), 2500);
    expect(made.made).toEqual({ lane: 2, order: 'ord-0001', choice: 'redo', source: 'user', at: 2500 });
    expect(t.size).toBe(0);
    t.onEvent(need, 3000);
    expect(t.onEvent(ev('order_failed', 2), 3100).cleared).toBe(2);
    t.onEvent(need, 3200);
    expect(t.onEvent(ev('wave_end', undefined), 3300).cleared).toBe(-1);
  });

  it('a key answers the decision that runs out first', () => {
    const t = new DecisionTracker();
    t.onEvent(ev('decision_needed', 3, { order: 'a', timeoutMs: 6000 }), 0);
    t.onEvent(ev('decision_needed', 1, { order: 'b', timeoutMs: 2000 }), 500);
    expect(t.next()?.lane).toBe(1);
  });

  it('counts down the real timeout and never below zero', () => {
    const p = { shownAt: 1000, timeoutMs: 6000 };
    expect(countdown(p, 1000)).toEqual({ leftMs: 6000, frac: 1, seconds: 6 });
    expect(countdown(p, 4500)).toMatchObject({ leftMs: 2500, seconds: 3 });
    expect(countdown(p, 99999)).toEqual({ leftMs: 0, frac: 0, seconds: 0 });
  });

  it('texts: title by stage, the default line, one caption per result', () => {
    expect(decisionTitle('handoff', (s) => s.toUpperCase())).toBe('WRONG ORDER at HANDOFF');
    expect(decisionTitle('process')).toBe('WRONG ORDER at Process');
    expect(waitLine('discount')).toBe('If you wait: Discount');
    expect(resultCaption('refund', 'user')).toMatch(/REFUNDED/);
    expect(resultCaption('discount', 'timeout')).toMatch(/Time ran out/);
    expect(resultCaption('redo', 'default')).toMatch(/rewinds/);
  });
});

describe('transit creatures and captions (PT-U10, V1_2 section 4)', () => {
  it('knows the four new creatures and keeps the old ones', () => {
    for (const id of ['storm_crow', 'pothole_imp', 'fuel_wraith', 'lost_parcel_ghoul', 'scarecrow', 'black_cat']) expect(isWorld(id)).toBe(true);
  });

  it('each transit creature shows its prop once it acts; delay reuses the scarecrow with a clock', () => {
    expect(worldProp('storm_crow', 'weather', 0, 10).kind).toBe('storm');
    expect(worldProp('pothole_imp', 'road_hazard', 0, 10).kind).toBe('pothole');
    expect(worldProp('fuel_wraith', 'out_of_gas', 0, 10).kind).toBe('empty_tank');
    expect(worldProp('lost_parcel_ghoul', 'not_on_truck', 0, 10).kind).toBe('missing_parcel');
    expect(worldProp('scarecrow', 'delay', 0, 10).kind).toBe('late_clock');
    expect(worldProp('scarecrow', 'wrong_address', 0, 10).kind).toBe('signpost');
    expect(worldProp('storm_crow', 'weather', null, 10).kind).toBe('none');
  });

  it('captions and chip tints for every transit fault', () => {
    expect([captionOf('weather'), captionOf('road_hazard'), captionOf('delay'), captionOf('out_of_gas'), captionOf('not_on_truck')]).toEqual(['STORM', 'POTHOLE', 'RUNNING LATE', 'OUT OF GAS', 'NOT ON TRUCK']);
    for (const f of ['weather', 'road_hazard', 'delay', 'out_of_gas', 'not_on_truck', 'wrong_address']) expect(tintOf(f)).toMatch(/^#[0-9a-f]{6}$/i);
    expect(tintOf('http_500')).toBeNull();
  });
});

describe('transit stall countdown waits for the stage (outage pending)', () => {
  const stages = ['account', 'create', 'submit', 'payment', 'confirmation', 'receive', 'process', 'updates', 'ship', 'transit', 'handoff'].map((id) => ({ id, label: id, icon: '', workAnimation: 'think', kind: 'effect' }));
  function arena() {
    const vm = emptyVM();
    loadSnapshot(vm, { app: 'orders', stages, wave: { n: 1, running: true, speed: 1 }, lanes: [{ lane: 1, tier: 'rookie', label: 'Rookie', parts: [], state: 'working', order: 'ord-0001', stage: 'payment', stageIndex: 3, orderIndex: 1, ordersTotal: 1, score: 0, counts: { completed: 0, failed: 0, parked: 0, quarantined: 0, repeats: 0 }, depth: 0 }] } as never, 0);
    return vm;
  }

  it('the ring is full and does not count until the lane reaches transit, then counts', () => {
    const vm = arena();
    applyEvent(vm, ev('outage', 1, { outageMs: 4000, fault: 'road_hazard', level: 3, seed: 7 }, { stage: 'transit' }) as ArenaEvent, 1000);
    const l = vm.lanes[0]!;
    const o = outageAt(l, 'transit')!;
    expect(o.pending).toBe(true);
    expect(outageFrame(o, 3000).leftMs).toBe(4000);
    applyEvent(vm, ev('stage_start', 1, { attempt: 1 }, { stage: 'transit', order: 'ord-0001' }) as ArenaEvent, 5000);
    expect(o.pending).toBe(false);
    expect(outageFrame(o, 6000).leftMs).toBe(3000);
  });

  it('a stall for the stage the lane is already in counts at once', () => {
    const vm = arena();
    applyEvent(vm, ev('stage_start', 1, { attempt: 1 }, { stage: 'transit', order: 'ord-0001' }) as ArenaEvent, 100);
    applyEvent(vm, ev('outage', 1, { outageMs: 4000, fault: 'weather', level: 3, seed: 7 }, { stage: 'transit' }) as ArenaEvent, 200);
    expect(outageAt(vm.lanes[0]!, 'transit')?.pending).toBeUndefined();
  });
});
