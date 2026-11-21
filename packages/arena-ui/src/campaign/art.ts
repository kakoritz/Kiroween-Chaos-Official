// Campaign art (CP-ART): code-drawn SVG for the crypt map, medals, shop backdrop and gear icons. No image assets, no network.
// Pure functions that return SVG strings so they can be tested without a DOM.
export type MedalTier = 'bronze' | 'silver' | 'gold';
export type DoorArtState = 'locked' | 'open' | 'bronze' | 'silver' | 'gold';

const MEDAL_COLORS: Record<MedalTier, { fill: string; rim: string; shine: string; ribbon: string }> = {
  bronze: { fill: '#c98a4b', rim: '#7a4a1e', shine: '#f0c08a', ribbon: '#8a2f3c' },
  silver: { fill: '#cfd6e6', rim: '#7a869e', shine: '#ffffff', ribbon: '#3c5a8a' },
  gold: { fill: '#ffd34d', rim: '#9a7410', shine: '#fff2b0', ribbon: '#2f8a4a' },
};
const MEDAL_PIPS: Record<MedalTier, number> = { bronze: 1, silver: 2, gold: 3 };

/** A round medal with a ribbon and one, two or three pips for bronze, silver and gold. */
export function medalSvg(tier: MedalTier | null, size = 48): string {
  if (!tier) {
    return `<svg class="cpart cpart--medal cpart--medal-none" viewBox="0 0 48 60" width="${size}" height="${Math.round(size * 1.25)}" aria-hidden="true" focusable="false"><circle cx="24" cy="36" r="16" fill="none" stroke="#4a4268" stroke-width="3" stroke-dasharray="5 4"/></svg>`;
  }
  const c = MEDAL_COLORS[tier];
  const n = MEDAL_PIPS[tier];
  const pips = Array.from({ length: n }, (_, i) => `<circle cx="${24 + (i - (n - 1) / 2) * 8}" cy="36" r="2.6" fill="${c.rim}"/>`).join('');
  return `<svg class="cpart cpart--medal cpart--medal-${tier}" viewBox="0 0 48 60" width="${size}" height="${Math.round(size * 1.25)}" aria-hidden="true" focusable="false">
<path d="M14 2 L24 22 L34 2 L40 2 L28 26 L20 26 L8 2 Z" fill="${c.ribbon}" stroke="#14101f" stroke-width="1.5" stroke-linejoin="round"/>
<circle cx="24" cy="36" r="17" fill="${c.fill}" stroke="${c.rim}" stroke-width="3"/>
<circle cx="24" cy="36" r="12" fill="none" stroke="${c.rim}" stroke-width="1" opacity="0.6"/>
<path d="M13 30 A12 12 0 0 1 28 24" fill="none" stroke="${c.shine}" stroke-width="2.5" stroke-linecap="round"/>
${pips}</svg>`;
}

/** The padlock drawn on a locked door. */
export function lockSvg(size = 44): string {
  return `<svg class="cpart cpart--lock" viewBox="0 0 40 48" width="${size}" height="${Math.round(size * 1.2)}" aria-hidden="true" focusable="false"><path d="M11 22 V15 A9 9 0 0 1 29 15 V22" fill="none" stroke="#8a82b4" stroke-width="5" stroke-linecap="round"/><rect x="6" y="22" width="28" height="22" rx="4" fill="#5a527e" stroke="#14101f" stroke-width="2"/><circle cx="20" cy="31" r="3.2" fill="#14101f"/><rect x="18.7" y="31" width="2.6" height="7" rx="1" fill="#14101f"/></svg>`;
}

const DOOR_GLOW: Record<DoorArtState, string> = { locked: '#1c1830', open: '#ff9a3c', bronze: '#c98a4b', silver: '#cfd6e6', gold: '#ffd34d' };

/** A tombstone door: arched stone slab, cracks, moss and a glowing doorway (dark when locked, chained when locked). */
export function doorSvg(state: DoorArtState, n: number, finale = false): string {
  const glow = DOOR_GLOW[state];
  const locked = state === 'locked';
  const num = finale ? 'F' : String(n);
  const skull = finale ? '<g fill="#efe6d2" stroke="#14101f" stroke-width="1.5"><ellipse cx="60" cy="40" rx="12" ry="11"/><rect x="53" y="48" width="14" height="7" rx="2"/></g><g fill="#14101f"><circle cx="55.5" cy="40" r="3"/><circle cx="64.5" cy="40" r="3"/></g>' : '';
  const chains = locked ? '<path d="M18 110 L102 150 M102 110 L18 150" stroke="#8a82b4" stroke-width="5" stroke-dasharray="8 4" stroke-linecap="round" opacity="0.85"/>' : '';
  const flame = !locked ? `<path d="M60 150 C50 134 56 124 60 112 C64 124 70 134 60 150 Z" fill="${glow}" opacity="0.9"/>` : '';
  return `<svg class="cpart cpart--door cpart--door-${state}" viewBox="0 0 120 190" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid meet">
<defs><linearGradient id="cpstone-${n}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a4670"/><stop offset="1" stop-color="#25213f"/></linearGradient></defs>
<path d="M8 186 V70 A52 52 0 0 1 112 70 V186 Z" fill="url(#cpstone-${n})" stroke="#14101f" stroke-width="4"/>
<path d="M24 186 V84 A36 36 0 0 1 96 84 V186 Z" fill="${locked ? '#0d0b14' : '#17132a'}" stroke="#14101f" stroke-width="3"/>
<ellipse cx="60" cy="150" rx="26" ry="30" fill="${glow}" opacity="${locked ? 0.25 : 0.28}"/>
${flame}${skull}${chains}
<path d="M30 20 L38 34 L33 44 M92 30 L86 42 L90 52" fill="none" stroke="#14101f" stroke-width="2" opacity="0.6"/>
<path d="M8 176 Q20 168 30 178 T52 180 L8 186 Z" fill="#3c6a3c" opacity="0.7"/>
<text x="60" y="${finale ? 76 : 62}" text-anchor="middle" font-family="Georgia, serif" font-size="${finale ? 16 : 30}" font-weight="700" fill="#efe6d2" stroke="#14101f" stroke-width="0.8">${finale ? 'FINALE' : num}</text>
</svg>`;
}

/** A tiled crypt-wall backdrop for the shop (stone bricks, two wall torches, a cobweb). Drawn as one svg that fills its parent. */
export function shopBackdropSvg(): string {
  const rows = Array.from({ length: 9 }, (_, r) => {
    const y = r * 40;
    const off = r % 2 ? 0 : 40;
    const bricks = Array.from({ length: 11 }, (_, c) => `<rect x="${c * 80 - off}" y="${y}" width="78" height="38" rx="3"/>`).join('');
    return bricks;
  }).join('');
  const torch = (x: number): string => `<g transform="translate(${x} 70)"><rect x="-4" y="14" width="8" height="40" rx="2" fill="#5a3a1e" stroke="#14101f" stroke-width="2"/><path d="M0 14 C-14 0 -8 -14 0 -26 C8 -14 14 0 0 14 Z" fill="#ff9a3c"/><path d="M0 12 C-6 2 -3 -6 0 -12 C3 -6 6 2 0 12 Z" fill="#ffe08a"/><circle cx="0" cy="-4" r="46" fill="#ff9a3c" opacity="0.08"/></g>`;
  return `<svg class="cpart cpart--backdrop" viewBox="0 0 800 360" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
<rect width="800" height="360" fill="#171326"/>
<g fill="#25213f" stroke="#100d1c" stroke-width="2">${rows}</g>
<rect y="300" width="800" height="60" fill="#0d0b14" opacity="0.7"/>
${torch(90)}${torch(710)}
<path d="M0 0 Q70 40 110 110 M0 0 Q40 70 20 150 M0 0 L90 90 M0 30 Q40 50 70 20" fill="none" stroke="#efe6d2" stroke-width="1" opacity="0.3"/>
</svg>`;
}

export interface GearIconInfo { part: string; badge?: string }

const GLYPH: Record<string, string> = {
  retry: '<path d="M30 14 A16 16 0 1 0 38 30" fill="none" stroke="#ff9a3c" stroke-width="5" stroke-linecap="round"/><path d="M26 6 L36 15 L24 20 Z" fill="#ff9a3c"/>',
  journal: '<rect x="12" y="10" width="26" height="32" rx="3" fill="#7a5ab4" stroke="#14101f" stroke-width="2.5"/><path d="M18 18 H32 M18 25 H32 M18 32 H28" stroke="#efe6d2" stroke-width="2.5" stroke-linecap="round"/><rect x="12" y="10" width="5" height="32" fill="#4a3478"/>',
  idempotency: '<rect x="10" y="12" width="30" height="26" rx="3" fill="#efe6d2" stroke="#14101f" stroke-width="2.5"/><path d="M16 26 L22 32 L35 18" fill="none" stroke="#3c9a4a" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>',
  breaker: '<path d="M26 6 L14 28 H24 L20 44 L38 20 H27 Z" fill="#ffd34d" stroke="#14101f" stroke-width="2.5" stroke-linejoin="round"/>',
  offline_queue: '<rect x="8" y="30" width="34" height="12" rx="3" fill="#7ab8ff" stroke="#14101f" stroke-width="2.5"/><rect x="12" y="19" width="26" height="9" rx="3" fill="#a8d0ff" stroke="#14101f" stroke-width="2.5"/><rect x="16" y="8" width="18" height="9" rx="3" fill="#d4e8ff" stroke="#14101f" stroke-width="2.5"/>',
};

/** A 50 by 50 gear icon drawn in a round frame. Unknown parts fall back to the badge letter. */
export function gearIconSvg(g: GearIconInfo, size = 52): string {
  const glyph = GLYPH[g.part] ?? `<text x="25" y="34" text-anchor="middle" font-family="Georgia, serif" font-size="26" font-weight="700" fill="#ff9a3c">${(g.badge ?? '?').replace(/[&<>"]/g, '')}</text>`;
  return `<svg class="cpart cpart--gear cpart--gear-${GLYPH[g.part] ? g.part : 'other'}" viewBox="0 0 50 50" width="${size}" height="${size}" aria-hidden="true" focusable="false"><g transform="translate(0 0)">${glyph}</g></svg>`;
}
