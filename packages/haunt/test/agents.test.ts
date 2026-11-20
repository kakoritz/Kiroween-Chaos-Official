import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = (n: string) => fileURLToPath(new URL(`../../../.kiro/agents/${n}.json`, import.meta.url));

describe('kiro agents', () => {
  for (const name of ['chaos-director', 'reviewer']) {
    it(`${name} is a valid agent definition`, () => {
      expect(existsSync(dir(name))).toBe(true);
      const a = JSON.parse(readFileSync(dir(name), 'utf8'));
      expect(a.name).toBe(name);
      expect(typeof a.description).toBe('string');
      expect(a.prompt.length).toBeGreaterThan(100);
      expect(Array.isArray(a.tools)).toBe(true);
      expect(a.prompt).toMatch(/never|no real keys/i);
    });
  }
  it('reviewer cannot write source code paths', () => {
    const a = JSON.parse(readFileSync(dir('reviewer'), 'utf8'));
    const paths: string[] = a.toolsSettings.fs_write.allowedPaths;
    expect(paths.some((p) => p.startsWith('packages') || p.startsWith('apps'))).toBe(false);
  });
});
