import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { LiveServer, lineDelta, loopFixEvents } from '../src/live';

let srv: LiveServer | undefined;
const dirs: string[] = [];
afterEach(async () => {
  await srv?.close(); srv = undefined;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'loopfix-'));
  dirs.push(root);
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'a.ts'), 'one\ntwo\nthree\n');
  writeFileSync(join(root, 'src', 'b.ts'), 'one\ntwo\nfour\nfive\n');
  writeFileSync(join(root, 'before.js'), 'console.log(JSON.stringify({parts:["retry"]}))');
  writeFileSync(join(root, 'after.js'), 'console.log(JSON.stringify({parts:["retry","journal","idempotency"]}))');
  return root;
}

describe('loop fix events', () => {
  it('lineDelta counts added and deleted lines', () => {
    expect(lineDelta('a\nb\nc', 'a\nb\nd\ne')).toEqual({ add: 2, del: 1 });
  });

  it('emits spec, recorded fix, then one part_added per new part', () => {
    const root = fixture();
    const evs = loopFixEvents({
      lane: '1', root, beforeSrc: 'src/a.ts', afterSrc: 'src/b.ts',
      beforeBundle: join(root, 'before.js'), afterBundle: join(root, 'after.js'),
      hardening: () => ({ spec: 'hardening-x', title: 'Fixes', files: [{ path: 'r.md', content: 'F1 and F2, F1 again' }] }),
    });
    expect(evs.map((e) => e.type)).toEqual(['hardening_spec', 'fix_applied', 'part_added', 'part_added']);
    expect((evs[0] as any).detail).toMatchObject({ spec: 'hardening-x', title: 'Fixes', findings: 2 });
    expect((evs[1] as any).lane).toBeUndefined();
    expect((evs[1] as any).detail).toMatchObject({ recorded: true, files: [{ path: 'src/b.ts', add: 2, del: 1 }] });
    expect(evs.slice(2).map((e: any) => [e.lane, e.detail.part])).toEqual([['1', 'journal'], ['1', 'idempotency']]);
  });

  it('server emits them with the finished wave number before the next wave_start', async () => {
    srv = new LiveServer({
      staticDir: '/nonexistent',
      engine: { betweenWaves: (prev) => [{ type: 'part_added', lane: '1', detail: { part: `p${prev}`, source: 'hardening_spec' } } as any] },
    });
    const { url } = await srv.listen(0);
    const post = (p: string, b?: unknown) => fetch(url + p, { method: 'POST', body: b === undefined ? undefined : JSON.stringify(b) });
    await post('/api/wave/start', { orders: 1, lanes: 1 });
    await post('/api/wave/stop');
    await post('/api/wave/start', { orders: 1, lanes: 1 });
    const evs = srv.log.events;
    const i = evs.findIndex((e) => e.type === 'part_added');
    expect(i).toBeGreaterThan(0);
    expect(evs[i]!.wave).toBe(1);
    expect(evs[i - 1]!.type).toBe('wave_end');
    expect(evs[i + 1]).toMatchObject({ type: 'wave_start', wave: 2 });
    expect(evs.filter((e) => e.type === 'part_added')).toHaveLength(1);
  });

  const bundles = ['rookie', 'rookie.hardened'].map((n) => join(process.cwd(), 'dist', 'bots', n + '.js'));
  it.skipIf(!bundles.every((b) => existsSync(b)))('real Rookie bundles: hardening adds retry, journal and idempotency', () => {
    const evs = loopFixEvents({ lane: '1', root: process.cwd(), beforeSrc: 'apps/haunted-orders/src/bots/rookie.ts', afterSrc: 'apps/haunted-orders/src/bots/rookie.hardened.ts', beforeBundle: bundles[0]!, afterBundle: bundles[1]! });
    expect(evs.filter((e) => e.type === 'part_added').map((e: any) => e.detail.part).sort()).toEqual(['idempotency', 'journal', 'retry']);
  });
});