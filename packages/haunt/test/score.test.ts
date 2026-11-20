import { mkdtempSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { EventLog, WaveManager, gradeOf, readEventLog, scoreEvents, type HauntEvent } from '../src/score';

const L = 'lane1';
const ev = (type: string, detail: Record<string, any> = {}, order = 'o1'): HauntEvent => ({ type, lane: L, order, detail });
const total = (events: HauntEvent[]) => scoreEvents(events).totals[L] ?? 0;
const done = (ms = 7000, clean = true) => ev('order_done', { clean, ms, repeats: 0 });

describe('score examples (acceptance D)', () => {
  it('clean order at 1.0x is 120', () => expect(total([ev('order_start'), done()])).toBe(120));
  it('slow clean order has no speed bonus', () => expect(total([done(20000)])).toBe(100));
  it('one attack at depth 1 adds 25', () => expect(total([ev('chaos', { depth: 1 }), done()])).toBe(145));
  it('three stacked attacks add 25+50+75', () =>
    expect(total([ev('chaos', { depth: 1 }), ev('chaos', { depth: 2 }), ev('chaos', { depth: 3 }), done()])).toBe(270));
  it('two extra ledger rows: 40 - 300', () =>
    expect(total([ev('repeat', { kind: 'charge', key: 'k', count: 2 }), ev('repeat', { kind: 'email', key: 'k', count: 2 }), done(7000, false)])).toBe(-260));
  it('a repeat count growing 2 then 3 charges one row each time', () =>
    expect(total([ev('repeat', { kind: 'charge', key: 'k', count: 2 }), ev('repeat', { kind: 'charge', key: 'k', count: 3 })])).toBe(-300));
  it('failed is -50', () => expect(total([ev('order_failed', { stage: 'payment', error: 'x' })])).toBe(-50));
  it('parked then resumed clean is 140', () =>
    expect(total([ev('order_parked'), ev('order_resumed'), done(60000)])).toBe(140));
  it('quarantined is +30', () => expect(total([ev('order_quarantined')])).toBe(30));
  it('lane halted is -200 once', () => expect(total([ev('lane_halted'), ev('lane_halted')])).toBe(-200));
  it('boss survival pays once per lane per boss', () => {
    const g = (type: string): HauntEvent => ({ type });
    expect(total([g('boss_start'), done(60000), ev('order_done', { clean: true, ms: 60000 }, 'o2'), g('boss_end')])).toBe(300);
  });
  it('score events follow the causing event and carry the running total', () => {
    const run = scoreEvents([ev('order_failed'), ev('order_failed', {}, 'o2')]);
    const scores = run.events.filter((e) => e.type === 'score').map((e) => e.detail!.total);
    expect(scores).toEqual([-50, -100]);
    expect(run.events[1].type).toBe('score');
  });
});

describe('P7 purity', () => {
  it('replaying the stream gives the same totals and score events', () => {
    const stream = [ev('chaos', { depth: 2 }), ev('repeat', { kind: 'charge', key: 'k', count: 2 }), done(7000, false), ev('order_failed', {}, 'o2')];
    const a = scoreEvents(stream);
    const b = scoreEvents(a.events);
    expect(b.totals).toEqual(a.totals);
    expect(b.events).toEqual(a.events);
  });
});

describe('grade', () => {
  it('phoenix-like wave is A', () => expect(gradeOf({ orders: 10, clean: 10, parkedResumed: 0, quarantined: 0, extraRows: 0 }).grade).toBe('A'));
  it('every order repeated is F', () => expect(gradeOf({ orders: 4, clean: 0, parkedResumed: 0, quarantined: 0, extraRows: 4 }).grade).toBe('F'));
  it('charge repeat caps at C and halt caps at D', () => {
    const base = { orders: 10, clean: 10, parkedResumed: 0, quarantined: 0, extraRows: 0 };
    expect(gradeOf({ ...base, chargeRepeated: true }).grade).toBe('C');
    expect(gradeOf({ ...base, halted: true }).grade).toBe('D');
    expect(gradeOf({ ...base, lostOrders: 1 }).grade).toBe('D');
  });
  it('reliability uses half credit and floors at 0', () => {
    expect(gradeOf({ orders: 4, clean: 2, parkedResumed: 2, quarantined: 0, extraRows: 0 }).reliability).toBe(75);
    expect(gradeOf({ orders: 1, clean: 0, parkedResumed: 0, quarantined: 0, extraRows: 9 }).reliability).toBe(0);
  });
});

describe('event log and wave manager', () => {
  const dir = mkdtempSync(join(tmpdir(), 'haunt-score-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('writes JSONL with increasing seq, omits lane on global events, tolerates a torn last line', () => {
    const file = join(dir, 'a.jsonl');
    const log = new EventLog(file, () => 5);
    log.emit({ type: 'wave_start', wave: 1, lane: undefined });
    log.emit({ type: 'order_start', wave: 1, lane: 'l1', order: 'o1' });
    log.close();
    appendFileSync(file, '{"seq":3,"ts":1,"ty');
    const back = readEventLog(file);
    expect(back.map((e) => e.seq)).toEqual([1, 2]);
    expect('lane' in back[0]).toBe(false);
  });

  it('runs a wave: stamps wave, inserts score events, grades per lane at wave_end', () => {
    const log = new EventLog(join(dir, 'b.jsonl'), () => 10);
    const wm = new WaveManager(log);
    expect(wm.start({ lanes: { l1: 2, l2: 2 } })).toBe(1);
    for (const lane of ['l1', 'l2']) {
      wm.record({ type: 'order_start', lane, order: 'a' });
      wm.record({ type: 'order_done', lane, order: 'a', detail: { clean: true, ms: 7000, repeats: 0 } });
    }
    wm.record({ type: 'repeat', lane: 'l1', order: 'b', detail: { kind: 'charge', key: 'k', count: 2 } });
    wm.record({ type: 'order_done', lane: 'l1', order: 'b', detail: { clean: false, ms: 7000, repeats: 1 } });
    wm.record({ type: 'order_done', lane: 'l2', order: 'b', detail: { clean: true, ms: 7000, repeats: 0 } });
    const rec = wm.end();
    log.close();
    const types = log.events.map((e) => e.type);
    expect(types[0]).toBe('wave_start');
    expect(types.at(-1)).toBe('wave_end');
    expect(log.events.every((e) => e.wave === 1)).toBe(true);
    const summary = log.events.at(-1)!.detail!.summary;
    expect(summary.l2.grade).toBe('A');
    expect(summary.l1.grade).toBe('F');
    expect(summary.l1.repeats).toBe(1);
    expect(rec.grade).toBe('F');
    expect(rec.score).toBe(summary.l1.score + summary.l2.score);
    expect(wm.active).toBe(false);
    expect(wm.start({ lanes: { l1: 1 } })).toBe(2);
  });
});
