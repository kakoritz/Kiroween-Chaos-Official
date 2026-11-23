// Ticket Desk faults on real Python bots: each fault is armed the way the arena arms it, and the ledger tells who coped.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startProvider } from '../../../packages/core/src/provider';
import { BotProcess, type BotMessage } from '../../../packages/haunt/src/chaos';
import { faultBody } from '../../../packages/haunt/src/runner/provider';
import { pyTest } from '../../../packages/core/test/python-skip';

const root = resolve(__dirname, '../../..');
const bot = (f: string) => join(root, 'apps/haunted-inbox/bot', f);
function findPython(): string | null {
  for (const c of ['python', 'python3', 'py']) {
    try {
      if (/Python 3\.(1[1-9]|[2-9]\d)/.test(execFileSync(c, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))) return c;
    } catch { /* next */ }
  }
  return null;
}
const py = findPython();
const pyIt = pyTest(py);

interface Res { msgs: BotMessage[]; rows: { kind: string; order: string; key?: string | null }[]; done: string[]; failed: string[]; halted: boolean }
interface Opts { arms?: string[]; sso?: boolean; mails?: number }

async function run(tier: string, o: Opts = {}): Promise<Res> {
  const prov = await startProvider({ port: 0 });
  const runDir = mkdtempSync(join(tmpdir(), 'haunt-desk-'));
  const lane = join(runDir, 'lane-1');
  const orders = join(lane, 'orders');
  execFileSync(py!, [bot('make_inbox.py'), orders, String(o.mails ?? 2)]);
  const msgs: BotMessage[] = [];
  try {
    if (o.sso) await fetch(`${prov.url}/_fault`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(faultBody('1', 'login', { id: 0, fault: 'sso_expired' })) });
    const proc = new BotProcess(py!, [bot('run.py')], {
      HAUNT_RUN_DIR: runDir, HAUNT_LANE: '1', HAUNT_TIER: tier, HAUNT_SEED: 'desk', HAUNT_PROVIDER: prov.url, HAUNT_ORDERS_DIR: orders, HAUNT_SPEED: '8', HAUNT_ATTEMPT: '1', HAUNT_APP: 'inbox',
    });
    let halted = false;
    const end = new Promise<void>((res) => {
      proc.onMessage((m) => {
        msgs.push(m);
        if (m.k === 'at_point') proc.send({ k: 'proceed' });
        if (m.type === 'lane_halted') halted = true;
        if (m.k === 'idle' || m.type === 'lane_halted') res();
      });
    });
    await proc.waitFor('ready');
    proc.send({ k: 'go', arms: (o.arms ?? []).map((fault) => ({ fault })) });
    await end;
    proc.send({ k: 'shutdown' });
    await proc.exited;
    const ls = (d: string) => { try { return readdirSync(join(lane, d)).sort(); } catch { return []; } };
    return { msgs, rows: prov.provider.ledger('1').map((r) => ({ kind: r.kind, order: r.order, key: (r as { key?: string | null }).key })), done: ls('done'), failed: ls('failed'), halted };
  } finally {
    await prov.close();
    rmSync(runDir, { recursive: true, force: true });
  }
}
const n = (r: Res, kind: string, order?: string) => r.rows.filter((x) => x.kind === kind && (!order || x.order === order)).length;
const desk = (r: Res, order: string) => (r.msgs.find((m) => m.type === 'order_done' && m.order === order)?.detail as { desk?: Record<string, unknown> } | undefined)?.desk;

describe('Ticket Desk faults on real Python bots', () => {
  pyIt('sla_breach: the clock runs out for everyone; a keyed escalation notifies once, the rookie every tick', async () => {
    const rookie = await run('rookie', { arms: ['sla_breach'] });
    const phoenix = await run('phoenix', { arms: ['sla_breach'] });
    expect(desk(rookie, 'ord-0001')).toMatchObject({ slaBreached: true, slaMs: 12000, faults: ['sla_breach'] });
    expect(desk(phoenix, 'ord-0001')).toMatchObject({ slaBreached: true });
    expect(n(rookie, 'notify', 'ord-0001')).toBe(3);
    expect(n(phoenix, 'notify', 'ord-0001')).toBe(1);
    expect(desk(phoenix, 'ord-0002')).toMatchObject({ slaBreached: false });
  }, 90000);

  pyIt('wrong_queue: the rookie and retrier lose the ticket; journaled tiers reclassify it (audited, one reassignment)', async () => {
    for (const tier of ['rookie', 'retrier']) {
      const r = await run(tier, { arms: ['wrong_queue'] });
      expect(r.failed, tier).toEqual(['ord-0001.json']);
      expect(n(r, 'ticket', 'ord-0001'), tier).toBe(0);
    }
    for (const tier of ['journaler', 'phoenix']) {
      const r = await run(tier, { arms: ['wrong_queue'] });
      expect(r.failed, tier).toEqual([]);
      expect(n(r, 'ticket', 'ord-0001'), tier).toBe(1);
      expect(desk(r, 'ord-0001'), tier).toMatchObject({ cls: 'billing', queue: 'billing', reassignments: 1 });
    }
  }, 120000);

  pyIt('duplicate_storm: the rookie files a ticket per message, the journaled tiers file one and link the rest', async () => {
    const rookie = await run('rookie', { arms: ['duplicate_storm'] });
    expect(n(rookie, 'ticket', 'ord-0001')).toBe(3);
    const phoenix = await run('phoenix', { arms: ['duplicate_storm'] });
    expect(n(phoenix, 'ticket', 'ord-0001')).toBe(1);
    expect(desk(phoenix, 'ord-0001')).toMatchObject({ children: 2 });
  }, 90000);

  pyIt('field_mapping_error: the rookie halts, retrier and journaler fail the ticket, the phoenix parks and maps it back', async () => {
    const rookie = await run('rookie', { arms: ['field_mapping_error'] });
    expect(rookie.halted).toBe(true);
    expect(n(rookie, 'ticket')).toBe(0);
    for (const tier of ['retrier', 'journaler']) {
      const r = await run(tier, { arms: ['field_mapping_error'] });
      expect(r.failed, tier).toEqual(['ord-0001.json']);
    }
    const phoenix = await run('phoenix', { arms: ['field_mapping_error'] });
    expect(phoenix.failed).toEqual([]);
    expect(phoenix.done).toEqual(['ord-0001.json', 'ord-0002.json']);
    expect(n(phoenix, 'ticket', 'ord-0001')).toBe(1);
    expect(phoenix.msgs.some((m) => m.type === 'order_resumed' && m.order === 'ord-0001')).toBe(true);
  }, 120000);

  pyIt('webhook_retry_storm: the same payload arrives four times; the rookie files all four, journaled tiers file one', async () => {
    const rookie = await run('rookie', { arms: ['webhook_retry_storm'], mails: 1 });
    expect(n(rookie, 'ticket')).toBe(4);
    for (const tier of ['journaler', 'phoenix']) {
      const r = await run(tier, { arms: ['webhook_retry_storm'], mails: 1 });
      expect(n(r, 'ticket'), tier).toBe(1);
      expect(n(r, 'reply'), tier).toBe(1);
      expect(r.done.length, tier).toBe(4);
    }
  }, 120000);

  pyIt('sso_expired: the 401 still made the account; only keyed retries do not make a second one', async () => {
    const rookie = await run('rookie', { sso: true, mails: 1 });
    expect(rookie.failed).toEqual(['ord-0001.json']);
    expect(n(rookie, 'account')).toBe(1);
    const retrier = await run('retrier', { sso: true, mails: 1 });
    expect(retrier.done).toEqual(['ord-0001.json']);
    expect(n(retrier, 'account')).toBe(2);
    const phoenix = await run('phoenix', { sso: true, mails: 1 });
    expect(phoenix.done).toEqual(['ord-0001.json']);
    expect(n(phoenix, 'account')).toBe(1);
    expect(n(phoenix, 'ticket')).toBe(1);
  }, 120000);
});
