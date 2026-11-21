// Night plans and hint mapping for nights 1 to 3 (cp-night-1-3). Pure functions over the campaign data; no I/O.
// Plans: which order meets which fault at which stage. Hints: night hint text <-> gearHint parts <-> shop gear.
import type { PartId } from '../shared/catalog';
import type { CampaignGear, CampaignNight, CampaignPress } from './types';

/** One concrete press: forEachOrder entries are expanded to one row per order (`ord-0001`, `ord-0002`, ...). */
export interface NightAttack { order: string; stage: string | undefined; fault: string; creature: string; point?: string }

/** The part that blocks each fault in nights 1 to 3 (the lesson of the night). Other faults map in later night tasks. */
export const FAULT_PART: Readonly<Record<string, PartId>> = {
  crash: 'idempotency',
  timeout: 'retry',
  http_429: 'breaker',
  http_500: 'retry',
  missing_file: 'offline_queue',
  malformed_payload: 'offline_queue',
  duplicate_request: 'journal',
};

export const orderId = (n: number): string => `ord-${String(n).padStart(4, '0')}`;

/** The night's presses as one row per order and attack, in plan order. Boss entries are skipped. */
export function nightAttacks(night: CampaignNight): NightAttack[] {
  const out: NightAttack[] = [];
  for (const e of night.plan) {
    if ('boss' in e) continue;
    const p = e as CampaignPress;
    const base = { stage: p.when?.stage, fault: p.fault, creature: p.creature, ...(p.point ? { point: p.point } : {}) };
    if (p.forEachOrder) for (let i = 1; i <= night.orders; i++) out.push({ order: orderId(i), ...base });
    else out.push({ order: p.when?.order ?? '*', ...base });
  }
  return out;
}

/** The shop gear for the night's `gearHint`, in hint order. Throws when a part has no gear. */
export function hintGear(night: CampaignNight, gear: readonly CampaignGear[]): CampaignGear[] {
  return night.gearHint.map((part) => {
    const g = gear.find((x) => x.part === part);
    if (!g) throw new Error(`night ${night.id}: no gear for part ${part}`);
    return g;
  });
}

/** The hint line built from the gear labels: "Try Spellbook and Seal." Matches the text in nights.json. */
export function hintText(night: CampaignNight, gear: readonly CampaignGear[]): string {
  const labels = hintGear(night, gear).map((g) => g.label);
  return `Try ${labels.length > 1 ? `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}` : labels[0]}.`;
}

/** Suggested gear for a lost-points cause: the gear that blocks the fault, or undefined when the fault is not mapped yet. */
export function gearForFault(fault: string, gear: readonly CampaignGear[]): CampaignGear | undefined {
  const part = FAULT_PART[fault];
  return part ? gear.find((g) => g.part === part) : undefined;
}

/** Every problem with the plans and hints of the given nights. An empty list means they are consistent. */
export function checkNightHints(nights: readonly CampaignNight[], gear: readonly CampaignGear[]): string[] {
  const out: string[] = [];
  for (const n of nights) {
    const at = `night ${n.id}`;
    let expected: string;
    try { expected = hintText(n, gear); } catch (e) { out.push((e as Error).message); continue; }
    if (n.hint !== expected) out.push(`${at}: hint "${n.hint}" should read "${expected}"`);
    const attacks = nightAttacks(n);
    if (attacks.length === 0) out.push(`${at}: plan has no attacks`);
    for (const a of attacks) {
      const m = a.order === '*' ? undefined : Number(a.order.slice(4));
      if (m !== undefined && !(m >= 1 && m <= n.orders)) out.push(`${at}: ${a.fault} targets ${a.order}, outside ${n.orders} orders`);
    }
    // Each hint part must answer at least one fault of the night (nights 1 to 3 only map faults in FAULT_PART).
    const mapped = new Set(attacks.map((a) => FAULT_PART[a.fault]).filter(Boolean));
    if (mapped.size > 0 && !n.gearHint.some((p) => mapped.has(p))) out.push(`${at}: no hint part answers a fault of the plan`);
  }
  return out;
}
