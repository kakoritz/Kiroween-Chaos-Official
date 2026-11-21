// Parchment orders (UI-S6). Pure helpers: the queue shown in lane stats and the drop of one scroll
// into the skeleton's hand at `order_start`. The reducer only stamps `since`; all motion derives from `now`.

export interface OrderDropVM { since: number }

export const DROP_MS = 650;
export const QUEUE_MAX = 4;

/** Orders still waiting in the queue: the current one is already in hand. */
export function queueLeft(orderIndex: number, ordersTotal: number): number {
  return Math.max(0, ordersTotal - orderIndex);
}

/** Scrolls drawn in the queue (capped) and the "+n" overflow. */
export function queueShape(left: number): { shown: number; more: number } {
  return { shown: Math.min(QUEUE_MAX, left), more: Math.max(0, left - QUEUE_MAX) };
}

/** 0..1 progress of the drop, or -1 when no drop is playing. Reduced motion jumps straight to the hand. */
export function dropProgress(d: OrderDropVM | null | undefined, now: number, speed = 1, reduced = false): number {
  if (!d || reduced) return -1;
  const sp = speed > 0 ? speed : 1;
  const p = ((now - d.since) * sp) / DROP_MS;
  return p >= 0 && p < 1 ? p : -1;
}

/** Point on the drop path: an arc from the queue to the hand, with a small tumble that settles to 0. */
export function dropPoint(p: number, from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number; rot: number; scale: number } {
  const e = 1 - Math.pow(1 - p, 3);
  const cx = (from.x + to.x) / 2, cy = Math.min(from.y, to.y) - 90;
  const u = 1 - e;
  return {
    x: u * u * from.x + 2 * u * e * cx + e * e * to.x,
    y: u * u * from.y + 2 * u * e * cy + e * e * to.y,
    rot: (1 - e) * 0.9,
    scale: 0.85 + 0.15 * e,
  };
}
