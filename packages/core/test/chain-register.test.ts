// "Run my chain in the arena": the live server registers a chain posted by the Chain Wizard and runs a real wave on it.
// Spec: .kiro/specs/chain-wizard-v2 (R2). Needs the generic bots (npm run build:bots).
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { LiveServer, createLiveRuntime, makeBotCommand } from '../src/live';
import { startProvider } from '../src/provider';
import { unregisterApp } from '../../haunt/src/shared/registry';

const root = resolve(__dirname, '../../..');
let srv: LiveServer | undefined;
let stopProvider: (() => Promise<void>) | undefined;
const dirs: string[] = [];
afterEach(async () => {
  await srv?.close(); srv = undefined;
  await stopProvider?.(); stopProvider = undefined;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  unregisterApp('wizard-chain');
});

const MANIFEST = 'name: wizard-chain\nlabel: Wizard chain\nidPrefix: wiz\nstart: x\ntruth: http://127.0.0.1:7071\nstages:\n  - { use: read_request }\n  - { use: charge, id: pay }\n  - { use: notify, id: tell }\n';

describe('POST /api/apps/register', () => {
  // covers: chain-wizard-v2/R2.1, R2.2
  it('registers a chain, lists it, switches to it, and a real wave runs on its own stages', async () => {
    execFileSync(process.execPath, [join(root, 'tools/build-bots.mjs')], { cwd: root, stdio: 'pipe' });
    const runDir = mkdtempSync(join(tmpdir(), 'haunt-chain-'));
    dirs.push(runDir);
    const prov = await startProvider({ port: 0 });
    stopProvider = () => prov.close();
    const rt = createLiveRuntime({ clock: false, travel: false, botCommand: makeBotCommand({ root, runDir, providerUrl: prov.url }), ledgerRows: (lane) => prov.provider.ledger(lane) });
    srv = new LiveServer({ engine: rt.live, ledger: rt.ledger, runDir });
    const { url } = await srv.listen(0);
    const post = async (p: string, b: unknown) => { const r = await fetch(url + p, { method: 'POST', body: JSON.stringify(b) }); return { status: r.status, body: (await r.json()) as any }; };

    const reg = await post('/api/apps/register', { manifest: MANIFEST });
    expect(reg.status).toBe(200);
    expect(reg.body).toMatchObject({ id: 'wizard-chain', label: 'Wizard chain' });
    expect(reg.body.stages.map((s: { id: string }) => s.id)).toEqual(['read_request', 'pay', 'tell']);
    expect(existsSync(join(runDir, 'apps', 'wizard-chain', 'haunt.yaml'))).toBe(true);
    expect(((await (await fetch(url + '/api/apps')).json()) as { id: string }[]).map((a) => a.id)).toContain('wizard-chain');

    expect((await post('/api/app', { app: 'wizard-chain' })).status).toBe(200);
    const state = (await (await fetch(url + '/api/state')).json()) as any;
    expect(state.app).toBe('wizard-chain');
    expect(state.stages.map((s: { id: string }) => s.id)).toEqual(['read_request', 'pay', 'tell']);

    expect((await post('/api/wave/start', { app: 'wizard-chain', lanes: 2, orders: 2, speed: 4, seed: 3 })).status).toBe(200);
    await rt.spawner!.done;
    const laneDir = join(runDir, 'wave-1', 'lane-1');
    expect(readdirSync(join(laneDir, 'done')).length + readdirSync(join(laneDir, 'parked')).length + readdirSync(join(laneDir, 'failed')).length).toBe(2);
    const kinds = new Set(prov.provider.ledger('1').map((x) => x.kind));
    expect(kinds.has('charge') && kinds.has('notify')).toBe(true);
  }, 90_000);

  // covers: chain-wizard-v2/R2.2
  it('refuses a bad manifest with the field and the fix, a built-in name, and an empty body', async () => {
    const rt = createLiveRuntime({ clock: false, travel: false });
    srv = new LiveServer({ engine: rt.live, ledger: rt.ledger, runDir: mkdtempSync(join(tmpdir(), 'haunt-chain-')) });
    const { url } = await srv.listen(0);
    const post = async (b: unknown) => { const r = await fetch(url + '/api/apps/register', { method: 'POST', body: JSON.stringify(b) }); return { status: r.status, body: (await r.json()) as any }; };
    const bad = await post({ manifest: 'name: x\nstart: y\nstages:\n  - { id: Bad-Id, label: B, role: input }\n' });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toMatch(/Bad-Id/);
    expect((await post({ manifest: 'name: orders\nstart: y\nstages:\n  - { id: aa, label: A, role: input }\n' })).status).toBe(409);
    expect((await post({})).status).toBe(400);
    expect((await post({ manifest: 'x'.repeat(40_000) })).status).toBe(400);
  });
});
