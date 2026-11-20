// H6.1: the second app. Config loads, the corpus classifies, and real Python processes run against the provider.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startProvider } from '../../../packages/core/src/provider';
import { BotProcess, type BotMessage } from '../../../packages/haunt/src/chaos';
import { loadHauntConfig } from '../../../packages/haunt/src/config';

const root = resolve(__dirname, '../../..');
const bot = (f: string) => join(root, 'apps/haunted-inbox/bot', f);

function findPython(): string | null {
  for (const c of ['python', 'python3', 'py']) {
    try {
      const v = execFileSync(c, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      if (/Python 3\.(1[1-9]|[2-9]\d)/.test(v)) return c;
    } catch { /* try the next one */ }
  }
  return null;
}
const py = findPython();
const pyIt = py ? it : it.skip;

describe('haunt.yaml', () => {
  it('validates and lists the six inbox stages', () => {
    const r = loadHauntConfig(join(root, 'apps/haunted-inbox/haunt.yaml'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.stages.map((s) => s.id)).toEqual(['fetch', 'classify', 'ticket', 'draft', 'reply', 'archive']);
    expect(r.config.stages.map((s) => s.role)).toEqual(['input', 'work', 'effect', 'work', 'effect', 'final']);
    expect(r.config.stages.flatMap((s) => s.effects.map((e) => e.kind))).toEqual(['ticket', 'reply']);
  });

  pyIt('matches the durations in run.py', () => {
    const r = loadHauntConfig(join(root, 'apps/haunted-inbox/haunt.yaml'));
    if (!r.ok) throw new Error('config invalid');
    const out = execFileSync(py!, ['-c', 'import json,sys;sys.path.insert(0,sys.argv[1]);import run;print(json.dumps(run.STAGES))', join(root, 'apps/haunted-inbox/bot')], { encoding: 'utf8' });
    const stages = JSON.parse(out) as [string, string, number, number][];
    expect(stages.map((s) => [s[0], s[2], s[3]])).toEqual(r.config.stages.map((s) => [s.id, s.duration![0], s.duration![1]]));
  });
});

describe('python bot', () => {
  pyIt('classifies the whole corpus as expected', () => {
    const out = execFileSync(py!, [bot('make_inbox.py'), '--check'], { encoding: 'utf8' });
    expect(JSON.parse(out)).toEqual({ emails: 12, mismatches: [] });
  });

  pyIt('--parts reports the parts of each tier', () => {
    const parts = (tier: string) => JSON.parse(execFileSync(py!, [bot('run.py'), '--parts'], { encoding: 'utf8', env: { ...process.env, HAUNT_TIER: tier } })).parts;
    expect(parts('rookie')).toEqual([]);
    expect(parts('phoenix')).toEqual(['retry', 'journal', 'idempotency', 'breaker', 'offline_queue']);
  });
});

interface RunResult { msgs: BotMessage[]; rows: { kind: string; order: string }[]; done: string[]; kills: number }

/** Runs one Python bot as a real process (speed 8), optionally SIGKILLed once at `point`, then restarted. */
async function run(tier: string, mails: number, crashAt: string | null): Promise<RunResult> {
  const prov = await startProvider({ port: 0 });
  const runDir = mkdtempSync(join(tmpdir(), 'haunt-inbox-'));
  const lane = join(runDir, 'lane-1');
  const orders = join(lane, 'orders');
  execFileSync(py!, [bot('make_inbox.py'), orders, String(mails)]);
  const msgs: BotMessage[] = [];
  let kills = 0;
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const proc = new BotProcess(py!, [bot('run.py')], {
        HAUNT_RUN_DIR: runDir, HAUNT_LANE: '1', HAUNT_TIER: tier, HAUNT_SEED: 'h61', HAUNT_PROVIDER: prov.url,
        HAUNT_ORDERS_DIR: orders, HAUNT_SPEED: '8', HAUNT_ATTEMPT: String(attempt),
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
      proc.send({ k: 'go', arms: crashAt && attempt === 1 ? [{ fault: 'crash', point: crashAt }] : [] });
      if ((await idle) === 'idle') {
        proc.send({ k: 'shutdown' });
        await proc.exited;
        break;
      }
    }
    return {
      msgs,
      rows: prov.provider.ledger('1').map((r) => ({ kind: r.kind, order: r.order })),
      done: readdirSync(join(lane, 'done')),
      kills,
    };
  } finally {
    await prov.close();
    rmSync(runDir, { recursive: true, force: true });
  }
}

describe('real python processes against the provider', () => {
  pyIt('a clean run files one ticket and one reply per non-spam mail, none for spam', async () => {
    const r = await run('rookie', 4, null); // msg-01..03 are billing, bug, account; msg-04 is spam
    expect(r.done.sort()).toEqual(['ord-0001.json', 'ord-0002.json', 'ord-0003.json', 'ord-0004.json']);
    expect(r.rows.filter((x) => x.kind === 'ticket').length).toBe(3);
    expect(r.rows.filter((x) => x.kind === 'reply').length).toBe(3);
    expect(r.msgs.filter((m) => m.type === 'order_done').length).toBe(4);
    expect(r.msgs.some((m) => m.type === 'stage_progress')).toBe(true);
    expect(r.msgs.find((m) => m.k === 'hello')?.parts).toEqual([]);
  }, 90000);

  pyIt('I4: a crash after the ticket effect files 2 tickets for the rookie and 1 for the phoenix', async () => {
    const rookie = await run('rookie', 1, 'after_effect_before_journal');
    expect(rookie.kills).toBe(1);
    expect(rookie.rows.filter((x) => x.kind === 'ticket').length).toBe(2);
    const phoenix = await run('phoenix', 1, 'after_effect_before_journal');
    expect(phoenix.kills).toBe(1);
    expect(phoenix.rows.filter((x) => x.kind === 'ticket').length).toBe(1);
    expect(phoenix.rows.filter((x) => x.kind === 'reply').length).toBe(1);
    expect(phoenix.done).toEqual(['ord-0001.json']);
    expect(phoenix.msgs.find((m) => m.k === 'reconciled')).toBeTruthy();
  }, 90000);
});
