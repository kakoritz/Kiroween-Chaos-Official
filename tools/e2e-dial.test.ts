import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'e2e.mjs'), 'utf8');

describe('e2e script keeps the global intensity dial from leaking between sections', () => {
  it('the plain waves raise the dial, and the inbox section resets it to the default level 3 before it starts its wave', () => {
    expect(src).toMatch(/for \(const level of \[5, 9\]\)/);
    const inbox = src.slice(src.indexOf('// 5. inbox'));
    const reset = inbox.indexOf("post('/api/intensity', { level: 3 })");
    const wave = inbox.indexOf("post('/api/wave/start'");
    expect(reset).toBeGreaterThan(-1);
    expect(wave).toBeGreaterThan(reset);
  });
});
