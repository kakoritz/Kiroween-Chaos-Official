// Campaign results model (CP-U3). Pure functions; the DOM lives in results.ts. Rules: .kiro/specs/campaign/spec.md section 5.
import { STORAGE_KEY, parseProgress, type CampaignProgress, type Tier } from './hub-model';

export interface LaneSummary {
  score?: number; repeats?: number; downtimeMs?: number;
  orders?: { done?: number; cancelled?: number; parked?: number; quarantined?: number; abandoned?: number };
  stars?: { avg?: number };
}
export interface NightMedals {
  bronze: { credits: number };
  silver: { credits: number; repeats?: number };
  gold: { credits: number; repeats?: number; avgStars?: number; cancelled?: number; abandoned?: number; maxDowntimeMsPerOrder?: number };
}
export interface ResultNight { id: number; title: string; orders: number; finale?: boolean; medals: NightMedals }
export interface ResultGear { id: string; label: string; part: string }
export type Medal = Tier | 'none';

export const TIERS: readonly Tier[] = ['bronze', 'silver', 'gold'];
export const REPLAY_FRACTION = 0.25;
export const EARNED_KEY = 'haunt.campaign.earned.v1';

const n = (v: unknown, fb: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fb);

function orderCount(s: LaneSummary, fb: number): number {
  const o = s.orders;
  const sum = o ? n(o.done, 0) + n(o.cancelled, 0) + n(o.parked, 0) + n(o.quarantined, 0) + n(o.abandoned, 0) : 0;
  return sum > 0 ? sum : fb;
}

/** True when every threshold of the tier is met. A missing field never passes a limit that needs it. */
export function meets(night: ResultNight, tier: Tier, s: LaneSummary): boolean {
  const t = night.medals[tier] as Record<string, number | undefined>;
  if (!(n(s.score, -Infinity) >= (t.credits as number))) return false;
  if (t.repeats !== undefined && !(n(s.repeats, Infinity) <= t.repeats)) return false;
  if (t.avgStars !== undefined && !(n(s.stars?.avg, -Infinity) >= t.avgStars)) return false;
  if (t.cancelled !== undefined && !(n(s.orders?.cancelled, Infinity) <= t.cancelled)) return false;
  if (t.abandoned !== undefined && !(n(s.orders?.abandoned, Infinity) <= t.abandoned)) return false;
  if (t.maxDowntimeMsPerOrder !== undefined && !(n(s.downtimeMs, Infinity) / orderCount(s, night.orders) <= t.maxDowntimeMsPerOrder)) return false;
  return true;
}

/** Highest tier whose thresholds are all met. A higher tier never counts over an unmet lower one. */
export function medalFor(night: ResultNight, s: LaneSummary): Medal {
  let best: Medal = 'none';
  for (const t of TIERS) { if (!meets(night, t, s)) break; best = t; }
  return best;
}

/** First time a tier is reached: the whole positive score. Replays of a tier already earned: 25 percent, rounded down. */
export function creditsFor(score: number, medal: Medal, earned: readonly Medal[]): number {
  const base = Math.max(0, Math.floor(n(score, 0)));
  return earned.includes(medal) ? Math.floor(base * REPLAY_FRACTION) : base;
}

const rank = (m: Medal | undefined): number => (m === 'bronze' ? 1 : m === 'silver' ? 2 : m === 'gold' ? 3 : 0);

export type Earned = Record<string, Medal[]>;

export function loadEarned(store: Pick<Storage, 'getItem'> | undefined): Earned {
  try {
    const o = JSON.parse(store?.getItem(EARNED_KEY) ?? '{}') as Record<string, unknown>;
    const out: Earned = {};
    for (const [k, v] of Object.entries(o)) if (Array.isArray(v)) out[k] = v.filter((x): x is Medal => x === 'none' || TIERS.includes(x as Tier));
    return out;
  } catch { return {}; }
}

export interface Outcome { medal: Medal; credits: number; bestMedal: Medal; best: number; unlockedNext: boolean; progress: CampaignProgress; earned: Earned }

/** Applies a finished night to the progress record. Never lowers a medal or a best score. */
export function applyResult(night: ResultNight, s: LaneSummary, progress: CampaignProgress, earned: Earned): Outcome {
  const key = String(night.id);
  const medal = medalFor(night, s);
  const seen = earned[key] ?? [];
  const credits = creditsFor(n(s.score, 0), medal, seen);
  const prev = progress.medals[key];
  const bestMedal: Medal = rank(medal) > rank(prev) ? medal : prev ?? 'none';
  const medals = { ...progress.medals };
  if (bestMedal !== 'none') medals[key] = bestMedal;
  const best = Math.max(progress.best[key] ?? 0, Math.floor(n(s.score, 0)));
  const next: CampaignProgress = { ...progress, credits: progress.credits + credits, medals, best: { ...progress.best, [key]: best } };
  return { medal, credits, bestMedal, best, unlockedNext: rank(medal) > 0 && rank(prev) === 0, progress: next, earned: { ...earned, [key]: seen.includes(medal) ? seen : [...seen, medal] } };
}

export function saveOutcome(store: Pick<Storage, 'setItem'> | undefined, o: Outcome): void {
  try { store?.setItem(STORAGE_KEY, JSON.stringify(o.progress)); store?.setItem(EARNED_KEY, JSON.stringify(o.earned)); } catch { /* storage unavailable: results still show */ }
}

export interface Cause { text: string; lost: number; part?: string; gear?: string }

const CAUSE_RULES: { re: RegExp; text: string; part?: string }[] = [
  { re: /repeat|duplicate|double/i, text: 'Work was done twice (a repeated charge or email).', part: 'idempotency' },
  { re: /cancel|never arrived|lost/i, text: 'Orders were cancelled after the first failure.', part: 'retry' },
  { re: /abandon|quarantin|park|poison|missing|bad data/i, text: 'Broken orders had nowhere to wait.', part: 'offline_queue' },
  { re: /downtime|outage|rate|429|storm/i, text: 'Orders waited too long while a service was down.', part: 'breaker' },
  { re: /restart|from zero|journal/i, text: 'A crash sent an order back to the start.', part: 'journal' },
  { re: /review|star/i, text: 'Customers left low reviews.' },
  { re: /boss/i, text: 'A boss attack cost points.' },
];

export interface ScoreHit { delta: number; reason: string }

/** Top three causes of lost points in plain words. Loss events come first; the summary fills gaps when no events were seen. */
export function explain(s: LaneSummary, hits: readonly ScoreHit[], gear: readonly ResultGear[], night?: ResultNight): Cause[] {
  const by = new Map<string, Cause>();
  const add = (text: string, lost: number, part?: string) => {
    const c = by.get(text) ?? { text, lost: 0, part };
    c.lost += lost;
    by.set(text, c);
  };
  for (const h of hits) {
    if (!(h.delta < 0)) continue;
    const rule = CAUSE_RULES.find((r) => r.re.test(h.reason));
    add(rule ? rule.text : `Points lost: ${h.reason}.`, -h.delta, rule?.part);
  }
  if (by.size === 0) {
    if (n(s.repeats, 0) > 0) add(`Work was repeated ${s.repeats} time${s.repeats === 1 ? '' : 's'} (double charges or emails).`, 0, 'idempotency');
    if (n(s.orders?.cancelled, 0) > 0) add(`${s.orders?.cancelled} order${s.orders?.cancelled === 1 ? ' was' : 's were'} cancelled.`, 0, 'retry');
    if (n(s.orders?.abandoned, 0) > 0) add(`${s.orders?.abandoned} order${s.orders?.abandoned === 1 ? ' was' : 's were'} abandoned.`, 0, 'offline_queue');
    if (n(s.downtimeMs, 0) > 0 && night && n(s.downtimeMs, 0) / orderCount(s, night.orders) > (night.medals.gold.maxDowntimeMsPerOrder ?? Infinity)) add('Orders waited too long for a broken service.', 0, 'breaker');
    if (s.stars?.avg !== undefined && s.stars.avg < 3.5) add(`Average review was ${s.stars.avg.toFixed(1)} stars.`, 0);
  }
  return [...by.values()].sort((a, b) => b.lost - a.lost).slice(0, 3).map((c) => ({ ...c, gear: c.part ? gear.find((g) => g.part === c.part)?.label : undefined }));
}

/** What the player still needs for the next tier, in words. Empty on gold. */
export function nextGoal(night: ResultNight, medal: Medal): string {
  const next = TIERS[rank(medal)];
  if (!next) return '';
  const t = night.medals[next] as Record<string, number | undefined>;
  const bits = [`${t.credits} credits`];
  if (t.repeats !== undefined) bits.push(t.repeats === 0 ? 'no repeats' : `at most ${t.repeats} repeats`);
  if (t.avgStars !== undefined) bits.push(`${t.avgStars}+ average stars`);
  if (t.cancelled !== undefined) bits.push(t.cancelled === 0 ? 'no cancelled orders' : `at most ${t.cancelled} cancelled`);
  if (t.abandoned !== undefined) bits.push(t.abandoned === 0 ? 'no abandoned orders' : `at most ${t.abandoned} abandoned`);
  if (t.maxDowntimeMsPerOrder !== undefined) bits.push(`under ${Math.round(t.maxDowntimeMsPerOrder / 1000)} s of downtime per order`);
  return `For ${next}: ${bits.join(', ')}.`;
}

/** Export format: the progress record plus the earned-tier list, as one JSON text. */
export function exportProgress(store: Pick<Storage, 'getItem'> | undefined): string {
  let p: CampaignProgress;
  try { p = parseProgress(store?.getItem(STORAGE_KEY)); } catch { p = parseProgress(null); }
  return JSON.stringify({ version: 1, ...p, earned: loadEarned(store) }, null, 2);
}

export type ImportResult = { ok: true; progress: CampaignProgress; earned: Earned } | { ok: false; reason: string };

/** Validates pasted or uploaded JSON. Nothing is written when it is not a campaign save. */
export function parseImport(text: string): ImportResult {
  let o: unknown;
  try { o = JSON.parse(text); } catch { return { ok: false, reason: 'That is not valid JSON.' }; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { ok: false, reason: 'That is not a campaign save.' };
  const r = o as Record<string, unknown>;
  if (!('credits' in r) || !('medals' in r) || !('owned' in r)) return { ok: false, reason: 'That file is missing credits, owned gear or medals.' };
  const progress = parseProgress(JSON.stringify(r));
  const earned: Earned = {};
  if (r.earned && typeof r.earned === 'object') for (const [k, v] of Object.entries(r.earned)) if (Array.isArray(v)) earned[k] = v.filter((x): x is Medal => x === 'none' || TIERS.includes(x as Tier));
  return { ok: true, progress, earned };
}

export function saveImport(store: Pick<Storage, 'setItem'> | undefined, r: { progress: CampaignProgress; earned: Earned }): void {
  try { store?.setItem(STORAGE_KEY, JSON.stringify(r.progress)); store?.setItem(EARNED_KEY, JSON.stringify(r.earned)); } catch { /* storage unavailable */ }
}
