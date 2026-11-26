// covers: modular-engine/R6.1 modular-engine/R6.4 modular-engine/R6.6
// Haunted Playback (11 stages, library blocks only) and the Coffee Shop (4 stages, config only) run on the generic bots.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { registerBundledApps } from '../../../packages/haunt/src/config/bundled-apps';
import { FAULTS, faultFacesStage } from '../../../packages/haunt/src/chaos/catalog';
import { APPS } from '../../../packages/haunt/src/shared/catalog';
import { bundle, root, run } from './helpers';

const PLAY = { HAUNT_APP: 'playback', HAUNT_APP_DIR: join(root, 'apps/haunted-playback') };
const SHOP = { HAUNT_APP: 'coffee-shop', HAUNT_APP_DIR: join(root, 'examples/coffee-shop') };
const STAGES = ['login', 'profile', 'browse', 'title_select', 'entitlement', 'license', 'start_stream', 'buffering', 'render', 'ads', 'finish'];

beforeAll(() => { execFileSync(process.execPath, [join(root, 'tools/build-bots.mjs')], { cwd: root, stdio: 'pipe' }); }, 60000);

describe('bundled apps', () => {
  // covers: modular-engine/R6.1
  it('register with no errors and Playback has the eleven viewer stages of the Streaming pack', () => {
    const results = registerBundledApps(root);
    expect(results.every((r) => r.ok), JSON.stringify(results.filter((r) => !r.ok))).toBe(true);
    expect(APPS.playback!.stages.map((s) => s.id)).toEqual(STAGES);
    expect(APPS.playback!.stages.map((s) => s.role)).toEqual(['effect', 'work', 'input', 'work', 'effect', 'effect', 'effect', 'poll', 'work', 'effect', 'effect']);
    expect(APPS.playback!.stages.every((s) => s.block !== undefined)).toBe(true);
    expect(APPS['coffee-shop']!.stages.map((s) => s.id)).toEqual(['read_request', 'pay', 'brew', 'ready']);
  });

  it('every stage of Playback takes faults, and effect stages take the network and http ones', () => {
    registerBundledApps(root);
    for (const s of STAGES) expect(FAULTS.filter((f) => faultFacesStage(f, s, 'playback')).length, s).toBeGreaterThanOrEqual(4);
    for (const s of ['entitlement', 'license', 'start_stream', 'ads', 'finish']) expect(FAULTS.filter((f) => faultFacesStage(f, s, 'playback')).map((f) => f.id), s).toEqual(expect.arrayContaining(['http_500', 'timeout', 'internet_outage']));
    expect(FAULTS.filter((f) => faultFacesStage(f, 'buffering', 'playback')).map((f) => f.id)).toEqual(expect.arrayContaining(['slow_link', 'internet_outage']));
  });
});

describe('real generic bots on Playback', () => {
  it('a Rookie walks all eleven stages', async () => {
    const r = await run(PLAY, 'rookie', 1, false);
    expect(r.msgs.filter((m) => m.type === 'stage_done' && m.order === 'ord-0001').map((m) => m.stage)).toEqual(STAGES);
    expect(r.done).toEqual(['ord-0001.json']);
  }, 90000);

  // covers: modular-engine/R6.4
  it('a Rookie that dies after the first effect repeats it; a Reconciler does not', async () => {
    const rookie = await run(PLAY, 'rookie', 1, true);
    expect(rookie.kills).toBe(1);
    expect(rookie.rows.filter((x) => x.kind === 'account').length).toBeGreaterThan(1);
    const rec = await run(PLAY, 'reconciler', 1, true);
    expect(rec.kills).toBe(1);
    expect(rec.rows.filter((x) => x.kind === 'account').length).toBe(1);
    expect(rec.rows.filter((x) => x.kind === 'charge').length).toBe(1);
  }, 120000);
});

describe('Coffee Shop, config only', () => {
  // covers: modular-engine/R6.6
  it('a Phoenix runs it with no engine code and no repeat after a crash', async () => {
    const r = await run(SHOP, 'phoenix', 1, true);
    expect(r.kills).toBe(1);
    expect(r.done).toEqual(['ord-0001.json']);
    expect(r.rows.filter((x) => x.kind === 'charge').length).toBe(1);
    expect(bundle('phoenix')).toContain('generic-bots');
  }, 60000);
});
