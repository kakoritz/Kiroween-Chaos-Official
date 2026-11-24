// Stage fit (E3 responsive). Wide viewports show the whole 1920x1080 design stage letterboxed. Narrow or portrait
// viewports (phones) fit the arena band to the width and flow header, rank board, ledger and ticker below it.
export const STAGE_W = 1920;
export const STAGE_H = 1080;
/** The arena band inside the design stage: lanes start under the 72 px header and run 768 px. */
export const ARENA_TOP = 72;
export const ARENA_H = 768;
export const NARROW_MAX_W = 820;

export function isNarrow(w: number, h: number): boolean {
  return w < NARROW_MAX_W || w < h;
}

export interface Fit { narrow: boolean; scale: number; left: number; top: number; bandH: number }

export function computeFit(w: number, h: number): Fit {
  if (isNarrow(w, h)) {
    const scale = w / STAGE_W;
    return { narrow: true, scale, left: 0, top: -ARENA_TOP * scale, bandH: ARENA_H * scale };
  }
  const scale = Math.min(w / STAGE_W, h / STAGE_H);
  return { narrow: false, scale, left: (w - STAGE_W * scale) / 2, top: (h - STAGE_H * scale) / 2, bandH: STAGE_H * scale };
}

/** True when the header tagline is wider than the room it was given (it would show an ellipsis). */
export const taglineClipped = (scrollW: number, clientW: number): boolean => scrollW > clientW + 1;
