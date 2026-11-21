// SH-C6: the live runner spawns the Python inbox for real when the arena app is `inbox` (127.0.0.1 only).
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { LiveServer, createLiveRuntime, makeBotCommand } from '../src/live';
import { findPython, inboxTarget } from '../src/live/inbox-command';
import { startProvider } from '../src/provider';
import type { EngineWaveSettings } from '../../haunt/src/runner/engine';

const root = resolve(__dirname, '../../..');
const py = findPython();
const pyIt = py ? it : it.skip;

let srv: LiveServer | undefined;
let stopProvider: (() => Promise<void>) | undefined;
const dirs: string[] = [];
afterEach(async () => {
  await srv?.close(); srv = undefined;
  await stopProvider?.(); stopProvider = undefined;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const base: EngineWaveSettings = { orders: 2, seed: 3, tiers: 'race', lanes: 1, speed: 4, pace: 'normal', app: 'inbox' };

describe('inbox command', () => {
  it('maps tiers to the Python bots and ignores unknown tiers', () => {
    expect(inboxTarget(root, 'hero')).toBeUndefined();
    if (py) {
      expect(inboxTarget(root, 'rookie')!.script.replace(/\\/g, '/')).toMatch(/apps\/haunted-inbox\/bot\/run\.py$/);
      expect(inboxTarget(root, 'crew')!.script.replace(/\\/g, '/')).toMatch(/bot\/crew\.py$/);
    }
  });

  pyIt('makeBotCommand writes mail and returns a python command for the inbox, node for orders', () => {
    const runDir = mkdtempSync(join(tmpdir(), 'haunt-inbox-cmd-'));
    dirs.push(runDir);
    const cmd = makeBotCommand({ root, runDir, providerUrl: 'http://127.0.0.1:1' });
    const c = cmd('1', 1, base)!;
    expect(c.command).toBe(py);
    expect(c.args[0]!.replace(/\\/g, '/')).toMatch(/haunted-inbox\/bot\/run\.py$/);
    expect(c.env!.HAUNT_APP).toBe('inbox');
    const mail = JSON.parse(readFileSync(join(c.env!.HAUNT_ORDERS_DIR!, 'ord-0001.json'), 'utf8'));
    expect(typeof mail.subject).toBe('string');
  });
});

describe('live inbox wave', () => {
  pyIt('runs a real Python lane: mail triaged, tickets and replies reach the provider', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'haunt-inbox-live-'));
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
    const r = await fetch(`${url}/api/wave/start`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app: 'inbox', lanes: 1, orders: 2, speed: 4, seed: 3 }),
    });
    expect(r.status).toBe(200);
    await rt.spawner!.done;
    const state = (await (await fetch(`${url}/api/state`)).json()) as any;
    expect(state.app).toBe('inbox');
    const laneDir = join(runDir, 'wave-1', 'lane-1');
    expect(existsSync(laneDir)).toBe(true);
    expect(readdirSync(join(laneDir, 'done')).length + readdirSync(join(laneDir, 'parked')).length + readdirSync(join(laneDir, 'failed')).length).toBe(2);
    const kinds = new Set(prov.provider.ledger('1').map((x) => x.kind));
    expect(kinds.has('ticket') || kinds.has('reply')).toBe(true);
  }, 60_000);
});
