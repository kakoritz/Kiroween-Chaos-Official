// Equip animation (UI-S4). Pure timing helpers for the `part_added` event: a gear flies in from the
// screen edge, lands on the skeleton with a spark, then a caption "Kiro added: <label>" fades.
// The reducer only stamps `since`; everything here is derived from `now` and the wave speed.

export interface EquipVM { part: string; since: number; spec?: string }

export const FLY_MS = 750;
export const SPARK_MS = 450;
export const CAPTION_MS = 2000;
/** Total life of one equip record before the reducer may drop it. */
export const EQUIP_LIFE_MS = FLY_MS + CAPTION_MS + 200;

export const PART_LABEL: Record<string, string> = {
  retry: 'Retry lantern', journal: 'Journal book', idempotency: 'Idempotency medal',
  breaker: 'Circuit breaker scarf', offline_queue: 'Offline queue crown',
};

export interface EquipPhase {
  /** 0..1 along the flight path (1 once landed). */
  fly: number;
  landed: boolean;
  /** 0..1 spark progress after landing, or -1 when no spark is showing. */
  spark: number;
  /** 0..1 caption progress, or -1 when hidden. */
  caption: number;
  done: boolean;
}

export function equipPhase(e: EquipVM, now: number, speed = 1, reduced = false): EquipPhase {
  const sp = speed > 0 ? speed : 1;
  const el = Math.max(0, now - e.since) * sp;
  const fly = reduced ? 1 : Math.min(1, el / FLY_MS);
  const landed = fly >= 1;
  const after = el - (reduced ? 0 : FLY_MS);
  return {
    fly, landed,
    spark: landed && after < SPARK_MS ? Math.max(0, after) / SPARK_MS : -1,
    caption: landed && after < CAPTION_MS ? Math.max(0, after) / CAPTION_MS : -1,
    done: after >= CAPTION_MS,
  };
}

/** Parts that should be shown as worn right now: installed parts minus gear still in flight. */
export function wornParts(parts: string[], equips: EquipVM[] | undefined, now: number, speed = 1, reduced = false): string[] {
  if (!equips?.length) return parts;
  const flying = new Set(equips.filter((e) => !equipPhase(e, now, speed, reduced).landed).map((e) => e.part));
  return flying.size ? parts.filter((p) => !flying.has(p)) : parts;
}

/** Point on the flight arc: quadratic bezier from the screen edge up and over to the skeleton. */
export function flightPoint(p: number, from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number; rot: number } {
  const e = 1 - Math.pow(1 - p, 2);
  const cx = (from.x + to.x) / 2, cy = Math.min(from.y, to.y) - 120;
  const u = 1 - e;
  return {
    x: u * u * from.x + 2 * u * e * cx + e * e * to.x,
    y: u * u * from.y + 2 * u * e * cy + e * e * to.y,
    rot: e * Math.PI * 4,
  };
}
