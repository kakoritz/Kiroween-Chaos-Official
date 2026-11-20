// H6.7 The three Kiro hooks in .kiro/hooks/ parse and point at real files and scripts.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.kiro', 'hooks');
const hooks = readdirSync(dir).filter((f) => f.endsWith('.kiro.hook')).map((f) => ({ f, h: JSON.parse(readFileSync(join(dir, f), 'utf8')) }));

describe('kiro hooks', () => {
  it('has the three required hooks', () => {
    expect(hooks.map((x) => x.f).sort()).toEqual([
      'fixtures-on-contract-save.kiro.hook',
      'pbt-on-sdk-save.kiro.hook',
      'reviewer-on-wave-end.kiro.hook',
    ]);
  });
  it('each hook is enabled with a trigger and an action', () => {
    for (const { h } of hooks) {
      expect(h.enabled).toBe(true);
      expect(h.when.type).toBeTruthy();
      expect(h.then.type).toBeTruthy();
    }
  });
  it('the PBT hook runs an existing test and the validate script exists', () => {
    const pbt = hooks.find((x) => x.f.startsWith('pbt'))!.h;
    expect(existsSync(join(dir, '..', '..', pbt.then.command.split(' ').pop()))).toBe(true);
    const pkg = JSON.parse(readFileSync(join(dir, '..', '..', 'package.json'), 'utf8'));
    expect(pkg.scripts['validate:events']).toBeTruthy();
  });
});

