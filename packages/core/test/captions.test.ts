import { describe, expect, it } from 'vitest';
import { CAPTION_SCRIPTS, loadCaptions, validateCaptions } from '../src/live/captions';
import { loadDemo } from '../src/live/demo';

describe('captions tracks', () => {
  for (const n of CAPTION_SCRIPTS) {
    it(`${n} loads, validates and fits two lines`, () => {
      const c = loadCaptions(n);
      expect(c.length).toBeGreaterThan(2);
      expect(loadDemo(n).name).toBe(n);
      for (const x of c) expect(x.text.length).toBeLessThanOrEqual(80);
    });
  }
  it('rejects bad tracks and unknown scripts', () => {
    expect(() => validateCaptions([])).toThrow(/non-empty/);
    expect(() => validateCaptions([{ at: {}, text: 'x', ms: 1000 }])).toThrow(/exactly one/);
    expect(() => validateCaptions([{ at: { ms: 0 }, text: 'x', ms: 10 }])).toThrow(/ms must be/);
    expect(() => loadCaptions('nope')).toThrow(/unknown demo/);
  });
});
