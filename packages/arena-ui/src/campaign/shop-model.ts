// Gear shop model (CP-U2). Pure functions; the DOM lives in shop.ts. Gear data comes from GET /api/campaign (packages/core/campaign/gear.json).
import { STORAGE_KEY, parseProgress } from './hub-model';

export interface ShopGear { id: string; label: string; badge: string; part: string; cost: number; effect: string; blocks: string }
export interface ShopState { credits: number; owned: string[]; equipped: Record<string, string> }
export type ShopResult = { ok: true; state: ShopState } | { ok: false; state: ShopState; reason: string };

export const EQUIP_KEY = 'haunt.campaign.equipped.v1';

/** One slot per gear part, in shop order. The paper doll shows them as head to feet. */
export const slotsFor = (gear: readonly ShopGear[]): string[] => gear.map((g) => g.part);

const find = (gear: readonly ShopGear[], id: string): ShopGear | undefined => gear.find((g) => g.id === id);
const fail = (state: ShopState, reason: string): ShopResult => ({ ok: false, state, reason });

export function buy(state: ShopState, gear: readonly ShopGear[], id: string): ShopResult {
  const g = find(gear, id);
  if (!g) return fail(state, 'That gear does not exist.');
  if (state.owned.includes(id)) return fail(state, `You already own the ${g.label}.`);
  if (state.credits < g.cost) return fail(state, `The ${g.label} costs ${g.cost} credits. You have ${state.credits}.`);
  return { ok: true, state: { ...state, credits: state.credits - g.cost, owned: [...state.owned, id] } };
}

/** Puts owned gear on its slot. Gear only fits the slot of its own part. */
export function equip(state: ShopState, gear: readonly ShopGear[], id: string, slot: string): ShopResult {
  const g = find(gear, id);
  if (!g) return fail(state, 'That gear does not exist.');
  if (!state.owned.includes(id)) return fail(state, `Buy the ${g.label} first (${g.cost} credits).`);
  if (g.part !== slot) return fail(state, `The ${g.label} does not fit that slot.`);
  return { ok: true, state: { ...state, equipped: { ...state.equipped, [slot]: id } } };
}

export function unequip(state: ShopState, slot: string): ShopState {
  const equipped = { ...state.equipped };
  delete equipped[slot];
  return { ...state, equipped };
}

export function equipAll(state: ShopState, gear: readonly ShopGear[]): ShopState {
  const equipped: Record<string, string> = {};
  for (const g of gear) if (state.owned.includes(g.id)) equipped[g.part] = g.id;
  return { ...state, equipped };
}

/** Reset takes everything off. Owned gear is kept. */
export const reset = (state: ShopState): ShopState => ({ ...state, equipped: {} });

/** The parts sent to `POST /api/wave/start {campaign:{night, parts}}`, in slot order. */
export function equippedParts(state: ShopState, gear: readonly ShopGear[]): string[] {
  return gear.filter((g) => state.equipped[g.part] === g.id).map((g) => g.part);
}

/** Plain-words tooltip: what it does, what it blocks, and its price or ownership. */
export function tooltip(g: ShopGear, owned: boolean): string {
  return `${g.label} (${g.badge}). ${g.effect} Blocks: ${g.blocks} ${owned ? 'You own it.' : `Costs ${g.cost} credits.`}`;
}

/** Keyboard drag and drop: Space or Enter picks up, arrows choose a slot, Space or Enter drops, Escape cancels. */
export function nextSlot(slots: readonly string[], cur: number, key: string): number {
  if (!slots.length) return 0;
  if (key === 'ArrowDown' || key === 'ArrowRight') return Math.min(slots.length - 1, cur + 1);
  if (key === 'ArrowUp' || key === 'ArrowLeft') return Math.max(0, cur - 1);
  if (key === 'Home') return 0;
  if (key === 'End') return slots.length - 1;
  return cur;
}

export function loadShop(store: Pick<Storage, 'getItem'> | undefined, gear: readonly ShopGear[], start: { gear: string[]; credits: number }): ShopState {
  let raw: string | null = null;
  try { raw = store?.getItem(STORAGE_KEY) ?? null; } catch { raw = null; }
  const p = parseProgress(raw);
  const owned = (raw ? p.owned : start.gear).filter((id) => !!find(gear, id));
  const credits = raw ? p.credits : start.credits;
  let equipped: Record<string, string> = {};
  try {
    const e = JSON.parse(store?.getItem(EQUIP_KEY) ?? '{}') as Record<string, unknown>;
    for (const [slot, id] of Object.entries(e)) {
      const g = typeof id === 'string' ? find(gear, id) : undefined;
      if (g && g.part === slot && owned.includes(g.id)) equipped[slot] = g.id;
    }
  } catch { equipped = {}; }
  return { credits, owned, equipped };
}

/** Writes credits and owned gear into the shared progress record, keeping medals and bests. */
export function saveShop(store: Pick<Storage, 'getItem' | 'setItem'> | undefined, state: ShopState): void {
  try {
    const p = parseProgress(store?.getItem(STORAGE_KEY));
    store?.setItem(STORAGE_KEY, JSON.stringify({ ...p, credits: state.credits, owned: state.owned }));
    store?.setItem(EQUIP_KEY, JSON.stringify(state.equipped));
  } catch { /* storage unavailable: the shop still works for this visit */ }
}
