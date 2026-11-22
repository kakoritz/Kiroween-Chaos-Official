// Never a perfect run (spec 5.3, property P19): every lane has at least one issue per round. If the plan yields none by the
// middle of the round the scheduler injects a gremlin: one slow call, one 500 or a duplicate delivery, labelled `gremlin`.
import { unit } from '../shared/rng';

/** Gremlins are mild: each is a known fault with a count of one. */
export const GREMLIN_VARIANTS = ['slow_link', 'http_500', 'duplicate_request'] as const;
export type GremlinVariant = (typeof GREMLIN_VARIANTS)[number];

/** The scheduler injects at the middle of the round (expected duration). */
export const FLOOR_FRACTION = 0.5;

/** The same variant for the same (seed, lane, wave). */
export function gremlinVariant(seed: string | number, lane: string | number, wave: number): GremlinVariant {
  return GREMLIN_VARIANTS[Math.floor(unit(seed, 'gremlin', lane, wave) * GREMLIN_VARIANTS.length)]!;
}

interface Ev { type?: string; lane?: unknown; detail?: Record<string, any> | undefined }

/**
 * An issue is what the lap tracker bumps (a failed stage, a dead process, a repeated effect, a parked order, an open breaker) plus
 * the gremlin itself, which is labelled and counted so the floor is met by construction.
 */
export function isIssueEvent(ev: Ev): boolean {
  switch (ev.type) {
    case 'stage_fail': case 'process_dead': case 'repeat': case 'order_parked': case 'lane_halted': return true;
    case 'breaker': return ev.detail?.state === 'open';
    case 'chaos': return ev.detail?.source === 'gremlin';
    default: return false;
  }
}

/** Issues of one lane in an event list (all lanes when `lane` is omitted). */
export function laneIssues(events: readonly Ev[], lane?: string | number): number {
  return events.filter((e) => (lane === undefined || String(e.lane) === String(lane)) && isIssueEvent(e)).length;
}

/** Per-lane issue counter of the running wave. */
export class IssueFloor {
  private readonly counts = new Map<string, number>();
  private readonly gremlins = new Set<string>();

  reset(lanes: readonly string[]): void {
    this.counts.clear();
    this.gremlins.clear();
    for (const l of lanes) this.counts.set(l, 0);
  }

  observe(ev: Ev): void {
    if (ev.lane === undefined || !isIssueEvent(ev)) return;
    const l = String(ev.lane);
    this.counts.set(l, (this.counts.get(l) ?? 0) + 1);
  }

  count(lane: string): number { return this.counts.get(lane) ?? 0; }
  gremlined(lane: string): boolean { return this.gremlins.has(lane); }
  markGremlin(lane: string): void { this.gremlins.add(lane); }

  /** Lanes with zero issues: the engine's assertion (P19). */
  violations(): string[] { return [...this.counts].filter(([, n]) => n === 0).map(([l]) => l); }
  snapshot(): Record<string, number> { return Object.fromEntries(this.counts); }
}
