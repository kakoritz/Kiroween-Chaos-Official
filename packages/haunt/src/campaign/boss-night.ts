// Night 5 boss plan (cp-night-5-boss). Pure functions over the campaign data and a wave stream; no I/O.
// Rule: a boss is recovered when the order in flight on the lane at `boss_start` finishes with `order_done`
// (scoring v2 awards POINTS.bossRecovered for exactly that). Campaign acceptance 3: every boss window recovered with all five parts.
import type { PartId } from '../shared/catalog';
import { CREW_LANE, type WaveEventLike } from './balance';
import type { CampaignBossEntry, CampaignNight } from './types';

export const BOSS_NIGHT = 5;
/** The five parts that together recover every boss (the night 5 gear hint). */
export const ALL_PARTS: readonly PartId[] = ['retry', 'journal', 'idempotency', 'breaker', 'offline_queue'];

/** Display name of each boss creature, in the order they arrive. */
export const BOSS_CREATURE: Readonly<Record<string, string>> = {
  boss_power_outage: 'Lich',
  boss_internet_outage: 'Banshee Queen',
  boss_hazard_storm: 'Headless Horseman',
};

/** The parts that matter most against each boss. Every boss still needs the full set (correlated failure). */
export const BOSS_KEY_PARTS: Readonly<Record<string, readonly PartId[]>> = {
  boss_power_outage: ['idempotency', 'journal'],
  boss_internet_outage: ['retry', 'breaker', 'offline_queue'],
  boss_hazard_storm: ['breaker', 'retry'],
};

export interface BossWindow { index: number; boss: string; creature: string; warnAtMs: number; startAtMs: number; keyParts: readonly PartId[] }

/** The boss windows of a night in plan order. */
export function bossWindows(night: CampaignNight): BossWindow[] {
  const out: BossWindow[] = [];
  for (const e of night.plan) {
    if (!('boss' in e)) continue;
    const b = e as CampaignBossEntry;
    out.push({ index: out.length, boss: b.boss, creature: BOSS_CREATURE[b.boss] ?? b.boss, warnAtMs: b.warnAtMs, startAtMs: b.startAtMs, keyParts: BOSS_KEY_PARTS[b.boss] ?? [] });
  }
  return out;
}

export interface BossRecovery { window: BossWindow; order?: string; recovered: boolean }

/** Replays a wave stream for one lane: each `boss_start` is matched to the next boss window; the lane's in-flight order must then finish. */
export function bossRecoveries(night: CampaignNight, events: readonly WaveEventLike[], lane: number = CREW_LANE): BossRecovery[] {
  const windows = bossWindows(night);
  const out: BossRecovery[] = windows.map((window) => ({ window, recovered: false }));
  let current = -1;
  let active: string | undefined;
  const laneOf = (e: WaveEventLike): number | undefined => (e.lane === undefined ? undefined : Number(e.lane));
  for (const e of events) {
    const ev = e as WaveEventLike & { order?: string };
    if (e.type === 'boss_start') { current++; if (out[current] && active !== undefined) out[current]!.order = active; continue; }
    if (laneOf(e) !== lane) continue;
    if (e.type === 'order_start') active = ev.order;
    else if (e.type === 'order_done') {
      const r = current >= 0 ? out[current] : undefined;
      if (r && !r.recovered && ev.order === r.order) r.recovered = true;
      if (active === ev.order) active = undefined;
    }
  }
  return out;
}

/** True when the stream has every boss window of the night and each was recovered. */
export function allBossesRecovered(night: CampaignNight, events: readonly WaveEventLike[], lane: number = CREW_LANE): boolean {
  const r = bossRecoveries(night, events, lane);
  return r.length > 0 && r.every((x) => x.recovered);
}

/** Boss windows the given parts leave uncovered: a window is covered only when every key part is worn. */
export function uncoveredBosses(night: CampaignNight, worn: readonly PartId[]): BossWindow[] {
  return bossWindows(night).filter((w) => !w.keyParts.every((p) => worn.includes(p)));
}

/** Every problem with the night 5 boss plan. An empty list means it is consistent. */
export function checkBossNight(night: CampaignNight): string[] {
  const out: string[] = [];
  const at = `night ${night.id}`;
  const w = bossWindows(night);
  if (w.length !== 3) out.push(`${at}: expected 3 boss windows, found ${w.length}`);
  for (const x of w) {
    if (!BOSS_CREATURE[x.boss]) out.push(`${at}: unknown boss ${x.boss}`);
    if (!(x.warnAtMs < x.startAtMs)) out.push(`${at}: ${x.boss} warns at ${x.warnAtMs} but starts at ${x.startAtMs}`);
    if (x.index > 0 && !(x.startAtMs > w[x.index - 1]!.startAtMs)) out.push(`${at}: ${x.boss} starts before the previous boss`);
  }
  for (const p of ALL_PARTS) if (!night.gearHint.includes(p)) out.push(`${at}: gear hint misses ${p}`);
  return out;
}
