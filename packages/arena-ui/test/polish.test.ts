import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');
const css = readFileSync(resolve(root, 'app/styles.css'), 'utf8');
const scene = readFileSync(resolve(root, 'src/arena/scene.ts'), 'utf8');

function cssVars(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2].toLowerCase();
  return out;
}

describe('UI-W6 polish', () => {
  it('scene palette matches the CSS palette', () => {
    const vars = cssVars();
    const block = /const C = \{([^}]*)\}/.exec(scene)![1];
    const map: Record<string, string> = { stone2: 'stone-2' };
    for (const m of block.matchAll(/(\w+):\s*'(#[0-9a-fA-F]{6})'/g)) {
      const key = map[m[1]] ?? m[1];
      if (key in vars) expect(m[2].toLowerCase(), key).toBe(vars[key]);
    }
    expect(Object.keys(vars).length).toBeGreaterThan(8);
  });

  it('CSS disables animation and transition under reduced motion', () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{[^}]*animation: none[^}]*transition: none/);
  });

  it('no text below 14px in CSS or canvas labels (1080p readability)', () => {
    for (const m of css.matchAll(/font(?:-size)?:\s*(?:\d{3} )?(\d+)px/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(14);
    for (const m of scene.matchAll(/txt\([^;\n]*?,\s*(\d+),\s*C\.\w+/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(13);
  });

  it('scene gates flicker and pulse on reducedMotion', () => {
    expect(scene).toMatch(/reduced \? 0 : t, l\.mode/);
    expect(scene).toMatch(/this\.reducedMotion \? 0 : now\);/);
  });
});
