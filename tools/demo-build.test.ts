// TV3-C14: `npm run demo` must build the arena UI when dist/assets is missing, so a fresh clone never shows a blank page.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(__dirname, 'demo.mjs'), 'utf8');

describe('tools/demo.mjs', () => {
  it('builds the bots and then the UI before it starts the server', () => {
    const bots = src.indexOf("tools/build-bots.mjs");
    const gate = src.indexOf("packages/arena-ui/dist/assets");
    const ui = src.indexOf("'ui:build'");
    const start = src.indexOf("const child = run(");
    expect(bots).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(bots);
    expect(ui).toBeGreaterThan(gate);
    expect(start).toBeGreaterThan(ui);
  });
  it('only builds the UI when dist/assets is missing', () => {
    expect(src).toMatch(/if \(!existsSync\(resolve\(root, 'packages\/arena-ui\/dist\/assets'\)\)\)/);
  });
});
