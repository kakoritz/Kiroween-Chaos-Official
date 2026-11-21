// Captions tracks: data files under packages/core/demo/<script>.captions.json. Spec: onboarding spec.md section 4.
import hero from '../../demo/hero.captions.json';
import full from '../../demo/full.captions.json';
import loop from '../../demo/loop.captions.json';

/** Event trigger, same shape as a demo press `when` (lane optional here), or a time offset in 1x ms. */
export interface CaptionAt { ms?: number; event?: string; lane?: number; stage?: string; order?: string; attempt?: number }
export interface Caption { at: CaptionAt; text: string; ms: number }

export const CAPTION_SCRIPTS = ['hero', 'full', 'loop'] as const;
const MAX_LEN = 80;

/** Throws with a readable message if the track is malformed. */
export function validateCaptions(raw: unknown): Caption[] {
  const bad = (m: string): never => { throw new Error(`captions: ${m}`); };
  if (!Array.isArray(raw) || raw.length === 0) bad('must be a non-empty array');
  for (const [i, c] of (raw as Caption[]).entries()) {
    if (!c || typeof c !== 'object' || !c.at || typeof c.at !== 'object') bad(`#${i} needs at`);
    const hasMs = c.at.ms !== undefined, hasEvent = c.at.event !== undefined;
    if (hasMs === hasEvent) bad(`#${i} at needs exactly one of ms or event`);
    if (hasMs && (!Number.isFinite(c.at.ms) || (c.at.ms as number) < 0)) bad(`#${i} at.ms`);
    if (hasEvent && (typeof c.at.event !== 'string' || !c.at.event)) bad(`#${i} at.event`);
    if (c.at.lane !== undefined && (!Number.isInteger(c.at.lane) || c.at.lane < 1 || c.at.lane > 5)) bad(`#${i} lane`);
    if (typeof c.text !== 'string' || !c.text.trim()) bad(`#${i} text`);
    else if (c.text.length > MAX_LEN) bad(`#${i} text over ${MAX_LEN} characters`);
    if (!Number.isFinite(c.ms) || c.ms < 500 || c.ms > 10000) bad(`#${i} ms must be 500 to 10000`);
  }
  return raw as Caption[];
}

const TRACKS: Record<string, unknown> = { hero, full, loop };

/** Captions for one demo script. Throws for an unknown script. */
export function loadCaptions(script: string): Caption[] {
  if (!Object.prototype.hasOwnProperty.call(TRACKS, script)) throw new Error(`unknown demo script: ${script}`);
  return validateCaptions(TRACKS[script]);
}
