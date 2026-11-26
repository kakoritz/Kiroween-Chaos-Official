// Shared by the generic-app tests: runs one generic bot as a real process against the fake provider.
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startProvider, type LedgerRow } from '../../../packages/core/src/provider';
import { BotProcess, type BotMessage } from '../../../packages/haunt/src/chaos';
import { prepareLane } from '../../../packages/haunt/src/runner/lanes';
import { writeGenericJobs } from '../src/jobs';

export const root = resolve(__dirname, '../../..');
export const bundle = (t: string): string => join(root, 'dist/generic-bots', `${t}.js`);

export interface RunResult { msgs: BotMessage[]; rows: { kind: LedgerRow['kind']; order: string; index: number | null; lane: string }[]; done: string[]; kills: number }

export async function run(env: Record<string, string>, tier: string, orders: number, crashOnce: boolean): Promise<RunResult> {
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
        HAUNT_ORDERS_DIR: paths.orders, HAUNT_SPEED: '3', HAUNT_ATTEMPT: String(attempt), ...env,
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
    return { msgs, rows: prov.provider.ledger('1').map((r) => ({ kind: r.kind, order: r.order, index: r.index, lane: '1' })), done: readdirSync(paths.done), kills };
  } finally {
    await prov.close();
    rmSync(runDir, { recursive: true, force: true });
  }
}

