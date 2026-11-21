// Lap choreography (PT-U1, playtest-v2 ui.md sections 1 and 2). Pure helpers: the reducer stamps a few
// facts per lane (`LapVM`), the scene derives the skeleton's x and the grab animation from `now`.
// Durations are the real ms carried by events (contract v1.1); they are never stretched.
import type { ArenaEvent } from '../api/types';

/** Skeleton x at the start of the track (left end, next to the start stack). */
export const START_X = 372;
/** Left edge of the start stack, and the pile spacing (ui.md section 2: x 268 to 330). */
export const STACK_X = 268;
export const STACK_STEP = 14;
/** Server-time slack before an early stage_start counts as a travel violation. */
export const TRAVEL_TOL_MS = 20;

export interface LapMove { since: number; delay: number; dur: number; fromX: number; toX: number; gait?: 'run' | 'trudge' }

/** Door ceremony (order_done) or cancel sequence (order_failed) and the stars floating from the door (PT-U2). */
export interface Ceremony { kind: 'done' | 'cancel'; since: number; dur: number; stars: number | null; starsAt: number }

export interface LapVM {
  /** Where the skeleton stands when no move is active. */
  x: number;
  move: LapMove | null;
  /** Scroll lifting from the start stack into the hand. */
  grab: { since: number; dur: number } | null;
  /** Chip index showing the "next" outline, or -1. */
  next: number;
  /** Server time (ev.ts) before which no stage_start may arrive, or 0. */
  holdUntil: number;
  /** The scroll has been handed over (or parked): the hand is empty until the next order. */
  empty: boolean;
  /** Count of stage_start events that arrived before the skeleton could have. */
  violations: number;
  /** Handoff ceremony / cancel sequence in progress or recently ended (drawn by handoff.ts). */
  ceremony: Ceremony | null;
}

export const newLap = (x = START_X): LapVM => ({ x, move: null, grab: null, next: -1, holdUntil: 0, empty: false, violations: 0, ceremony: null });

const posNum = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/** Skeleton x and whether he is walking at `now`. Eased only inside the real duration. */
export function lapMotion(lap: LapVM, now: number): { x: number; moving: boolean; dir: number } {
  const m = lap.move;
  if (!m) return { x: lap.x, moving: false, dir: 1 };
  const t = now - m.since - m.delay;
  const dir = m.toX >= m.fromX ? 1 : -1;
  if (t <= 0) return { x: m.fromX, moving: false, dir };
  if (m.dur <= 0 || t >= m.dur) return { x: m.toX, moving: false, dir };
  return { x: m.fromX + (m.toX - m.fromX) * (t / m.dur), moving: true, dir };
}

/** Progress 0..1 of the grab, or -1 when none is playing. */
export function grabProgress(lap: LapVM | undefined, now: number): number {
  const g = lap?.grab;
  if (!g || g.dur <= 0) return -1;
  const p = (now - g.since) / g.dur;
  return p >= 0 && p < 1 ? p : -1;
}

/** Point on the lift from the start stack to the hand: a short arc with a settling tumble. */
export function grabPoint(p: number, from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number; rot: number; scale: number } {
  const e = p * p * (3 - 2 * p);
  return { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e - Math.sin(e * Math.PI) * 26, rot: (1 - e) * 0.5, scale: 0.8 + 0.2 * e };
}

/** Apply a lap-relevant event. `xOf` maps a stage index to its station x; `stageIdx` is the event's stage or -1. */
export function applyLap(
  lap: LapVM, ev: ArenaEvent, d: Record<string, unknown>, now: number,
  here: { x: number }, stageIdx: number, stageCount: number, xOf: (i: number) => number,
): void {
  const settle = (): void => { lap.x = here.x; lap.move = null; };
  switch (ev.type) {
    case 'order_start': {
      const grab = posNum(d.grabMs);
      lap.x = START_X; lap.move = null; lap.next = 0; lap.empty = false;
      lap.grab = grab ? { since: now, dur: grab } : null;
      lap.holdUntil = grab ? ev.ts + grab : 0;
      break;
    }
    case 'stage_start': {
      if (lap.holdUntil && ev.ts < lap.holdUntil - TRAVEL_TOL_MS) {
        lap.violations += 1;
        console.warn('travel_violation', { lane: ev.lane, order: ev.order, stage: ev.stage, earlyMs: lap.holdUntil - ev.ts });
      }
      lap.holdUntil = 0; lap.grab = null; lap.move = null;
      if (stageIdx >= 0) lap.x = xOf(stageIdx);
      lap.next = -1;
      break;
    }
    case 'stage_done': {
      const walk = posNum(d.walkMs);
      const next = stageIdx + 1;
      if (walk && stageIdx >= 0 && next < stageCount && d.skipped !== true) {
        lap.x = xOf(stageIdx);
        lap.move = { since: now, delay: 0, dur: walk, fromX: xOf(stageIdx), toX: xOf(next) };
        lap.next = next; lap.holdUntil = ev.ts + walk;
      } else if (stageIdx >= 0) { lap.x = xOf(stageIdx); lap.move = null; }
      break;
    }
    case 'order_done': case 'order_failed': case 'order_parked': {
      // Delay (door ceremony or cancel sequence) then the run or trudge back to the start (PT-U2 draws the ceremony).
      const delay = ev.type === 'order_done' ? posNum(d.ceremonyMs) : ev.type === 'order_failed' ? posNum(d.cancelMs) : 0;
      const back = posNum(d.returnMs);
      const fromX = here.x;
      lap.next = -1; lap.grab = null; lap.holdUntil = 0; lap.empty = ev.type !== 'order_failed';
      lap.x = fromX;
      lap.move = back ? { since: now, delay, dur: back, fromX, toX: START_X, ...(ev.type === 'order_done' ? { gait: 'run' as const } : ev.type === 'order_failed' ? { gait: 'trudge' as const } : {}) } : null;
      lap.ceremony = delay ? { kind: ev.type === 'order_done' ? 'done' : 'cancel', since: now, dur: delay, stars: null, starsAt: 0 } : null;
      break;
    }
    case 'review': {
      const stars = typeof d.stars === 'number' && Number.isFinite(d.stars) ? d.stars : null;
      if (stars === null) break;
      lap.ceremony ??= { kind: stars <= 1 ? 'cancel' : 'done', since: now, dur: 0, stars: null, starsAt: 0 };
      lap.ceremony.stars = stars; lap.ceremony.starsAt = now;
      break;
    }
    case 'process_dead': settle(); lap.next = -1; lap.holdUntil = 0; lap.grab = null; break;
    case 'process_up': lap.move = null; lap.x = stageIdx >= 0 ? xOf(stageIdx) : START_X; break;
    default: break;
  }
}
