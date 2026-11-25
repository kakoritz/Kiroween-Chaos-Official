// covers: modular-engine/R5.1 modular-engine/R5.3
// The generic bots run any registered app from its haunt.yaml, as real processes against the fake provider.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { startProvider } from '../../../packages/core/src/provider';
import { BotProcess, type BotMessage } from '../../../packages/haunt/src/chaos';
import { TIERS } from '../../../packages/haunt/src/pipeline';
import { prepareLane } from '../../../packages/haunt/src/runner/lanes';
import { writeGenericJobs } from '../src/jobs';

const root = resolve(__dirname, '../../..');
const COFFEE = join(root, 'packages/haunt/test/fixtures/apps/coffee');
const bundle = (t: string) => join(root, 'dist/generic-bots', `${t}.js`);
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

interface RunResult { msgs: BotMessage[]; rows: { kind: string; order: string }[]; done: string[]; kills: number }

async function run(tier: string, orders: number, crashOnce: boolean): Promise<RunResult> {
  const prov = await startProvider({ port: 0 });
  const runDir = mkdtempSync(join(tmpdir(), 'haunt-generic-'));
  const { paths } = prepareLane(runDir, 1, 'gn', orders);
  writeGenericJobs(paths.orders, orders);
  const msgs: BotMessage[] = [];
  let kills = 0;
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const proc = new BotProcess(process.execPath, [bundle(tier)], {
        HAUNT_RUN_DIR: runDir, HAUNT_LANE: '1', HAUNT_TIER: tier, HAUNT_SEED: 'gn', HAUNT_PROVIDER: prov.url,
        HAUNT_ORDERS_DIR: paths.orders, HAUNT_SPEED: '2', HAUNT_ATTEMPT: String(attempt), ...ENV,
      });
      const idle = new Promise<'idle' | 'killed'>((res) => {
        proc.onMessage((m) => {
          msgs.push(m);
          if (m.k === 'at_point') {
            if (m.fault !== undefined) { kills++; proc.kill(); void proc.exited.then(() => res('killed')); } else proc.send({ k: 'proceed' });
          }
          if (m.k === 'idle') res('idle');
        });
      });
      await proc.waitFor('ready');
      proc.send({ k: 'go', arms: crashOnce && attempt === 1 ? [{ fault: 'crash', point: 'after_effect_before_journal' }] : [] });
      if ((await idle) === 'idle') { proc.send({ k: 'shutdown' }); await proc.exited; break; }
    }
    return { msgs, rows: prov.provider.ledger('1').map((r) => ({ kind: r.kind, order: r.order })), done: readdirSync(paths.done), kills };
  } finally {
    await prov.close();
    rmSync(runDir, { recursive: true, force: true });
  }
}

describe('a generic bot runs the Coffee Shop app', () => {
  it('a Rookie walks the four declared stages and writes its effects', async () => {
    const r = await run('rookie', 2, false);
    expect(r.done.sort()).toEqual(['ord-0001.json', 'ord-0002.json']);
    expect(r.msgs.filter((m) => m.type === 'stage_done' && m.order === 'ord-0001').map((m) => m.stage)).toEqual(['read_request', 'pay', 'brew', 'ready']);
    expect(r.rows.filter((x) => x.kind === 'charge').length).toBe(2);
    expect(r.rows.filter((x) => x.kind === 'notify').length).toBe(2);
  }, 60000);

  it('a Rookie that dies right after the payment charges twice', async () => {
    const r = await run('rookie', 1, true);
    expect(r.kills).toBe(1);
    expect(r.rows.filter((x) => x.kind === 'charge').length).toBeGreaterThan(1);
  }, 60000);

  it('a Phoenix that dies right after the payment charges once', async () => {
    const r = await run('phoenix', 1, true);
    expect(r.kills).toBe(1);
    expect(r.done).toEqual(['ord-0001.json']);
    expect(r.rows.filter((x) => x.kind === 'charge').length).toBe(1);
    expect(r.rows.filter((x) => x.kind === 'notify').length).toBe(1);
  }, 60000);
});
