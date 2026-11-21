// Pure medal and credit rules (CP-C1). Spec: .kiro/specs/campaign/spec.md section 5, "Medals and credits".
import type { CampaignNight, LaneSummary, MedalTier } from './types';

export const MEDAL_TIERS: readonly MedalTier[] = ['bronze', 'silver', 'gold'];
/** What a replay of an already earned tier pays, as a fraction of the lane score. */
export const REPLAY_FRACTION = 0.25;

export type Medal = MedalTier | 'none';

const num = (v: number | undefined, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

function orderCount(s: LaneSummary, fallback: number): number {
  const o = s.orders;
  const sum = o ? num(o.done, 0) + num(o.cancelled, 0) + num(o.parked, 0) + num(o.quarantined, 0) + num(o.abandoned, 0) : 0;
  return sum > 0 ? sum : fallback;
}

/** True if every threshold of `tier` is met by the lane 1 `wave_end` summary. A missing field never passes a limit that needs it. */
export function meetsTier(night: CampaignNight, tier: MedalTier, s: LaneSummary): boolean {
  const t = night.medals[tier] as unknown as Record<string, number | undefined>;
  if (!(num(s.score, -Infinity) >= (t.credits as number))) return false;
  if (t.repeats !== undefined && !(num(s.repeats, Infinity) <= t.repeats)) return false;
  if (t.avgStars !== undefined && !(num(s.stars?.avg, -Infinity) >= t.avgStars)) return false;
  if (t.cancelled !== undefined && !(num(s.orders?.cancelled, Infinity) <= t.cancelled)) return false;
  if (t.abandoned !== undefined && !(num(s.orders?.abandoned, Infinity) <= t.abandoned)) return false;
  if (t.maxDowntimeMsPerOrder !== undefined) {
    const per = num(s.downtimeMs, Infinity) / orderCount(s, night.orders);
    if (!(per <= t.maxDowntimeMsPerOrder)) return false;
  }
  return true;
}

/** The highest tier whose thresholds are all met, or `none`. A higher tier is never awarded over an unmet lower one. */
export function computeMedal(night: CampaignNight, s: LaneSummary): Medal {
  let best: Medal = 'none';
  for (const tier of MEDAL_TIERS) {
    if (!meetsTier(night, tier, s)) break;
    best = tier;
  }
  return best;
}

/**
 * Credits for a finished night: `max(0, score)` the first time this tier is reached for the night, 25 percent
 * (rounded down) on replays of a tier already earned. `none` counts as a tier of its own.
 */
export function awardCredits(score: number, tier: Medal, earned: ReadonlySet<Medal> | readonly Medal[]): number {
  const base = Math.max(0, Math.floor(num(score, 0)));
  const seen = earned instanceof Set ? earned.has(tier) : (earned as readonly Medal[]).includes(tier);
  return seen ? Math.floor(base * REPLAY_FRACTION) : base;
}

export interface NightResult { medal: Medal; credits: number; earned: Medal[] }

/** Medal, credits and the updated list of earned tiers for one finished night. */
export function scoreNight(night: CampaignNight, s: LaneSummary, earned: readonly Medal[]): NightResult {
  const medal = computeMedal(night, s);
  return { medal, credits: awardCredits(s.score, medal, earned), earned: earned.includes(medal) ? [...earned] : [...earned, medal] };
}
