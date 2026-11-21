/** The 3-minute demo playlist (docs/DEMO-SCRIPT.md): calm race and Payment crash, stacked chaos and boss, then the hardening loop. */
export const DEMO_PLAYLIST = ['hero', 'full', 'loop'] as const;

export interface AutoplayInput {
  search: string;
  demoRunning: boolean;
  waveRunning: boolean;
  /** Script names the server advertises in state.demo.scripts, or null if unknown. */
  available: string[] | null;
}

export interface AutoplayDecision {
  /** Script to start on load, or null to stay quiet. */
  start: string | null;
  /** True when the UI should chain the playlist after each script ends. */
  chain: boolean;
}

/**
 * Demo mode plays on load. `?demo=off` (or `none`, `0`) keeps the arena quiet, `?demo=<name>` plays
 * exactly that script once, and no parameter plays the full playlist. A show that is already
 * running is never interrupted.
 */
export function autoplayDecision(i: AutoplayInput): AutoplayDecision {
  const raw = new URLSearchParams(i.search).get('demo');
  const q = raw && /^[a-z0-9_-]{1,32}$/i.test(raw) ? raw.toLowerCase() : null;
  if (q === 'off' || q === 'none' || q === '0') return { start: null, chain: false };
  if (i.demoRunning || i.waveRunning) return { start: null, chain: !q };
  if (q) return { start: q, chain: false };
  const first = pickScript(null, i.available);
  return { start: first, chain: first !== null };
}

/** Next script after `current` in the playlist, wrapping around; only scripts the server has. */
export function pickScript(current: string | null, available: string[] | null): string | null {
  const ok = DEMO_PLAYLIST.filter((s) => !available || available.length === 0 || available.includes(s));
  if (ok.length === 0) return null;
  const at = current ? ok.indexOf(current as (typeof ok)[number]) : -1;
  return ok[(at + 1) % ok.length]!;
}
