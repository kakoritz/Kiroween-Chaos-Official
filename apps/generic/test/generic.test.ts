// covers: modular-engine/R5.1 modular-engine/R5.3
// The generic bots run any registered app from its haunt.yaml, as real processes against the fake provider.
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { bundle, root, run } from './helpers';
import { TIERS } from '../../../packages/haunt/src/pipeline';

const COFFEE = join(root, 'packages/haunt/test/fixtures/apps/coffee');
const ENV = { HAUNT_APP: 'coffee', HAUNT_APP_DIR: COFFEE };

beforeAll(() => {
  execFileSync(process.execPath, [join(root, 'tools/build-bots.mjs')], { cwd: root, stdio: 'pipe' });
}, 60000);

describe('generic bot bundles', () => {
  it('--parts reports the parts of each tier', () => {
    for (const t of TIERS) expect(JSON.parse(execFileSync(process.execPath, [bundle(t.id), '--parts'], { encoding: 'utf8', env: { ...process.env, ...ENV } }))).toEqual({ parts: [...t.use] });
  });
  it('refuses to start for an app it cannot load', () => {
    expect(() => execFileSync(process.execPath, [bundle('rookie')], { encoding: 'utf8', stdio: 'pipe', env: { ...process.env, HAUNT_APP: 'nope', HAUNT_TIER: 'rookie' } })).toThrow();
  });
});

describe('a generic bot runs the Coffee Shop app', () => {
  it('a Rookie walks the four declared stages and writes its effects', async () => {
    const r = await run(ENV, 'rookie', 2, false);
    expect(r.done.sort()).toEqual(['ord-0001.json', 'ord-0002.json']);
    expect(r.msgs.filter((m) => m.type === 'stage_done' && m.order === 'ord-0001').map((m) => m.stage)).toEqual(['read_request', 'pay', 'brew', 'ready']);
    expect(r.rows.filter((x) => x.kind === 'charge').length).toBe(2);
    expect(r.rows.filter((x) => x.kind === 'notify').length).toBe(2);
  }, 60000);

  it('a Rookie that dies right after the payment charges twice', async () => {
    const r = await run(ENV, 'rookie', 1, true);
    expect(r.kills).toBe(1);
    expect(r.rows.filter((x) => x.kind === 'charge').length).toBeGreaterThan(1);
  }, 60000);

  it('a Phoenix that dies right after the payment charges once', async () => {
    const r = await run(ENV, 'phoenix', 1, true);
    expect(r.kills).toBe(1);
    expect(r.done).toEqual(['ord-0001.json']);
    expect(r.rows.filter((x) => x.kind === 'charge').length).toBe(1);
    expect(r.rows.filter((x) => x.kind === 'notify').length).toBe(1);
  }, 60000);
});
