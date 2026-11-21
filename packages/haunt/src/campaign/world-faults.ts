// Nights 4 to 7 world faults and bosses (cp-night-4-world). Pure data and checks; no I/O.
// Maps each world fault of contract v1.1 section 8 to the part that answers it, and checks the plans of nights 4 to 7.
import type { PartId } from '../shared/catalog';
import { BOSS_CREATURE } from './boss-night';
import { bossWindows } from './boss-night';
import type { CampaignGear, CampaignNight, CampaignPress } from './types';

/** The part that blocks each world fault. Merged into FAULT_PART in hints.ts. */
export const WORLD_FAULT_PART: Readonly<Record<string, PartId>> = {
  sms_down: 'breaker',
  app_down: 'retry',
  updates_down: 'breaker',
  wrong_address: 'offline_queue',
  no_answer: 'retry',
  gated_house: 'offline_queue',
  car_accident: 'offline_queue',
  order_typo: 'offline_queue',
};

/** The main part against each boss (first of BOSS_KEY_PARTS' lesson for the night summary). */
export const BOSS_PART: Readonly<Record<string, PartId>> = {
  boss_power_outage: 'journal',
  boss_internet_outage: 'offline_queue',
  boss_hazard_storm: 'breaker',
};

/** Nights that carry world faults or bosses. */
export const WORLD_NIGHTS: readonly number[] = [4, 5, 6, 7];

/** Fault names of the night's presses, in plan order, bosses excluded. */
export function worldFaults(night: CampaignNight): string[] {
  return night.plan.filter((e) => !('boss' in e)).map((e) => (e as CampaignPress).fault);
}

/** Every problem with the world plans of nights 4 to 7. An empty list means they are consistent. */
export function checkWorldNights(nights: readonly CampaignNight[], faultPart: Readonly<Record<string, PartId>>, gear: readonly CampaignGear[]): string[] {
  const out: string[] = [];
  for (const id of WORLD_NIGHTS) {
    const n = nights[id - 1];
    if (!n) { out.push(`night ${id}: missing`); continue; }
    const at = `night ${id}`;
    for (const f of worldFaults(n)) if (!faultPart[f]) out.push(`${at}: fault ${f} has no part`);
    for (const w of bossWindows(n)) {
      if (!BOSS_CREATURE[w.boss] || !BOSS_PART[w.boss]) out.push(`${at}: boss ${w.boss} has no mapping`);
      else if (!w.keyParts.includes(BOSS_PART[w.boss]!)) out.push(`${at}: ${w.boss} part ${BOSS_PART[w.boss]} is not a key part`);
    }
    for (const p of n.gearHint) if (!gear.some((g) => g.part === p)) out.push(`${at}: no gear for ${p}`);
    if (id === 4) {
      const parts = new Set(worldFaults(n).map((f) => faultPart[f]));
      for (const p of parts) if (p && !n.gearHint.includes(p)) out.push(`${at}: hint misses ${p}`);
    }
  }
  return out;
}
