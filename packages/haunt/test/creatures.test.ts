import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CreatureRegistry, loadCreatures, validateCreature } from '../src/creatures';

const good = (id: string, faults = ['timeout']) => ({
  id, label: id, family: 'network', faults, async inject() {}, async cleanup() {},
});

describe('creature plugins', () => {
  it('validates shape', () => {
    expect(validateCreature(good('zombie'))).toEqual([]);
    expect(validateCreature(null)).toHaveLength(1);
    expect(validateCreature({ ...good('Zombie'), family: 'x', faults: [] }).length).toBe(3);
    expect(validateCreature({ ...good('a'), inject: 1 })).toContain('inject must be a function');
  });

  it('registers, looks up and rejects duplicates', () => {
    const r = new CreatureRegistry();
    r.register(good('zombie', ['timeout', 'slow_link']));
    r.register({ ...good('ghost', ['http_404']), family: 'http' });
    expect(r.list().map((c) => c.id)).toEqual(['ghost', 'zombie']);
    expect(r.forFault('slow_link')?.id).toBe('zombie');
    expect(r.byFamily('http').map((c) => c.id)).toEqual(['ghost']);
    expect(() => r.register(good('zombie'))).toThrow(/duplicate/);
    expect(() => r.register({ id: 'x' })).toThrow(/invalid creature/);
  });

  describe('loader', () => {
    let dir = '';
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), 'creatures-'));
      writeFileSync(join(dir, 'b.mjs'), "export default { id: 'b', label: 'B', family: 'data', faults: ['f'], inject() {} };\n");
      writeFileSync(join(dir, 'a.mjs'), "export default { id: 'a', label: 'A', family: 'world', faults: ['g'], inject() {} };\n");
      writeFileSync(join(dir, 'notes.txt'), 'ignored');
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it('loads plugin files from a directory', async () => {
      const r = await loadCreatures(dir);
      expect(r.list().map((c) => c.id)).toEqual(['a', 'b']);
    });

    it('missing directory loads nothing; no default export errors', async () => {
      expect((await loadCreatures(join(dir, 'nope'))).list()).toEqual([]);
      await expect(loadCreatures(dir, new CreatureRegistry(), async () => ({}))).rejects.toThrow(/no default export/);
    });
  });
});
