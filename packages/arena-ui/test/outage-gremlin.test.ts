import { describe, expect, it } from 'vitest';
import { applyEvent, emptyVM, loadSnapshot, stationX, type LaneVM } from '../src/arena/model';
import { OUTAGE_FADE_MS, outageAt, outageFrame, outageTip, ringLabel } from '../src/arena/outage';
import { chaosPhrase, creatureTip, captionOf } from '../src/arena/creatures';
import { laneMessage } from '../src/arena/lanes-ticker';
import { isIssue } from '../src/arena/chips';
import { laneCards } from '../src/arena/laps-model';
import { chipTipAt } from '../src/arena/chiptip';
import { laneBoxes } from '../src/arena/scene';

const STAGES = ['account', 'create', 'submit', 'payment', 'confirmation', 'receive', 'process', 'updates', 'ship', 'transit', 'handoff'];
function vm1(speed = 1) {
  const vm = emptyVM();
  loadSnapshot(vm, { app: 'orders', stages: STAGES.map((id) => ({ id, label: id, icon: '', workAnimation: 'think' })), lanes: [{ lane: 1, tier: 'rookie', label: 'Rookie', state: 'working', order: 'ord-1', stage: 'payment', stageIndex: 3, orderIndex: 1, ordersTotal: 3, score: 0, counts: { completed: 0, failed: 0, parked: 0, quarantined: 0, repeats: 0 }, depth: 0, parts: [] }], wave: { n: 1, running: true, speed, seed: 1, orders: 3, tiers: 'race', startedAt: 0 } } as never, 0);
  return vm;
}
const ev = (type: string, o: Record<string, unknown> = {}, detail: Record<string, unknown> = {}) => ({ seq: 1, ts: 1, type, lane: 1, detail, ...o });
const lane = (vm: ReturnType<typeof vm1>): LaneVM => vm.lanes[0]!;

describe('outage ring (TV3-U7)', () => {
  it('opens from the outage event on the stage of the envelope and counts down outageMs / speed', () => {
    const vm = vm1(2);
    applyEvent(vm, ev('outage', { stage: 'payment' }, { outageMs: 8000, seed: 7, fault: 'endpoint_down', level: 5 }), 1000);
    const o = outageAt(lane(vm), 'payment')!;
    expect(o).toMatchObject({ stage: 'payment', outageMs: 8000, realMs: 4000, fault: 'endpoint_down', level: 5 });
    expect(outageFrame(o, 1000)).toMatchObject({ frac: 1, seconds: 4, overrun: false });
    expect(outageFrame(o, 3000)).toMatchObject({ frac: 0.5, seconds: 2 });
    expect(ringLabel(outageFrame(o, 3000))).toBe('2s');
    expect(outageFrame(o, 5000)).toMatchObject({ frac: 0, seconds: 0, overrun: true });
    expect(outageTip(o, 3000)).toContain('2 s left');
    expect(outageTip(o, 5000)).toContain('waiting for the stage to recover');
  });
  it('ends on stage recovery, then fades; other stages and bad events are ignored', () => {
    const vm = vm1();
    applyEvent(vm, ev('outage', {}, { outageMs: 5000 }), 0);
    expect(lane(vm).outages ?? []).toHaveLength(0);
    applyEvent(vm, ev('outage', { stage: 'payment' }, { outageMs: 0 }), 0);
    expect(lane(vm).outages ?? []).toHaveLength(0);
    applyEvent(vm, ev('outage', { stage: 'payment' }, { outageMs: 5000 }), 0);
    applyEvent(vm, ev('stage_done', { stage: 'submit' }, {}), 500);
    expect(outageAt(lane(vm), 'payment')!.endedAt).toBeNull();
    applyEvent(vm, ev('stage_done', { stage: 'payment' }, { ms: 1 }), 1200);
    const o = outageAt(lane(vm), 'payment')!;
    expect(o.endedAt).toBe(1200);
    expect(outageFrame(o, 1200 + OUTAGE_FADE_MS / 2).fade).toBeCloseTo(0.5);
    expect(outageTip(o, 1300)).toContain('over');
    applyEvent(vm, ev('order_start', { order: 'ord-2' }, { index: 2, total: 3 }), 3000);
    applyEvent(vm, ev('stage_done', { stage: 'submit' }, {}), 3100);
    expect((lane(vm).outages ?? []).filter((x) => x.endedAt === null)).toHaveLength(0);
  });
  it('a cancelled order ends the ring too', () => {
    const vm = vm1();
    applyEvent(vm, ev('outage', { stage: 'payment' }, { outageMs: 9000 }), 0);
    applyEvent(vm, ev('order_failed', { stage: 'payment' }, { stage: 'payment' }), 100);
    expect(outageAt(lane(vm), 'payment')!.endedAt).toBe(100);
  });
  it('the chip tooltip mentions the countdown', () => {
    const vm = vm1();
    applyEvent(vm, ev('outage', { stage: 'payment' }, { outageMs: 12000, fault: 'endpoint_down' }), 0);
    const top = laneBoxes(1)[0]!.top + 4;
    const x = stationX(3, STAGES.length);
    expect(chipTipAt(vm, x, top + 20, 0, 2000)).toContain('Outage (endpoint down): about 10 s left');
    expect(chipTipAt(vm, x, top + 60, 0, 2000)).toContain('10 s left');
  });
});

describe('gremlin and UNKNOWN (TV3-U7)', () => {
  const grem = { fault: 'gremlin', creature: 'gremlin', source: 'gremlin', variant: 'slow_link', depth: 1 };
  const unk = { fault: 'timeout', creature: 'reaper', source: 'fuzz', unknown: true, fingerprint: 'fz-1a2b3c4d', fuzz: { fault: 'timeout', truncated: true }, depth: 1 };
  it('a gremlin chaos event adds a gremlin creature, a quiet one that acts by itself', () => {
    const vm = vm1();
    applyEvent(vm, ev('chaos', { stage: 'payment' }, grem), 1000);
    const c = lane(vm).creatures[0]!;
    expect(c).toMatchObject({ id: 'gremlin', source: 'gremlin', variant: 'slow_link', unknown: false });
    expect(c.actAt).toBe(1300);
    expect(captionOf('gremlin')).toBe('GREMLIN');
    expect(creatureTip(c)).toContain('Gremlin (slow link)');
  });
  it('an unknown fault keeps the fingerprint for the tooltip and writes an UNKNOWN log line', () => {
    const vm = vm1();
    applyEvent(vm, ev('chaos', { stage: 'payment' }, unk), 1000);
    const c = lane(vm).creatures[0]!;
    expect(c).toMatchObject({ unknown: true, fingerprint: 'fz-1a2b3c4d', base: 'timeout' });
    expect(creatureTip(c)).toContain('fz-1a2b3c4d');
    expect(creatureTip(c)).toContain('built on timeout');
    expect(chaosPhrase(unk, 'Payment')).toBe('UNKNOWN fault fz-1a2b3c4d at Payment');
    expect(laneMessage(ev('chaos', { stage: 'payment' }, unk) as never, (s) => s)!.text).toContain('UNKNOWN fault fz-1a2b3c4d');
  });
  it('log lines name the gremlin and the outage; the gremlin counts as an issue', () => {
    expect(chaosPhrase(grem, 'Payment')).toBe('gremlin: slow link at Payment');
    expect(chaosPhrase({ fault: 'crash' }, 'Payment')).toBe('crash hits Payment');
    expect(laneMessage(ev('chaos', { stage: 'payment' }, grem) as never, (s) => s)!.text).toBe('gremlin: slow link at payment');
    expect(laneMessage(ev('outage', { stage: 'payment' }, { outageMs: 12400 }) as never, (s) => s)!.text).toBe('outage 12.4 s at payment');
    expect(isIssue(ev('chaos', {}, grem) as never)).toBe(true);
    expect(isIssue(ev('chaos', {}, { fault: 'crash' }) as never)).toBe(false);
  });
});

describe('wave summary issues and the floor flag', () => {
  it('reads issues per lane and floorOk', () => {
    const cards = laneCards({ 1: { issues: 4, floorOk: true }, 2: { issues: 0, floorOk: false }, 3: {} }, [], new Map(), (l) => `L${l}`);
    expect(cards.map((c) => [c.issuesTotal, c.floorOk])).toEqual([[4, true], [0, false], [null, null]]);
  });
});
