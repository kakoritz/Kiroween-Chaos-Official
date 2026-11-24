// Campaign hub model (CP-U1). Pure functions; the DOM lives in hub.ts. Storage shape: .kiro/specs/campaign/spec.md section 5.
export type Tier = 'bronze' | 'silver' | 'gold';
export const STORAGE_KEY = 'haunt.campaign.v1';

export interface CampaignProgress { credits: number; owned: string[]; medals: Record<string, Tier>; best: Record<string, number> }
export interface HubNight {
  id: number; title: string; briefing: string; lesson: [string, string, string]; hint: string; orders: number; finale?: boolean;
  medals: { bronze: { credits: number }; silver: { credits: number }; gold: { credits: number } };
}

export const emptyProgress = (): CampaignProgress => ({ credits: 0, owned: [], medals: {}, best: {} });

const isTier = (v: unknown): v is Tier => v === 'bronze' || v === 'silver' || v === 'gold';
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Parses stored JSON defensively. Anything malformed falls back to an empty record. */
export function parseProgress(raw: string | null | undefined): CampaignProgress {
  if (!raw) return emptyProgress();
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const p = emptyProgress();
    p.credits = Math.max(0, Math.floor(num(o.credits)));
    if (Array.isArray(o.owned)) p.owned = o.owned.filter((x): x is string => typeof x === 'string');
    if (o.medals && typeof o.medals === 'object') for (const [k, v] of Object.entries(o.medals)) if (isTier(v)) p.medals[k] = v;
    if (o.best && typeof o.best === 'object') for (const [k, v] of Object.entries(o.best)) p.best[k] = num(v);
    return p;
  } catch { return emptyProgress(); }
}

export const DEFAULT_START_CREDITS = 300;
export interface StartGrant { gear: string[]; credits: number }

/** A save with nothing earned, bought or recorded yet. Raw storage holds 0 credits for it, but the player is owed the start grant. */
export function isFreshProgress(p: CampaignProgress): boolean {
  return p.credits === 0 && p.owned.length === 0 && !Object.keys(p.medals).length && !Object.keys(p.best).length;
}

/** The true progress: a fresh save gets the start grant (credits and gear) so the hub, shop and results all agree. */
export function withStart(p: CampaignProgress, start: Partial<StartGrant> | undefined): CampaignProgress {
  if (!isFreshProgress(p)) return p;
  return { ...p, credits: Math.max(0, Math.floor(num(start?.credits ?? DEFAULT_START_CREDITS))), owned: [...(start?.gear ?? [])] };
}

export function loadProgress(store: Pick<Storage, 'getItem'> | undefined): CampaignProgress {
  try { return parseProgress(store?.getItem(STORAGE_KEY)); } catch { return emptyProgress(); }
}

/** Night 1 is always open; a night opens on bronze or better of the previous night. */
export function isUnlocked(id: number, medals: Record<string, Tier>): boolean {
  return id <= 1 || isTier(medals[String(id - 1)]);
}

export type DoorState = 'locked' | 'open' | 'bronze' | 'silver' | 'gold';
export interface Door { id: number; title: string; state: DoorState; medal: Tier | null; locked: boolean; finale: boolean; best: number; label: string }

export function doorLabel(n: HubNight, state: DoorState, locked: boolean): string {
  const name = n.finale ? 'Finale' : `Night ${n.id}`;
  if (locked) return `${name}: ${n.title}. Locked. Earn a bronze medal on night ${n.id - 1} to open it.`;
  return `${name}: ${n.title}. ${state === 'open' ? 'No medal yet.' : `${state} medal.`}`;
}

export function buildDoors(nights: HubNight[], p: CampaignProgress): Door[] {
  return nights.map((n) => {
    const locked = !isUnlocked(n.id, p.medals);
    const medal = p.medals[String(n.id)] ?? null;
    const state: DoorState = locked ? 'locked' : medal ?? 'open';
    return { id: n.id, title: n.title, state, medal, locked, finale: !!n.finale, best: p.best[String(n.id)] ?? 0, label: doorLabel(n, state, locked) };
  });
}

/** Keyboard roving: the next focusable (unlocked) door index from `from`, or the same index if none. Locked doors still focus so the lock reason is readable. */
export function moveFocus(from: number, key: string, count: number): number {
  if (count <= 0) return 0;
  if (key === 'ArrowRight' || key === 'ArrowDown') return Math.min(count - 1, from + 1);
  if (key === 'ArrowLeft' || key === 'ArrowUp') return Math.max(0, from - 1);
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return from;
}

export const medalCount = (p: CampaignProgress): number => Object.keys(p.medals).length;
