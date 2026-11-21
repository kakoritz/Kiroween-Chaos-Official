import { describe, expect, it } from 'vitest';
import { chipAt, inspLine, isLive, matchesStage, replayCount, stageLines, summarize } from '../src/arena/inspector';
import { stationX } from '../src/arena/model';
import { laneBoxes } from '../src/arena/scene';
import type { ArenaEvent } from '../src/api/types';

const ev = (seq: number, type: string, extra: Partial<ArenaEvent> = {}): ArenaEvent => ({ seq, ts: seq, type, lane: 1, stage: 'payment', order: 'o1', ...extra });

describe('chipAt', () => {
  it('finds the chip under a point and ignores gaps', () => {
    const top = laneBoxes(5)[2]!.top + 4;
    expect(chipAt(stationX(3, 8), top + 20, 5, 8)).toEqual({ lane: 2, stage: 3 });
    expect(chipAt(stationX(3, 8), top + 90, 5, 8)).toBeNull();
    expect(chipAt(5, top + 20, 5, 8)).toBeNull();
  });
});

describe('stage lines', () => {
  const events = [
    ev(3, 'stage_done', { detail: { ms: 420 } }),
    ev(1, 'stage_start', { detail: { attempt: 1 } }),
    ev(2, 'chaos', { detail: { creature: 'crash', fault: 'throw' } }),
    ev(2, 'chaos', { detail: { creature: 'crash', fault: 'throw' } }),
    ev(4, 'stage_done', { stage: 'intake' }),
    ev(5, 'stage_start', { lane: 2 }),
    ev(6, 'stage_progress', { order: 'o2', detail: { pct: 10 } }),
  ];
  it('filters by lane, stage and order, sorts and dedupes', () => {
    const lines = stageLines(events, 1, 'payment', 'o1');
    expect(lines.map((l) => l.seq)).toEqual([1, 2, 3]);
    expect(lines[2]!.text).toBe('Done in 420 ms');
    expect(matchesStage(events[6]!, 1, 'payment', 'o1')).toBe(false);
  });
  it('formats failures, skips and unknown events', () => {
    expect(inspLine(ev(1, 'stage_fail', { detail: { error: 'timeout', retryable: true } }))?.level).toBe('error');
    expect(inspLine(ev(1, 'stage_done', { detail: { skipped: true } }))?.text).toMatch(/Skipped/);
    expect(inspLine(ev(1, 'wave_start'))).toBeNull();
  });
  it('summarizes duration, chaos and recovery', () => {
    const s = summarize([...events, ev(7, 'recover_start', { detail: { action: 'retry' } })], 1, 'payment', 'o1');
    expect(s).toMatchObject({ duration: 420, attempts: 1, chaosHit: 'crash throw', recovery: 'retry' });
  });
});

describe('live and replay', () => {
  it('is live only while the chip is running', () => {
    expect(isLive('active')).toBe(true);
    expect(isLive('retrying')).toBe(true);
    expect(isLive('done')).toBe(false);
  });
  it('reveals replay lines over time', () => {
    expect(replayCount(0, 100)).toBe(0);
    expect(replayCount(4, 0)).toBe(1);
    expect(replayCount(4, 1200)).toBe(2);
    expect(replayCount(4, 9999)).toBe(4);
  });
});
