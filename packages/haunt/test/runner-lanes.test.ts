import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { abandonedOrders, corruptNext, hauntFile, injectDuplicate, nextOrderFile, prepareLane, tiersForLanes } from '../src/runner/lanes';

const dir = mkdtempSync(join(tmpdir(), 'haunt-lanes-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const ids = (n: number, m?: 'race' | 'allPhoenix') => tiersForLanes(n, m).map((t) => t.id);

describe('lane to tier mapping (runtime 11)', () => {
  it('race sets', () => {
    expect(ids(1)).toEqual(['phoenix']);
    expect(ids(2)).toEqual(['rookie', 'phoenix']);
    expect(ids(3)).toEqual(['rookie', 'journaler', 'phoenix']);
    expect(ids(4)).toEqual(['rookie', 'retrier', 'journaler', 'phoenix']);
    expect(ids(5)).toEqual(['rookie', 'retrier', 'journaler', 'reconciler', 'phoenix']);
  });
  it('allPhoenix', () => expect(ids(3, 'allPhoenix')).toEqual(['phoenix', 'phoenix', 'phoenix']));
  it('rejects bad lane counts', () => {
    expect(() => tiersForLanes(0)).toThrow();
    expect(() => tiersForLanes(6)).toThrow();
  });
});

describe('lane input layout (runtime 5)', () => {
  it('writes orders and empty outcome folders', () => {
    const { paths, orders } = prepareLane(dir, 1, 'seed', 3);
    expect(orders).toHaveLength(3);
    expect(readdirSync(paths.orders)).toEqual(['ord-0001.json', 'ord-0002.json', 'ord-0003.json']);
    for (const d of ['done', 'failed', 'parked', 'quarantine'] as const) expect(readdirSync(paths[d])).toEqual([]);
    expect(JSON.parse(readFileSync(join(paths.orders, 'ord-0001.json'), 'utf8')).id).toBe('ord-0001');
  });
  it('same seed gives identical files', () => {
    const a = prepareLane(dir, 2, 's', 2);
    const b = prepareLane(dir, 3, 's', 2);
    expect(readFileSync(join(a.paths.orders, 'ord-0002.json'), 'utf8')).toBe(readFileSync(join(b.paths.orders, 'ord-0002.json'), 'utf8'));
  });
  it('duplicate sorts after the original and keeps the id', () => {
    const { paths } = prepareLane(dir, 4, 's', 2);
    expect(injectDuplicate(paths)).toBe('ord-0001.dup.json');
    expect(readdirSync(paths.orders)).toEqual(['ord-0001.dup.json', 'ord-0001.json', 'ord-0002.json'].sort());
    expect(JSON.parse(readFileSync(join(paths.orders, 'ord-0001.dup.json'), 'utf8')).id).toBe('ord-0001');
  });
  it('missing file is hidden then restored', () => {
    const { paths } = prepareLane(dir, 5, 's', 2);
    const restore = hauntFile(paths, 'ord-0001.json');
    expect(existsSync(join(paths.orders, 'ord-0001.json'))).toBe(false);
    expect(nextOrderFile(paths)).toBe('ord-0002.json');
    expect(abandonedOrders(paths)).toEqual(['ord-0001', 'ord-0002']);
    restore();
    expect(nextOrderFile(paths)).toBe('ord-0001.json');
  });
  it('malformed payload truncates and saves the original', () => {
    const { paths } = prepareLane(dir, 6, 's', 1);
    const orig = readFileSync(join(paths.orders, 'ord-0001.json'), 'utf8');
    expect(corruptNext(paths)).toBe('ord-0001.json');
    expect(() => JSON.parse(readFileSync(join(paths.orders, 'ord-0001.json'), 'utf8'))).toThrow();
    expect(readFileSync(join(paths.orig, 'ord-0001.json'), 'utf8')).toBe(orig);
  });
});
