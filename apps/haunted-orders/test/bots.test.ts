// E5: the five bot bundles. Config loads, bundles build, and real child processes run orders against the provider.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { startProvider } from '../../../packages/core/src/provider';
import { BotProcess, type BotMessage } from '../../../packages/haunt/src/chaos';
import { loadHauntConfig } from '../../../packages/haunt/src/config';
import { STAGES, TIERS } from '../../../packages/haunt/src/pipeline';
import { prepareLane } from '../../../packages/haunt/src/runner/lanes';

const root = resolve(__dirname, '../../..');
const bundle = (t: string) => join(root, 'dist/bots', `${t}.js`);

beforeAll(() => {
  execFileSync(process.execPath, [join(root, 'tools/build-bots.mjs')], { cwd: root, stdio: 'pipe' });
}, 60000);

describe('haunt.yaml', () => {
  it('loads and matches the pipeline stages', () => {
    const r = loadHauntConfig(join(root, 'apps/haunted-orders/haunt.yaml'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.stages.map((s) => s.id)).toEqual(STAGES.map((s) => s.id));
    for (const s of r.config.stages) {
      const def = STAGES.find((d) => d.id === s.id)!;
      expect(s.duration).toEqual([def.min, def.max]);
    }
  });
});

describe('bot bundles', () => {
  it('builds one bundle per tier', () => {
    for (const t of TIERS) expect(existsSync(bundle(t.id))).toBe(true);
    const files = readdirSync(join(root, 'apps/haunted-orders/src/bots')).filter((f) => f.endsWith('.ts'));
    expect(files.filter((f) => !f.endsWith('.hardened.ts')).length).toBe(5);
    expect(files.filter((f) => f.endsWith('.hardened.ts'))).toEqual(['rookie.hardened.ts']);
    expect(existsSync(bundle('rookie.hardened'))).toBe(true);
  });

  it('--parts reports the parts each bot really declares', () => {
    for (const t of TIERS) {
      const out = execFileSync(process.execPath, [bundle(t.id), '--parts'], { encoding: 'utf8' });
      expect(JSON.parse(out)).toEqual({ parts: [...t.use] });
    }
  });
});

interface RunResult { msgs: BotMessage[]; rows: { kind: string; order: string }[]; done: string[]; kills: number }

/** Runs one bot as a real process (speed 8), optionally SIGKILLed once at `after_effect_before_journal`, then restarted. */
async function run(tier: string, orders: number, crashOnce: boolean): Promise<RunResult> {
  const prov = await startProvider({ port: 0 });
  const runDir = mkdtempSync(join(tmpdir(), 'haunt-bot-'));
  const { paths } = prepareLane(runDir, 1, 'e5', orders);
  const msgs: BotMessage[] = [];
  let kills = 0;
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const proc = new BotProcess(process.execPath, [bundle(tier)], {
        HAUNT_RUN_DIR: runDir, HAUNT_LANE: '1', HAUNT_TIER: tier, HAUNT_SEED: 'e5', HAUNT_PROVIDER: prov.url,
        HAUNT_ORDERS_DIR: paths.orders, HAUNT_SPEED: '8', HAUNT_ATTEMPT: String(attempt),
      });
      const idle = new Promise<'idle' | 'killed'>((res) => {
        proc.onMessage((m) => {
          msgs.push(m);
          if (m.k === 'at_point') {
            if (m.fault !== undefined) {
              kills++;
              proc.kill();
              void proc.exited.then(() => res('killed'));
            } else proc.send({ k: 'proceed' });
          }
          if (m.k === 'idle') res('idle');
        });
      });
      await proc.waitFor('ready');
      proc.send({ k: 'go', arms: crashOnce && attempt === 1 ? [{ fault: 'crash', point: 'after_effect_before_journal' }] : [] });
      const outcome = await idle;
      if (outcome === 'idle') {
        proc.send({ k: 'shutdown' });
        await proc.exited;
        break;
      }
    }
    return {
      msgs,
      rows: prov.provider.ledger('1').map((r) => ({ kind: r.kind, order: r.order })),
      done: readdirSync(paths.done),
      kills,
    };
  } finally {
    await prov.close();
    rmSync(runDir, { recursive: true, force: true });
  }
}

describe('real processes against the provider', () => {
  it('rookie processes clean orders end to end', async () => {
    const r = await run('rookie', 2, false);
    expect(r.done.sort()).toEqual(['ord-0001.json', 'ord-0002.json']);
    expect(r.msgs.filter((m) => m.type === 'order_done').length).toBe(2);
    expect(r.rows.filter((x) => x.kind === 'charge').length).toBe(2);
    expect(r.msgs.some((m) => m.type === 'stage_progress')).toBe(true);
    expect(r.msgs.find((m) => m.k === 'hello')?.parts).toEqual([]);
  }, 60000);

  it('a SIGKILL after the effect repeats it for the rookie but not for the phoenix', async () => {
    const rookie = await run('rookie', 1, true);
    expect(rookie.kills).toBe(1);
    expect(rookie.rows.filter((x) => x.kind === 'account').length).toBe(2);
    const phoenix = await run('phoenix', 1, true);
    expect(phoenix.kills).toBe(1);
    expect(phoenix.rows.filter((x) => x.kind === 'account').length).toBe(1);
    expect(phoenix.done).toEqual(['ord-0001.json']);
    expect(phoenix.msgs.find((m) => m.k === 'reconciled')).toBeTruthy();
  }, 60000);
});
