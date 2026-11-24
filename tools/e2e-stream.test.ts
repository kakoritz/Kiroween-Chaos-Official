// covers: stream-pack-app/R7 stream-pack-app/R7.1 SP-C5
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'e2e.mjs'), 'utf8');

describe('e2e script checks a Stream wave', () => {
  it('resets the intensity dial, switches to stream, runs a wave and requires zero validator violations on it', () => {
    const stream = src.slice(src.indexOf('// 6. stream'));
    const reset = stream.indexOf("post('/api/intensity', { level: 3 })");
    const sw = stream.indexOf("post('/api/app', { app: 'stream' })");
    const wave = stream.indexOf("post('/api/wave/start'");
    expect(reset).toBeGreaterThan(-1);
    expect(sw).toBeGreaterThan(reset);
    expect(wave).toBeGreaterThan(sw);
    expect(stream).toMatch(/zero violations/);
    expect(stream).toMatch(/sv\.code === 0/);
  });
});
