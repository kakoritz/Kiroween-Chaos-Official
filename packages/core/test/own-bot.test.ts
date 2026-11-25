// covers: own-bot-quickstart/R1 own-bot-quickstart/R1.1 own-bot-quickstart/R1.2 own-bot-quickstart/R1.3 own-bot-quickstart/R2 own-bot-quickstart/R2.1 own-bot-quickstart/R2.2 own-bot-quickstart/R2.3 own-bot-quickstart/R4 own-bot-quickstart/R4.1 own-bot-quickstart/R4.2 OB-C1 OB-C2 OB-T1 OB-X1
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { LiveServer, createLiveRuntime, makeBotCommand, resolveOwnBot, splitCommand } from '../src/live';
import { findPython } from '../src/live/inbox-command';
import { pyTest } from './python-skip';
import { toWire } from '../src/live/lanes';
import { startProvider } from '../src/provider';
import { validateEvents } from '../../haunt/src/contract/validate';
import { APP_STAGES } from '../src/live/catalog';

const root = resolve(__dirname, '../../..');
let srv: LiveServer | undefined;
let stopProvider: (() => Promise<void>) | undefined;
const dirs: string[] = [];
afterEach(async () => {
  await srv?.close(); srv = undefined;
  await stopProvider?.(); stopProvider = undefined;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('resolveOwnBot (R2.2)', () => {
  const yes = { exists: () => true, cwd: '/w', python: () => 'python3' };
  it('runs .mjs and .js with node and .py with python', () => {
    expect(resolveOwnBot('bot.mjs', yes)).toEqual({ ok: true, command: process.execPath, args: [resolve('/w', 'bot.mjs')] });
    expect(resolveOwnBot('x/bot.py', yes)).toEqual({ ok: true, command: 'python3', args: [resolve('/w', 'x/bot.py')] });
  });
  it('refuses a missing file, no argument, and a missing python', () => {
    expect(resolveOwnBot('nope.mjs', { ...yes, exists: () => false })).toMatchObject({ ok: false });
    expect(resolveOwnBot('', yes)).toMatchObject({ ok: false });
    expect(resolveOwnBot('bot.py', { ...yes, python: () => undefined })).toMatchObject({ ok: false });
  });
  it('takes a quoted command line as command and args', () => {
    expect(splitCommand('deno run "my bot.ts"')).toEqual(['deno', 'run', 'my bot.ts']);
    expect(resolveOwnBot('deno run bot.ts', yes)).toEqual({ ok: true, command: 'deno', args: ['run', 'bot.ts'] });
    expect(resolveOwnBot('./tools/mybot', { ...yes, exists: () => false })).toMatchObject({ ok: false });
  });
});

describe('template files (R1.1, R1.3)', () => {
  it('both variants exist, use no repo packages, and carry the hardening markers', () => {
    for (const f of ['templates/own-bot/bot.mjs', 'templates/own-bot/bot.py']) {
      const t = readFileSync(join(root, f), 'utf8');
      expect(t, f).not.toMatch(/@haunt|packages\/|from '\.\.?\//);
      for (const m of ['HARDEN (retry)', 'HARDEN (idempotency)', 'HARDEN (timeout)']) expect(t, `${f} ${m}`).toContain(m);
    }
  });
});

async function runTemplate(file: string, command: string, args: string[]): Promise<void> {
  const runDir = mkdtempSync(join(tmpdir(), 'haunt-own-bot-'));
  dirs.push(runDir);
  const prov = await startProvider({ port: 0 });
  stopProvider = () => prov.close();
  const rt = createLiveRuntime({
    clock: false, travel: false,
    botCommand: makeBotCommand({ root, runDir, providerUrl: prov.url, custom: { command, args } }),
    ledgerRows: (lane) => prov.provider.ledger(lane),
  });
  srv = new LiveServer({ engine: rt.live, ledger: rt.ledger });
  const { url } = await srv.listen(0);
  const post = (path: string, body: unknown) => fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  expect((await post('/api/app', { app: 'stream' })).status).toBe(200);
  expect((await post('/api/wave/start', { lanes: 1, orders: 2, speed: 4, seed: 3 })).status).toBe(200);
  await rt.spawner!.done;
  const events = srv.log.events.map((e) => toWire(e)) as any[];
  expect(events.filter((e) => e.type === 'order_done')).toHaveLength(2);
  expect(new Set(events.filter((e) => e.stage).map((e) => e.stage))).toEqual(new Set(['fetch', 'classify', 'draft', 'reply', 'archive']));
  expect(new Set(prov.provider.ledger('1').map((x) => x.kind))).toEqual(new Set(['store', 'dispatch', 'notify']));
  const hello = { seq: 0, ts: 0, type: 'hello', contractVersion: 1, mode: 'live', app: 'stream', stages: APP_STAGES.stream };
  expect(validateEvents([hello, ...events.filter((e) => e.type !== 'reset')] as never)).toEqual([]);
  expect(existsSync(join(runDir, 'wave-1', 'lane-1', 'done', 'ord-0001.json'))).toBe(true);
}

describe('template bots on a short wave (R1.2, R4.2)', () => {
  it('the Node template passes the contract validator', async () => {
    await runTemplate('bot.mjs', process.execPath, [join(root, 'templates/own-bot/bot.mjs')]);
  }, 30_000);
  pyTest(findPython())('the Python template passes the contract validator', async () => {
    await runTemplate('bot.py', findPython()!, [join(root, 'templates/own-bot/bot.py')]);
  }, 30_000);
});
