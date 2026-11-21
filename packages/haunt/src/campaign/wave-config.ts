// Wave config for a campaign night (CP-C2): turns `POST /api/wave/start {campaign: {night, parts}}` into the
// wave settings, the Crew lane setup and the demo-script plans that press the night's chaos.
// Additive contract: contract/V1_1.md section 12. Plans use the demo-script trigger format (runtime.md section 33).
import { PARTS, type Part } from '../sdk';
import type { CrewSpec } from '../runner/lanes';
import type { AppId } from '../shared/catalog';
import { parseCrewParts } from './crew';
import type { CampaignBossEntry, CampaignNight, CampaignPress } from './types';

/** The request body field. `parts` are part ids (`retry`, `journal`, `idempotency`, `breaker`, `offline_queue`). */
export interface CampaignRequest { night: number; parts: Part[] }

/** One press in the demo-script format. Same fields as `DemoPress` in `packages/core/src/live/demo.ts`. */
export interface CampaignDemoPress {
  atMs?: number; when?: CampaignPress['when']; afterPrevMs?: number; delayMs?: number; forEachOrder?: boolean;
  lane: number; fault: string; creature: string; point?: string; scope?: 'inner' | 'outer';
}
export interface CampaignDemoBoss { id: string; warnAtMs: number; startAtMs: number }
/** A demo script: presses and at most one boss window (a player runs one boss, so a night with three gets three scripts). */
export interface CampaignDemoScript {
  name: string; seed: number; pace: 'show' | 'slow'; orders: number; lanes: number; tiers: 'race';
  presses: CampaignDemoPress[]; boss?: CampaignDemoBoss;
}

export interface CampaignWaveConfig {
  night: number;
  orders: number;
  seed: number;
  pace: 'slow';
  lanes: number;
  tiers: 'race';
  app: AppId;
  crew: CrewSpec;
  scripts: CampaignDemoScript[];
}

/** Throws `Error` with a message fit for a 400 body. Returns the request with the parts in canonical order. */
export function parseCampaignRequest(raw: unknown, nights: readonly CampaignNight[]): CampaignRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('campaign must be an object');
  const r = raw as { night?: unknown; parts?: unknown };
  const night = r.night;
  if (typeof night !== 'number' || !Number.isInteger(night) || !nights.some((n) => n.id === night)) throw new Error('bad campaign night');
  if (r.parts === undefined) return { night, parts: [] };
  if (!Array.isArray(r.parts) || r.parts.some((p) => typeof p !== 'string')) throw new Error('campaign parts must be a list of part ids');
  const ids = r.parts as string[];
  const bad = ids.find((p) => !(PARTS as readonly string[]).includes(p));
  if (bad !== undefined) throw new Error(`unknown campaign part ${bad}`);
  return { night, parts: parseCrewParts(ids) };
}

const isBoss = (e: CampaignPress | CampaignBossEntry): e is CampaignBossEntry => 'boss' in e;

/** The night's plan as demo scripts: all presses in the first, each boss window in its own script. */
export function planScripts(night: CampaignNight): CampaignDemoScript[] {
  const base = { seed: night.seed, pace: night.pace, orders: night.orders, lanes: 1 + night.rivals.length, tiers: 'race' as const };
  const presses: CampaignDemoPress[] = [];
  const bosses: CampaignDemoBoss[] = [];
  for (const e of night.plan) {
    if (isBoss(e)) { bosses.push({ id: e.boss, warnAtMs: e.warnAtMs, startAtMs: e.startAtMs }); continue; }
    const { detect: _detect, ...press } = e;
    presses.push(press);
  }
  const scripts: CampaignDemoScript[] = [{ ...base, name: `night-${night.id}`, presses, ...(bosses[0] ? { boss: bosses[0] } : {}) }];
  bosses.slice(1).forEach((b, i) => scripts.push({ ...base, name: `night-${night.id}-boss-${i + 2}`, presses: [], boss: b }));
  return scripts;
}

/** Everything the server and the runner need for one night. The night's own values win over any other wave setting. */
export function campaignWaveConfig(night: CampaignNight, parts: readonly Part[], appFallback: AppId = 'orders'): CampaignWaveConfig {
  return {
    night: night.id,
    orders: night.orders,
    seed: night.seed,
    pace: night.pace,
    lanes: 1 + night.rivals.length,
    tiers: 'race',
    app: night.app ?? appFallback,
    crew: { parts: PARTS.filter((p) => parts.includes(p)), rivals: night.rivals },
    scripts: planScripts(night),
  };
}
