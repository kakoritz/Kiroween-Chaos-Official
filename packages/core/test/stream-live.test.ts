// covers: stream-pack-app/R2 stream-pack-app/R2.1 stream-pack-app/R2.2 stream-pack-app/R2.3 stream-pack-app/R4 stream-pack-app/R4.1 stream-pack-app/R4.2 stream-pack-app/R5 stream-pack-app/R5.1 stream-pack-app/R5.2 stream-pack-app/R5.3 SP-C1 SP-C3 SP-C4
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { LiveServer, createLiveRuntime, makeBotCommand } from '../src/live';
import { toWire } from '../src/live/lanes';
import { APP_STAGES, CREATURES, isAppId } from '../src/live/catalog';
import { startProvider } from '../src/provider';
import { validateEvents } from '../../haunt/src/contract/validate';
import { FAULTS, nextApplicableStage } from '../../haunt/src/chaos/catalog';
import { stageOfCall } from '../../haunt/src/tournament/curses';
import { roundPlan } from '../../haunt/src/tournament/rounds';
import { vocabOf } from '../../haunt/src/shared/catalog';

const root = resolve(__dirname, '../../..');
let srv: LiveServer | undefined;
let stopProvider: (() => Promise<void>) | undefined;
const dirs: string[] = [];
afterEach(async () => {
  await srv?.close(); srv = undefined;
  await stopProvider?.(); stopProvider = undefined;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const post = (url: string, path: string, body: unknown) => fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('stream app catalog (R2)', () => {
  it('is a valid app id with five stages and its own vocabulary', () => {
    expect(isAppId('stream')).toBe(true);
    expect(isAppId('payments')).toBe(false);
    expect(APP_STAGES.stream.map((s) => s.id)).toEqual(['fetch', 'classify', 'draft', 'reply', 'archive']);
    expect(APP_STAGES.stream.map((s) => s.kind)).toEqual(['effect', 'read', 'effect', 'effect', 'effect']);
    expect(vocabOf('stream').unit).toBe('video');
  });
});

describe('stream pack creatures and curses (R5)', () => {
  it('provider and process faults land on Stream stages; orders-only world creatures are hidden', () => {
    const timeout = FAULTS.find((f) => f.id === 'timeout')!;
    expect(nextApplicableStage(timeout, null, 'stream')).toEqual({ stage: 'fetch', nextOrder: false });
    expect(nextApplicableStage(timeout, 'classify', 'stream')).toEqual({ stage: 'draft', nextOrder: false });
    expect(CREATURES.find((c) => c.id === 'zombie')!.apps).toContain('stream');
    expect(CREATURES.find((c) => c.id === 'scarecrow')!.apps).not.toContain('stream');
  });
  it('curse hits are classified by Stream stage', () => {
    expect(stageOfCall('store', 1, 'stream')).toBe('fetch');
    expect(stageOfCall('store', 2, 'stream')).toBe('archive');
    expect(stageOfCall('dispatch', undefined, 'stream')).toBe('draft');
    expect(stageOfCall('notify', undefined, 'stream')).toBe('reply');
  });
  it('a Stream tournament storm only names Stream stages', () => {
    const plan = roundPlan(7, 1, { intensity: 5, orders: 6 } as never, 'stream');
    expect(plan.length).toBeGreaterThan(0);
    for (const p of plan) expect(['fetch', 'draft', 'reply', 'archive']).toContain(p.stage);
  });
});

describe('live stream wave (R2, R4)', () => {
  it('switches app, runs real Node bots against the provider, and the validator finds nothing', async () => {
    execFileSync(process.execPath, [join(root, 'tools/build-bots.mjs')], { cwd: root, stdio: 'pipe' });
    const runDir = mkdtempSync(join(tmpdir(), 'haunt-stream-live-'));
    dirs.push(runDir);
    const prov = await startProvider({ port: 0 });
    stopProvider = () => prov.close();
    const rt = createLiveRuntime({
      clock: false, travel: false,
      botCommand: makeBotCommand({ root, runDir, providerUrl: prov.url }),
      ledgerRows: (lane) => prov.provider.ledger(lane),
    });
    srv = new LiveServer({ engine: rt.live, ledger: rt.ledger });
    const { url } = await srv.listen(0);
    expect(((await (await fetch(`${url}/api/apps`)).json()) as { id: string }[]).map((a) => a.id)).toContain('stream');
    expect((await post(url, '/api/app', { app: 'nope' })).status).toBe(400);
    expect((await post(url, '/api/app', { app: 'stream' })).status).toBe(200);
    const st = (await (await fetch(`${url}/api/state`)).json()) as any;
    expect(st.app).toBe('stream');
    expect(st.stages.map((s: any) => s.id)).toEqual(['fetch', 'classify', 'draft', 'reply', 'archive']);
    const r = await post(url, '/api/wave/start', { lanes: 1, orders: 2, speed: 4, seed: 3 });
    expect(r.status).toBe(200);
    await rt.spawner!.done;
    const laneDir = join(runDir, 'wave-1', 'lane-1');
    expect(existsSync(laneDir)).toBe(true);
    expect(readdirSync(join(laneDir, 'done')).length + readdirSync(join(laneDir, 'parked')).length + readdirSync(join(laneDir, 'failed')).length).toBe(2);
    const kinds = new Set(prov.provider.ledger('1').map((x) => x.kind));
    expect(kinds.has('store') && kinds.has('dispatch') && kinds.has('notify')).toBe(true);
    const events = srv.log.events.map((e) => toWire(e)) as never[];
    const stageIds = new Set((events as any[]).filter((e) => e.stage).map((e) => e.stage));
    expect([...stageIds].sort()).toEqual(['archive', 'classify', 'draft', 'fetch', 'reply']);
    const hello = { seq: 0, ts: 0, type: 'hello', contractVersion: 1, mode: 'live', app: 'stream', stages: APP_STAGES.stream };
    expect(validateEvents([hello, ...events.filter((e: any) => e.type !== 'reset')] as never)).toEqual([]);
  }, 90_000);
});
