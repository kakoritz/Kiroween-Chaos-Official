// Campaign types (CP-C1). Additive contract: contract/V1_1.md section 12. Data lives in packages/core/campaign.
import type { PartId } from '../shared/catalog';

export type MedalTier = 'bronze' | 'silver' | 'gold';

/** Same trigger as a demo-script press (runtime.md section 33). */
export interface CampaignWhen { lane: number; event: string; stage?: string; order?: string; attempt?: number }

export interface CampaignPress {
  when?: CampaignWhen; atMs?: number; afterPrevMs?: number; delayMs?: number; forEachOrder?: boolean;
  lane: number; fault: string; creature: string; point?: string; scope?: 'inner' | 'outer'; detect?: 'confirmation' | 'process' | 'transit' | 'handoff';
}
export interface CampaignBossEntry { boss: string; warnAtMs: number; startAtMs: number }
export type CampaignPlanEntry = CampaignPress | CampaignBossEntry;

export interface BronzeMedal { credits: number }
export interface SilverMedal { credits: number; repeats: number }
export interface GoldMedal {
  credits: number; repeats: number; avgStars?: number; cancelled?: number; abandoned?: number;
  /** Maximum average downtime per order in ms (summary.downtimeMs divided by the order count). */
  maxDowntimeMsPerOrder?: number;
}
export interface CampaignMedals { bronze: BronzeMedal; silver: SilverMedal; gold: GoldMedal }

export interface CampaignNight {
  id: number;
  title: string;
  briefing: string;
  lesson: [string, string, string];
  hint: string;
  orders: number;
  pace: 'slow';
  seed: number;
  app?: string;
  finale?: boolean;
  plan: CampaignPlanEntry[];
  rivals: ['retrier', 'journaler', 'reconciler', 'phoenix'];
  medals: CampaignMedals;
  gearHint: PartId[];
}

export interface CampaignGear {
  id: string;
  label: string;
  badge: 'R' | 'J' | 'I' | 'B' | 'Q';
  part: PartId;
  cost: number;
  effect: string;
  blocks: string;
}

export interface CampaignStart { gear: string[]; credits: number }

/** GET /api/campaign */
export interface CampaignResponse { nights: CampaignNight[]; gear: CampaignGear[]; start: CampaignStart }

/** The lane 1 `wave_end.detail.summary[1]` fields the medal rule reads (contract V1.1 section 6). */
export interface LaneSummary {
  score: number;
  repeats?: number;
  downtimeMs?: number;
  orders?: { done?: number; cancelled?: number; parked?: number; quarantined?: number; abandoned?: number };
  stars?: { avg?: number };
}
