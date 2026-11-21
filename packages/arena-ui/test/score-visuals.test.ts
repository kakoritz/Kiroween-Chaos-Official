import { describe, expect, it } from 'vitest';
import { avgStarsText, rankNumbers } from '../src/arena/panels';
import { downtimeCount, explainLines, fmtDelta, ScoreLog, visualFor } from '../src/arena/score-visuals';
import { newLane } from '../src/arena/model';

describe('PT-U8 score visuals model', () => {
  it('counts downtime up as a negative number', () => {
    expect(downtimeCount(0) === 0).toBe(true);
    expect(downtimeCount(2000)).toBe(-20);
    expect(downtimeCount(-5)).toBe(0);
  });
  it('formats deltas with a real minus', () => {
    expect(fmtDelta(-300)).toBe('\u2212300');
    expect(fmtDelta(150)).toBe('+150');
  });
  it('classifies score events', () => {
    expect(visualFor({ type: 'score', detail: { reason: 'order cancelled', delta: -300 } })).toEqual({ kind: 'slam', delta: -300 });
    expect(visualFor({ type: 'score', detail: { reason: 'boss recovered', delta: 150 } }).kind).toBe('banner');
    expect(visualFor({ type: 'score', detail: { reason: 'boss downtime refund', delta: 40 } }).kind).toBe('refund');
    expect(visualFor({ type: 'score', detail: { reason: 'downtime', delta: -40 } }).kind).toBe('none');
  });
  it('keeps the last 8 score events newest first', () => {
    const log = new ScoreLog();
    for (let i = 1; i <= 10; i++) log.add(1, { reason: `r${i}`, delta: -i });
    log.add(1, { reason: 'zero', delta: 0 });
    const rows = log.last(1);
    expect(rows).toHaveLength(8);
    expect(rows[0]!.reason).toBe('r10');
    expect(explainLines(rows)[0]).toBe('r10 \u221210');
  });
  it('gives tied lanes the same rank and shows avg stars', () => {
    const vm = { lanes: [newLane(1, 8, 0), newLane(2, 8, 0), newLane(3, 8, 0)] };
    vm.lanes[0]!.score = 0; vm.lanes[1]!.score = 0; vm.lanes[2]!.score = -770;
    expect(rankNumbers(vm.lanes)).toEqual([1, 1, 3]);
    vm.lanes[0]!.stars = { sum: 7.5, max: 10, last: 3 };
    expect(avgStarsText(vm.lanes[0]!)).toBe('3.8');
    expect(avgStarsText(vm.lanes[1]!)).toBe('-');
  });
});
// covers: PT-U8
