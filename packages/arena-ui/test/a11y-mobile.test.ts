import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio, meetsAA, waveStateText } from '../src/a11y';
import { computeFit } from '../src/arena/layout';
import { HOW_CAPTION, architectureSvg } from '../src/onboarding/how-it-works';

const read = (p: string): string => readFileSync(new URL(p, import.meta.url), 'utf8');
const css = read('../app/styles.css');
const a11yCss = read('../src/a11y.css');
const main = read('../app/main.ts');
const tok = (n: string): string => new RegExp(`--${n}:\\s*(#[0-9a-fA-F]{6})`).exec(css)![1]!;

describe('a11y-mobile focus (R1)', () => {
  // covers: a11y-mobile/R1
  it('has a global 3px focus ring for every interactive element kind', () => {
    for (const sel of ['button', 'input', 'select', 'a', 'summary', '[tabindex]']) expect(a11yCss).toContain(`${sel}:focus-visible`);
    expect(a11yCss).toMatch(/outline:\s*3px solid/);
  });
  // covers: a11y-mobile/R1
  it('uses no positive tabindex anywhere in the app shell', () => {
    expect(main).not.toMatch(/tabindex=["']?[1-9]/i);
    expect(main.indexOf('id="tour-open"')).toBeLessThan(main.indexOf('id="demo-open"'));
  });
});

describe('a11y-mobile names and canvas (R2, R3)', () => {
  // covers: a11y-mobile/R2
  it('labels the symbol buttons and landmarks', () => {
    for (const id of ['keys-btn', 'legend-btn', 'gear-btn', 'mute']) expect(new RegExp(`id="${id}"[^>]*aria-label=`).test(main), id).toBe(true);
    expect(main).toContain('role="main"');
    expect(main).toMatch(/<canvas id="arena"[^>]*role="img"/);
    expect(main.match(/<section class="panel[^>]*aria-label=/g)?.length).toBe(3);
  });
  // covers: a11y-mobile/R3
  it('has canvas fallback text and a polite wave-state live region', () => {
    expect(main).toMatch(/<canvas id="arena"[^>]*>[^<]+<\/canvas>/);
    expect(main).toMatch(/id="wave-state" aria-live="polite"/);
  });
  // covers: a11y-mobile/R3
  it('summarises wave state: empty, leader and active chaos', () => {
    expect(waveStateText(0, [])).toMatch(/No wave running/);
    const t = waveStateText(3, [{ lane: 1, tier: 'a', score: 5, creatures: [] }, { lane: 2, tier: 'b', score: 9, creatures: [{ id: 'slow_db' }] }]);
    expect(t).toBe('Wave 3, 2 lanes. Lane 2 leads with 9. Active chaos: slow db.');
    expect(waveStateText(1, [{ lane: 1, tier: 'a', score: 0 }])).toContain('No active chaos');
  });
});

describe('a11y-mobile contrast (R4)', () => {
  // covers: a11y-mobile/R4
  it('computes known ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(meetsAA('#777777', '#ffffff')).toBe(false);
  });
  // covers: a11y-mobile/R4
  it('meets AA for every text token on stone, stone-2 and bg', () => {
    for (const fg of ['muted', 'fail', 'ok', 'warn', 'ghost', 'hex-text', 'torch', 'bone', 'text']) {
      for (const bg of ['stone', 'stone-2', 'bg']) expect(meetsAA(tok(fg), tok(bg)), `${fg} on ${bg}: ${contrastRatio(tok(fg), tok(bg)).toFixed(2)}`).toBe(true);
    }
  });
  // covers: a11y-mobile/R4
  it('meets AA for white text on the purple pill and active tab', () => {
    expect(meetsAA('#ffffff', tok('hex-bg'))).toBe(true);
    expect(css).toMatch(/\.pill \{[^}]*background: var\(--hex-bg\)/);
  });
});

describe('a11y-mobile motion (R5)', () => {
  // covers: a11y-mobile/R5
  it('keeps the global reduced-motion rule and the in-app body class hook', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \*, \*::before, \*::after \{ animation-/);
    expect(main).toContain("classList.toggle('reduced-motion'");
    expect(main).toContain('scene.reducedMotion');
  });
});

describe('a11y-mobile narrow layout (R6)', () => {
  // covers: a11y-mobile/R6
  it('uses the narrow flow at phone and tablet widths', () => {
    for (const [w, h] of [[360, 740], [390, 844], [430, 932], [768, 1024]] as const) {
      const f = computeFit(w, h);
      expect(f.narrow, `${w}x${h}`).toBe(true);
      expect(1920 * f.scale).toBeCloseTo(w);
    }
  });
  // covers: a11y-mobile/R6
  it('stops horizontal scroll and lets the header wrap and shrink', () => {
    expect(css).toMatch(/body\.narrow #app \{ overflow-x: hidden/);
    expect(css).toMatch(/body\.narrow \.hdr \{[^}]*flex-wrap: wrap/);
    expect(a11yCss).toMatch(/@media \(max-width: 430px\)/);
    expect(a11yCss).toMatch(/body\.narrow \.hdr > \* \{ min-width: 0/);
  });
});

describe('a11y-mobile stale text (R7)', () => {
  // covers: a11y-mobile/R7
  it('says three apps in the caption and the diagram', () => {
    expect(HOW_CAPTION).toMatch(/Three apps/);
    expect(HOW_CAPTION).not.toMatch(/two apps/i);
    const svg = architectureSvg();
    for (const n of ['Orders', 'Ticket Desk', 'Stream']) expect(svg).toContain(n);
    expect(svg).toMatch(/three apps/i);
    expect(svg).not.toMatch(/two apps|app 2: .*\n.*app 2/i);
  });
});
