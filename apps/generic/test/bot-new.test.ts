// covers: chain-wizard-v2/R3.1 chain-wizard-v2/R3.2 chain-wizard-v2/R3.3
// `npm run bot:new`: a generated naive bot runs as a real process with the app's own stage ids, and chaos breaks it the way the HARDEN comments say.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startProvider } from '../../../packages/core/src/provider';
import { BotProcess, type BotMessage } from '../../../packages/haunt/src/chaos';
import { loadHauntConfig } from '../../../packages/haunt/src/config/load';
import { prepareLane } from '../../../packages/haunt/src/runner/lanes';
import { botStarter, starterStages } from '../../../packages/haunt/src/scaffold/bot-starter';
import { findPython } from '../../../packages/core/src/live/inbox-command';
import { writeGenericJobs } from '../src/jobs';

const root = resolve(__dirname, '../../..');
const shop = loadHauntConfig(join(root, 'examples/coffee-shop/haunt.yaml'));
const play = loadHauntConfig(join(root, 'apps/haunted-playback/haunt.yaml'));
if (!shop.ok || !play.ok) throw new Error('fixtures');
const py = findPython();

async function runBot(command: string, args: string[], orders: number, crashOnce: boolean) {
  const prov = await startProvider({ port: 0 });
  const runDir = mkdtempSync(join(tmpdir(), 'haunt-botnew-'));
  const { paths } = prepareLane(runDir, 1, 'bn', orders);
  writeGenericJobs(paths.orders, orders);
  const msgs: BotMessage[] = [];
  let kills = 0;
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const proc = new BotProcess(command, args, { HAUNT_RUN_DIR: runDir, HAUNT_LANE: '1', HAUNT_SEED: 'bn', HAUNT_PROVIDER: prov.url, HAUNT_ORDERS_DIR: paths.orders, HAUNT_SPEED: '4', HAUNT_ATTEMPT: String(attempt) });
      const idle = new Promise<'idle' | 'killed'>((res) => {
        proc.onMessage((m) => {
          msgs.push(m);
          if (crashOnce && attempt === 1 && m.type === 'stage_done' && m.stage === 'pay') { kills++; proc.kill(); void proc.exited.then(() => res('killed')); }
          if (m.k === 'idle') res('idle');
        });
      });
      await proc.waitFor('ready');
      proc.send({ k: 'go', arms: [] });
      if ((await idle) === 'idle') { proc.send({ k: 'shutdown' }); await proc.exited; break; }
    }
    return { msgs, rows: prov.provider.ledger('1').map((r) => ({ kind: r.kind, order: r.order })), done: readdirSync(paths.done), kills };
  } finally { await prov.close(); rmSync(runDir, { recursive: true, force: true }); }
}

describe('bot starter', () => {
  it('starterStages: one provider call per effect, an index per kind across the order, unknown kinds stored as store', () => {
    const st = starterStages(play.config);
    expect(st.map((s) => s.id)).toEqual(['login', 'profile', 'browse', 'title_select', 'entitlement', 'license', 'start_stream', 'buffering', 'render', 'ads', 'finish']);
    expect(st.find((s) => s.id === 'login')!.calls[0]).toMatchObject({ path: '/accounts', body: { index: 1 } });
    expect(st.find((s) => s.id === 'license')!.calls[0]!.body.index).toBe(1);
    expect(st.find((s) => s.id === 'finish')!.calls[0]!.body.index).toBe(2);
    const odd = loadHauntConfig(join(root, 'examples/coffee-shop/haunt.yaml'));
    expect(odd.ok).toBe(true);
  });

  it('the source carries the app stage ids, a HARDEN note for each effect, and no leftover Stream stages', () => {
    const src = botStarter(shop.config, 'node', root);
    expect(src).toContain('"read_request"');
    expect(src).toContain('"pay"');
    expect(src).not.toContain("'classify'");
    expect(src.match(/HARDEN \(idempotency\): send a key on the (charge|notify) call/g)?.length).toBe(2);
    expect(src).toContain('for (const c of stage.calls)');
  });

  // covers: chain-wizard-v2/R3.1
  it('the generated Node bot runs the Coffee Shop stages as a real process, and a crash after the first effect repeats it (it is naive)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bot-src-'));
    const file = join(dir, 'bot.mjs');
    writeFileSync(file, botStarter(shop.config, 'node', root));
    try {
      const clean = await runBot(process.execPath, [file], 2, false);
      expect(clean.done.sort()).toEqual(['ord-0001.json', 'ord-0002.json']);
      expect(clean.msgs.filter((m) => m.type === 'stage_done' && m.order === 'ord-0001').map((m) => m.stage)).toEqual(['read_request', 'pay', 'brew', 'ready']);
      expect(clean.rows.filter((r) => r.kind === 'charge').length).toBe(2);
      const crashed = await runBot(process.execPath, [file], 1, true);
      expect(crashed.kills).toBe(1);
      expect(crashed.rows.filter((r) => r.kind === 'charge').length).toBeGreaterThan(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 90000);

  // covers: chain-wizard-v2/R3.1
  it.skipIf(!py)('the generated Python bot runs the same stages', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bot-src-'));
    const file = join(dir, 'bot.py');
    writeFileSync(file, botStarter(shop.config, 'python', root));
    try {
      const r = await runBot(py!, [file], 2, false);
      expect(r.done.sort()).toEqual(['ord-0001.json', 'ord-0002.json']);
      expect(r.msgs.filter((m) => m.type === 'stage_done' && m.order === 'ord-0001').map((m) => m.stage)).toEqual(['read_request', 'pay', 'brew', 'ready']);
      expect(r.rows.filter((x) => x.kind === 'charge').length).toBe(2);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 90000);
});
