// covers: stream-pack-app/R1 stream-pack-app/R1.1 stream-pack-app/R1.2 stream-pack-app/R1.3 stream-pack-app/R3 stream-pack-app/R3.1 stream-pack-app/R3.2 stream-pack-app/R3.3 SP-C2
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { startProvider } from '../../../packages/core/src/provider';
import { BotProcess, type BotMessage } from '../../../packages/haunt/src/chaos';
import { loadHauntConfig } from '../../../packages/haunt/src/config';
import { TIERS } from '../../../packages/haunt/src/pipeline';
import { prepareLane } from '../../../packages/haunt/src/runner/lanes';
import { STREAM_STAGES } from '../../../packages/haunt/src/shared/catalog';
import { writeStreamJobs } from '../src/jobs';

const root = resolve(__dirname, '../../..');
const bundle = (t: string) => join(root, 'dist/stream-bots', `${t}.js`);

beforeAll(() => {
  execFileSync(process.execPath, [join(root, 'tools/build-bots.mjs')], { cwd: root, stdio: 'pipe' });
}, 60000);

describe('haunt.yaml (R1)', () => {
  it('loads and matches the Stream stage table', () => {
    const r = loadHauntConfig(join(root, 'apps/haunted-stream/haunt.yaml'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.stages.map((s) => s.id)).toEqual(['fetch', 'classify', 'draft', 'reply', 'archive']);
    expect(r.config.stages.map((s) => s.id)).toEqual(STREAM_STAGES.map((s) => s.id));
    for (const s of r.config.stages) {
      const def = STREAM_STAGES.find((d) => d.id === s.id)!;
      expect(s.duration).toEqual([def.min, def.max]);
    }
  });
});

describe('bot bundles (R3)', () => {
  it('--parts reports the parts each Stream bot declares', () => {
    for (const t of TIERS) expect(JSON.parse(execFileSync(process.execPath, [bundle(t.id), '--parts'], { encoding: 'utf8' }))).toEqual({ parts: [...t.use] });
  });
  it('the Stream Crew reads HAUNT_PARTS', () => {
    const out = execFileSync(process.execPath, [bundle('crew'), '--parts'], { encoding: 'utf8', env: { ...process.env, HAUNT_TIER: undefined, HAUNT_PARTS: 'retry,idempotency' } });
    expect(JSON.parse(out).parts).toEqual(['retry', 'idempotency']);
  });
});

interface RunResult { msgs: BotMessage[]; rows: { kind: string; order: string }[]; done: string[]; kills: number }

/** Runs one Stream bot as a real process, SIGKILLed once after the first effect when `crashOnce`, then restarted. */
async function run(tier: string, orders: number, crashOnce: boolean, speed = 2): Promise<RunResult> {
  const prov = await startProvider({ port: 0 });
  const runDir = mkdtempSync(join(tmpdir(), 'haunt-stream-'));
  const { paths } = prepareLane(runDir, 1, 'sp', orders);
  writeStreamJobs(paths.orders, orders);
  const msgs: BotMessage[] = [];
  let kills = 0;
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const proc = new BotProcess(process.execPath, [bundle(tier)], {
        HAUNT_RUN_DIR: runDir, HAUNT_LANE: '1', HAUNT_TIER: tier, HAUNT_SEED: 'sp', HAUNT_PROVIDER: prov.url,
        HAUNT_ORDERS_DIR: paths.orders, HAUNT_SPEED: String(speed), HAUNT_ATTEMPT: String(attempt), HAUNT_APP: 'stream',
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

describe('real Stream processes against the provider (R3)', () => {
  it('a Rookie publishes clean jobs through five stages', async () => {
    const r = await run('rookie', 2, false);
    expect(r.done.sort()).toEqual(['ord-0001.json', 'ord-0002.json']);
    expect(r.msgs.filter((m) => m.type === 'order_done').length).toBe(2);
    expect(r.msgs.filter((m) => m.type === 'stage_done' && m.order === 'ord-0001').map((m) => m.stage)).toEqual(['fetch', 'classify', 'draft', 'reply', 'archive']);
    expect(r.rows.filter((x) => x.kind === 'dispatch').length).toBe(2);
    expect(r.rows.filter((x) => x.kind === 'store').length).toBe(4);
  }, 60000);

  it('a Rookie that dies after the first effect repeats it', async () => {
    const r = await run('rookie', 1, true);
    expect(r.kills).toBe(1);
    expect(r.rows.filter((x) => x.kind === 'store').length).toBeGreaterThan(2);
  }, 60000);

  it('a Phoenix that dies after the first effect does not repeat it', async () => {
    const r = await run('phoenix', 1, true);
    expect(r.kills).toBe(1);
    expect(r.done).toEqual(['ord-0001.json']);
    expect(r.rows.filter((x) => x.kind === 'store').length).toBe(2);
    expect(r.rows.filter((x) => x.kind === 'dispatch').length).toBe(1);
  }, 60000);
});
