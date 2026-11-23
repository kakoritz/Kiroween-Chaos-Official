// Campaign fixtures for node callers: the pure builders of ./campaign-fixtures-core with the campaign data read from disk by default.
// The browser bundle imports the -core file and passes the recorded campaign in.
import type { HauntEvent, PartId } from '@haunt/shared';
import type { CampaignResponse } from '../../haunt/src/campaign/types';
import { loadCampaign } from '../../haunt/src/campaign/load';
import { campaignFixture as build, campaignFixtureSpecs as specs } from './campaign-fixtures-core';

export * from './campaign-fixtures-core';

export const campaignFixture = (night: number, parts: readonly PartId[] = [], data: CampaignResponse = loadCampaign()): HauntEvent[] => build(night, parts, data);
export const campaignFixtureSpecs = (data: CampaignResponse = loadCampaign()): { name: string; night: number; parts: PartId[] }[] => specs(data);

export const CAMPAIGN_FIXTURES: Record<string, () => HauntEvent[]> = Object.fromEntries(
  campaignFixtureSpecs().map((fx) => [fx.name, () => campaignFixture(fx.night, fx.parts)]),
);
