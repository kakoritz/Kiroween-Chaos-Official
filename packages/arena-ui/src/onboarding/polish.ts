/** First-impression polish (ON-U4): pure label decisions so the first load shows no MOCK or "Wave -" noise. */
import type { ModeBadge } from '../mode';

export interface RunProgress {
  /** Highest wave number seen so far (0 before the first wave). */
  waveNo: number;
  demoRunning: boolean;
}

export function hasStarted(p: RunProgress): boolean {
  return p.waveNo > 0 || p.demoRunning;
}

/** Header wave text. Empty until a wave exists, so the idle header carries one title and one tagline only. */
export function waveLabel(waveNo: number): string {
  return waveNo > 0 ? `Wave ${waveNo}` : '';
}

/** Quiet state label: an idle mock server reads "Ready" instead of "MOCK". Live, browser and error states are untouched. */
export function quietBadge(b: ModeBadge, p: RunProgress): ModeBadge {
  if (b.tone === 'mock' && !hasStarted(p)) {
    return { ...b, label: 'Ready', title: `${b.title} Nothing is running yet.` };
  }
  return b;
}

/** Rank board crown: only the leader, and only once it has scored. */
export function rankGlyph(index: number, score: number): string {
  return index === 0 && score > 0 ? '\u265B' : String(index + 1);
}
