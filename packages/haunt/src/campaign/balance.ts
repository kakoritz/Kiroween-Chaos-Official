// Campaign balance checks (CP-C4). Pure functions over a night and the events of one wave; no I/O.
// Rules: .kiro/specs/campaign/spec.md sections 5 and 6, scoring numbers from POINTS (playtest-v2 design.md section 5).
// Partial until S1 lands the scoring engine in the live runner: the mock summaries are scripted, so the checks read the
// `wave_end` summary (contract V1.1 section 6) and not a re-score of the stream.
import { POINTS } from '../score/score';
import { computeMedal, type Medal } from './medals';
import type { CampaignNight, LaneSummary } from './types';

/** The event fields the checks read. Any wave stream (mock, live or browser) fits. */
export interface WaveEventLike { type: string; lane?: number | string; detail?: Record<string, any> }

/** Lane 1 is the Crew (the Rookie when it wears no gear); lanes 2 to 5 follow the order of `night.rivals`. */
export const CREW_LANE = 1;
export const RIVAL_LANES = { retrier: 2, journaler: 3, reconciler: 4, phoenix: 5 } as const;
/** Nights where a Crew without gear must not reach bronze (spec.md section 6, acceptance for the early nights). */
export const ROOKIE_BLOCKED_NIGHTS: readonly number[] = [1, 2, 3];

/** The `wave_end` summary of one lane, or undefined when the stream has none. The last `wave_end` wins. */
export function laneSummary(events: readonly WaveEventLike[], lane: number = CREW_LANE): LaneSummary | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type !== 'wave_end') continue;
    const s = (e.detail as { summary?: Record<string, LaneSummary> } | undefined)?.summary?.[String(lane)];
    return s ? { ...s } : undefined;
  }
  return undefined;
}

/** The medal a lane earned in a stream. `none` when the stream has no summary for the lane. */
export function medalFromEvents(night: CampaignNight, events: readonly WaveEventLike[], lane: number = CREW_LANE): Medal {
  const s = laneSummary(events, lane);
  return s ? computeMedal(night, s) : 'none';
}

/** Highest score a lane can reach on a night from the point table: perfect orders, five-star reviews, every boss, depth 1 attacks. */
export function scoreCeiling(night: CampaignNight): number {
  const perOrder = POINTS.clean + POINTS.speed + 2 * POINTS.reviewPerStar;
  const bosses = night.plan.filter((p) => 'boss' in p).length;
  const attacks = night.plan.filter((p) => !('boss' in p)).length;
  return night.orders * perOrder + bosses * POINTS.bossRecovered + attacks * POINTS.attackPerDepth;
}

export interface NightRuns {
  /** Lane 1 with no gear. */
  rookie: LaneSummary;
  /** Lane 5, the Phoenix rival, in the same wave. */
  phoenix: LaneSummary;
}

/** Every problem found with a night's thresholds. An empty list means the night is balanced. */
export function checkNightBalance(night: CampaignNight, runs: NightRuns): string[] {
  const out: string[] = [];
  const at = `night ${night.id}`;
  const { bronze, silver, gold } = night.medals;
  if (!(bronze.credits > 0)) out.push(`${at}: bronze needs credits above 0`);
  const ceiling = scoreCeiling(night);
  if (gold.credits > ceiling) out.push(`${at}: gold needs ${gold.credits} credits but the ceiling is ${ceiling}`);
  if (gold.credits === bronze.credits) out.push(`${at}: gold and bronze need the same credits`);
  const phoenix = computeMedal(night, runs.phoenix);
  if (phoenix !== 'gold') out.push(`${at}: Phoenix reaches ${phoenix}, not gold`);
  if (ROOKIE_BLOCKED_NIGHTS.includes(night.id)) {
    const rookie = computeMedal(night, runs.rookie);
    if (rookie !== 'none') out.push(`${at}: Rookie with no gear reaches ${rookie}`);
  }
  return out;
}
