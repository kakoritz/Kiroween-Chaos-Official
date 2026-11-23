// CP-U5: campaign lane styling. Lane 1 is the player's Crew (`tier: "crew"`); the other lanes are rivals and are drawn ghosted.
// Pure helpers, no DOM, no clock.
export const CREW_TIER = 'crew';
export const CREW_NAME = 'Your Crew';
export const GEAR_TOTAL = 5;
/** Alpha of the dark veil over a rival lane. Static, so reduced motion needs no special case. */
export const RIVAL_VEIL = 0.42;

interface LaneLike { tier: string; parts?: readonly string[] }

export const isCrewLane = (l: LaneLike): boolean => l.tier === CREW_TIER;

/** A campaign night is on when one lane is the Crew and at least one other lane is a rival. */
export const campaignOn = (lanes: readonly LaneLike[]): boolean => lanes.length > 1 && lanes.some(isCrewLane);

export const isRival = (l: LaneLike, lanes: readonly LaneLike[]): boolean => campaignOn(lanes) && !isCrewLane(l);

/** Number of distinct gear parts worn, capped at the five slots. */
export const gearCount = (l: LaneLike): number => Math.min(GEAR_TOTAL, new Set(l.parts ?? []).size);

/** Compact form drawn on the label card, e.g. "2/5". */
export const gearFraction = (l: LaneLike): string => `${gearCount(l)}/${GEAR_TOTAL}`;

export const gearBadge = (l: LaneLike): string => `GEAR ${gearCount(l)}/${GEAR_TOTAL}`;

export const gearBadgeTip = (l: LaneLike): string => {
  const n = gearCount(l);
  return n === 0 ? 'No gear yet. Buy parts in the shop to harden your Crew.' : `${n} of ${GEAR_TOTAL} gear parts on your Crew: ${[...new Set(l.parts)].join(', ')}.`;
};

/** Credit count-up: the number shown `ms` after the animation starts. Reduced motion (or a zero duration) shows the total at once. */
export function creditCount(total: number, ms: number, durMs: number, reduced: boolean): number {
  if (reduced || durMs <= 0 || ms >= durMs) return total;
  const p = Math.max(0, ms) / durMs;
  return Math.floor(total * (1 - (1 - p) ** 3));
}
