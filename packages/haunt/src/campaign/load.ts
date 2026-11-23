// Campaign data loader (CP-C1, node only). Reads packages/core/campaign/{nights,gear}.json and validates them with ./nights.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findRepoRoot } from '../contract/validate';
import { validateGear, validateNights } from './nights';
import type { CampaignResponse } from './types';

export function campaignDir(root = findRepoRoot()): string {
  return resolve(root, 'packages', 'core', 'campaign');
}

/** Reads and validates the campaign data. The result is the body of GET /api/campaign. */
export function loadCampaign(root?: string): CampaignResponse {
  const dir = campaignDir(root);
  const read = (f: string): unknown => JSON.parse(readFileSync(resolve(dir, f), 'utf8'));
  const nights = validateNights(read('nights.json'), read('nights.schema.json') as object);
  const gear = validateGear(read('gear.json'));
  return { nights, gear: gear.items, start: gear.start };
}
