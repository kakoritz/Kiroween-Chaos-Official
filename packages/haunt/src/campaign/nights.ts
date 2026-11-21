// Campaign data loader and validator (CP-C1). Reads packages/core/campaign/{nights,gear}.json.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
import Ajv2020 from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import { PARTS, TIERS } from '../shared/catalog';
import { faultById } from '../chaos/catalog';
import { findRepoRoot } from '../contract/validate';
import type { CampaignGear, CampaignNight, CampaignPress, CampaignResponse, CampaignStart } from './types';

export const NIGHT_COUNT = 7;

/** World faults and creatures added by contract v1.1 section 8 that the engine catalog may not know yet. */
const WORLD_FAULTS: Record<string, string> = {
  sms_down: 'gargoyle', app_down: 'imp', updates_down: 'goblin', wrong_address: 'scarecrow',
  no_answer: 'black_cat', gated_house: 'black_cat', car_accident: 'phantom_car', order_typo: 'prankster',
};

export function campaignDir(root = findRepoRoot()): string {
  return resolve(root, 'packages', 'core', 'campaign');
}

let nightsValidator: ValidateFunction | undefined;

/** Throws an Error listing every problem. Returns the nights typed. */
export function validateNights(raw: unknown, schema: object): CampaignNight[] {
  if (!nightsValidator) nightsValidator = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  const problems: string[] = [];
  if (!nightsValidator!(raw)) {
    for (const e of nightsValidator!.errors ?? []) problems.push(`${e.instancePath || '/'} ${e.message ?? 'invalid'}`);
    throw new Error(`nights.json: ${problems.join('; ')}`);
  }
  const nights = raw as CampaignNight[];
  nights.forEach((n, i) => {
    const at = `night ${n.id}`;
    if (n.id !== i + 1) problems.push(`${at}: id must be ${i + 1}`);
    if ((n.id === NIGHT_COUNT) !== (n.finale === true)) problems.push(`${at}: only the last entry is the finale`);
    const { bronze, silver, gold } = n.medals;
    if (!(bronze.credits <= silver.credits && silver.credits <= gold.credits)) problems.push(`${at}: medal credits must not decrease`);
    if (new Set(n.plan.map((p) => JSON.stringify(p))).size !== n.plan.length) problems.push(`${at}: duplicate plan entries`);
    for (const p of n.plan) {
      if ('boss' in p) {
        if (!(p.startAtMs > p.warnAtMs)) problems.push(`${at}: boss ${p.boss} must start after its warning`);
        continue;
      }
      const press = p as CampaignPress;
      const known = faultById(press.fault)?.creature ?? WORLD_FAULTS[press.fault];
      if (!known) problems.push(`${at}: unknown fault ${press.fault}`);
      else if (known !== press.creature) problems.push(`${at}: fault ${press.fault} belongs to ${known}, not ${press.creature}`);
      const timings = [press.when, press.atMs, press.afterPrevMs].filter((x) => x !== undefined).length;
      if (timings !== 1) problems.push(`${at}: press ${press.fault} needs exactly one of when, atMs, afterPrevMs`);
      if (press.forEachOrder && !press.when) problems.push(`${at}: forEachOrder needs when`);
    }
    for (const part of n.gearHint) if (!(part in PARTS)) problems.push(`${at}: unknown part ${part}`);
    for (const r of n.rivals) if (!(r in TIERS)) problems.push(`${at}: unknown rival ${r}`);
  });
  if (problems.length) throw new Error(`nights.json: ${problems.join('; ')}`);
  return nights;
}

/** Throws an Error listing every problem. Returns the gear typed. */
export function validateGear(raw: unknown): { start: CampaignStart; items: CampaignGear[] } {
  const g = raw as { start?: CampaignStart; items?: CampaignGear[] };
  const problems: string[] = [];
  if (!g || typeof g !== 'object' || !Array.isArray(g.items) || !g.start) throw new Error('gear.json: needs start and items');
  if (g.start.credits !== 300 || g.start.gear.length !== 0) problems.push('start must be 0 gear and 300 credits');
  const badges = new Set<string>();
  const parts = new Set<string>();
  for (const it of g.items) {
    if (!it.id || !it.label || !(it.part in PARTS) || !Number.isInteger(it.cost) || it.cost <= 0 || !it.effect || !it.blocks) problems.push(`gear ${it.id}: invalid`);
    badges.add(it.badge);
    parts.add(it.part);
  }
  if (g.items.length !== 5 || badges.size !== 5 || parts.size !== 5) problems.push('gear: five items, one per part and badge');
  if (problems.length) throw new Error(`gear.json: ${problems.join('; ')}`);
  return { start: g.start, items: g.items };
}

/** Reads and validates the campaign data. The result is the body of GET /api/campaign. */
export function loadCampaign(root?: string): CampaignResponse {
  const dir = campaignDir(root);
  const read = (f: string): unknown => JSON.parse(readFileSync(resolve(dir, f), 'utf8'));
  const nights = validateNights(read('nights.json'), read('nights.schema.json') as object);
  const gear = validateGear(read('gear.json'));
  return { nights, gear: gear.items, start: gear.start };
}
