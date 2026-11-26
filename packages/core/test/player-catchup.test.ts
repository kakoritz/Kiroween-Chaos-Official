// The replay player keeps true time under load. Spec: .kiro/specs/modular-engine (hosted page follow-up). Found by the hosted check:
// one event per late timer made a 20 s tournament round take over 2 minutes in a slow browser.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Player } from '../src/mock/play';

afterEach(() => { vi.useRealTimers(); });

const ev = (ts: number, type = 'stage_progress') => ({ type, ts, seq: 0, lane: '1', detail: {} }) as never;
const hubWith = (speed = 1) => { const got: { type: string; ts: number }[] = []; return { hub: { speed, demoRunning: null, emit: (e: { type: string; ts: number }) => got.push(e) } as never, got }; };
/** 100 events, one every 100 ms (10 s of recording). */
const hundred = () => Array.from({ length: 100 }, (_, i) => ev(i * 100));

describe('Player', () => {
  it('plays events at their recorded times, at 1x', () => {
    vi.useFakeTimers();
    const { hub, got } = hubWith(1);
    new Player(hub).play(hundred(), 1, { speed: 1 });
    expect(got.length).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(got.length).toBe(11);
    vi.advanceTimersByTime(9000);
    expect(got.length).toBe(100);
  });

  it('divides time by the speed', () => {
    vi.useFakeTimers();
    const { hub, got } = hubWith(4);
    new Player(hub).play(hundred(), 1, { speed: 4 });
    vi.advanceTimersByTime(2500);
    expect(got.length).toBe(100);
  });

  // covers: modular-engine/hosted-tournament
  it('catches up after a stall: a busy page does not slow the replay down', () => {
    vi.useFakeTimers();
    const { hub, got } = hubWith(2);
    new Player(hub).play(hundred(), 1, { speed: 2 });
    // The main thread is blocked for 4 s of real time (a slow frame draw), then the timer fires once.
    vi.setSystemTime(Date.now() + 4000);
    vi.advanceTimersByTime(60);
    // 4 s real at 2x = 8 s of recording = events up to 8000 ms are due, in this one step.
    expect(got.length).toBeGreaterThanOrEqual(80);
    expect(got.filter((e) => e.ts <= 8000).length).toBeGreaterThanOrEqual(80);
  });

  it('keeps order and emits each event once', () => {
    vi.useFakeTimers();
    const { hub, got } = hubWith(8);
    const p = new Player(hub);
    p.play(hundred(), 1, { speed: 8 });
    vi.setSystemTime(Date.now() + 100000);
    vi.advanceTimersByTime(5000);
    expect(got.map((e) => e.ts)).toEqual(hundred().map((e) => (e as unknown as { ts: number }).ts));
    expect(p.active).toBe(false);
  });

  it('stop ends the replay', () => {
    vi.useFakeTimers();
    const { hub, got } = hubWith(1);
    const p = new Player(hub);
    p.play(hundred(), 1, { speed: 1 });
    vi.advanceTimersByTime(300);
    p.stop();
    const n = got.length;
    vi.advanceTimersByTime(20000);
    expect(got.length).toBe(n);
  });
});
