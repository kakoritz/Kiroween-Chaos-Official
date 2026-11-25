import './a11y.css';

const lin = (v: number): number => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

export function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => lin(parseInt(h.slice(i, i + 2), 16) / 255)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export const meetsAA = (fg: string, bg: string, large = false): boolean => contrastRatio(fg, bg) >= (large ? 3 : 4.5);

/** Canvas fallback and live-region text for the current wave. */
export function waveStateText(wave: number, lanes: readonly { lane: number; tier: string; score: number; creatures?: readonly { id: string }[] }[]): string {
  if (lanes.length === 0) return 'No wave running. Press Play demo or Start tournament.';
  const lead = lanes.reduce((a, b) => (b.score > a.score ? b : a));
  const ids = [...new Set(lanes.flatMap((l) => (l.creatures ?? []).map((c) => c.id.replace(/_/g, ' '))))];
  return `Wave ${wave}, ${lanes.length} lanes. Lane ${lead.lane} leads with ${lead.score}. ${ids.length ? `Active chaos: ${ids.join(', ')}.` : 'No active chaos.'}`;
}
