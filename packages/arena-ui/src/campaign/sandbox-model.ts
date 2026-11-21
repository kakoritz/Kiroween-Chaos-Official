// Campaign sandbox model (CP-U4). Pure functions; the DOM lives in sandbox.ts.
// A sandbox run is practice: it never writes credits, medals, best scores or unlocks. Only the last run summary is kept, under its own key.
import { medalFor, type LaneSummary, type Medal, type ResultNight } from './results-model';

export const SANDBOX_KEY = 'haunt.campaign.sandbox.last.v1';

export interface SandboxRun { night: number; parts: string[]; score: number; timeMs: number; medal: Medal; repeats?: number }

const MEDALS: readonly Medal[] = ['none', 'bronze', 'silver', 'gold'];
const medalRank = (m: Medal): number => MEDALS.indexOf(m);
const num = (v: unknown, fb = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fb);

/** Builds the run summary from the lane 1 wave summary. Medal uses the night's own thresholds but is never recorded as progress. */
export function summarizeRun(night: ResultNight, s: LaneSummary, parts: readonly string[], timeMs: number): SandboxRun {
  const run: SandboxRun = { night: night.id, parts: [...parts].sort(), score: Math.floor(num(s.score)), timeMs: Math.max(0, Math.round(num(timeMs))), medal: medalFor(night, s) };
  if (typeof s.repeats === 'number' && Number.isFinite(s.repeats)) run.repeats = s.repeats;
  return run;
}

export function loadLastRun(store: Pick<Storage, 'getItem'> | undefined): SandboxRun | undefined {
  try {
    const o = JSON.parse(store?.getItem(SANDBOX_KEY) ?? 'null') as Record<string, unknown> | null;
    if (!o || typeof o !== 'object') return undefined;
    if (typeof o.night !== 'number' || typeof o.score !== 'number' || typeof o.timeMs !== 'number' || !MEDALS.includes(o.medal as Medal)) return undefined;
    const parts = Array.isArray(o.parts) ? o.parts.filter((p): p is string => typeof p === 'string') : [];
    const run: SandboxRun = { night: o.night, parts, score: o.score, timeMs: o.timeMs, medal: o.medal as Medal };
    if (typeof o.repeats === 'number') run.repeats = o.repeats;
    return run;
  } catch { return undefined; }
}

/** Writes only the sandbox key. Never touches the campaign progress record. */
export function saveLastRun(store: Pick<Storage, 'setItem'> | undefined, run: SandboxRun): void {
  try { store?.setItem(SANDBOX_KEY, JSON.stringify(run)); } catch { /* storage unavailable: the comparison just starts fresh next time */ }
}

export type Trend = 'better' | 'worse' | 'same';
export interface Compare {
  sameNight: boolean;
  score: { prev: number; cur: number; delta: number; trend: Trend };
  time: { prev: number; cur: number; delta: number; trend: Trend };
  medal: { prev: Medal; cur: Medal; trend: Trend };
  gearAdded: string[];
  gearRemoved: string[];
}

const trendOf = (delta: number, higherIsBetter: boolean): Trend => (delta === 0 ? 'same' : (delta > 0) === higherIsBetter ? 'better' : 'worse');

/** Compares a run against the previous one. Score and medal: higher is better. Time: shorter is better. */
export function compareRuns(prev: SandboxRun, cur: SandboxRun): Compare {
  const dScore = cur.score - prev.score;
  const dTime = cur.timeMs - prev.timeMs;
  const dMedal = medalRank(cur.medal) - medalRank(prev.medal);
  return {
    sameNight: prev.night === cur.night,
    score: { prev: prev.score, cur: cur.score, delta: dScore, trend: trendOf(dScore, true) },
    time: { prev: prev.timeMs, cur: cur.timeMs, delta: dTime, trend: trendOf(dTime, false) },
    medal: { prev: prev.medal, cur: cur.medal, trend: trendOf(dMedal, true) },
    gearAdded: cur.parts.filter((p) => !prev.parts.includes(p)),
    gearRemoved: prev.parts.filter((p) => !cur.parts.includes(p)),
  };
}

export function formatTime(ms: number): string {
  const s = Math.round(num(ms) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const signed = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `-${Math.abs(n)}` : '0');

/** Plain-words lines for the comparison panel. */
export function describeCompare(c: Compare): string[] {
  const out: string[] = [];
  if (!c.sameNight) out.push('Your last run was a different night, so the numbers are not a fair match.');
  out.push(`Score ${c.score.cur} (last ${c.score.prev}, ${signed(c.score.delta)}).`);
  const tdelta = Math.round(c.time.delta / 1000);
  out.push(`Time ${formatTime(c.time.cur)} (last ${formatTime(c.time.prev)}, ${tdelta > 0 ? `${tdelta} s slower` : tdelta < 0 ? `${-tdelta} s faster` : 'the same'}).`);
  out.push(c.medal.cur === c.medal.prev ? `Medal ${c.medal.cur} (same as last run).` : `Medal ${c.medal.cur} (last ${c.medal.prev}).`);
  if (c.gearAdded.length) out.push(`Gear added: ${c.gearAdded.join(', ')}.`);
  if (c.gearRemoved.length) out.push(`Gear removed: ${c.gearRemoved.join(', ')}.`);
  return out;
}
