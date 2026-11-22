// PK-C3 / SH-C6: the Ticket Desk (Python inbox) runs live with all five tiers. Spawns Python only when it is on PATH;
// otherwise these tests are skipped (the skip reason is printed once). 127.0.0.1 only, no network.
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { LiveServer, createLiveRuntime, makeBotCommand } from '../src/live';
import { findPython } from '../src/live/inbox-command';
import { APP_STAGES } from '../src/live/catalog';
import { startProvider } from '../src/provider';
import { pyTest } from './python-skip';

const root = resolve(__dirname, '../../..');
const py = findPython();
const pyIt = pyTest(py);

let srv: LiveServer | undefined;
let stopProvider: (() => Promise<void>) | undefined;
const dirs: string[] = [];
afterEach(async () => {
  await srv?.close(); srv = undefined;
  await stopProvider?.(); stopProvider = undefined;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('ticket desk catalog', () => {
  it('lists the eleven desk stages with stable ids', () => {
    expect(APP_STAGES.inbox.map((s) => s.id)).toEqual(['login', 'ingest', 'validate', 'dedupe', 'triage', 'assign', 'sla', 'notify', 'escalate', 'resolve', 'close']);
    expect(APP_STAGES.inbox.filter((s) => s.kind === 'effect').map((s) => s.id)).toEqual(['login', 'assign', 'notify', 'escalate']);
  });
});

describe('desk adapters (in-process fakes)', () => {
  pyIt('jira, asana, kace and webhook map the same mail to four shapes, with no network', () => {
    const code = [
      'import json,sys; sys.path.insert(0,sys.argv[1]); import desk',
      'm={"id":"m1","from":"a@b.test","subject":"Crash","body":"it broke"}',
      'print(json.dumps({p: sorted(desk.map_ticket(p,m,"bug",None)) for p in desk.PROVIDERS}))',
    ].join('\n');
    const out = JSON.parse(execFileSync(py!, ['-c', code, join(root, 'apps/haunted-inbox/bot')], { encoding: 'utf8' })) as Record<string, string[]>;
    expect(Object.keys(out)).toEqual(['jira', 'asana', 'kace', 'webhook']);
    expect(new Set(Object.values(out).map((v) => v.join(','))).size).toBe(4);
    for (const v of Object.values(out)) expect(v).toContain('externalId');
  });
});

describe('live ticket desk wave', () => {
  pyIt('five tiers run the Python bots; only the Rookie repeats after a crash', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'haunt-desk-live-'));
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
    const post = (p: string, body: unknown) => fetch(url + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await post('/api/app', { app: 'inbox' })).status).toBe(200);
    expect((await post('/api/wave/start', { app: 'inbox', lanes: 5, orders: 5, speed: 4, seed: 3 })).status).toBe(200);
    // arm a crash on the Rookie once it is working, at the worst moment for a bot with no journal
    for (let i = 0; i < 100; i++) {
      const st = (await (await fetch(url + '/api/state')).json()) as any;
      if (st.lanes?.[0]?.state === 'working') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const c = await post('/api/chaos', { lane: 1, fault: 'crash', creature: 'reaper', point: 'after_effect_before_journal' });
    expect(c.status).toBe(200);
    await rt.spawner!.done;

    const state = (await (await fetch(url + '/api/state')).json()) as any;
    expect(state.app).toBe('inbox');
    expect(state.stages.map((s: any) => s.id)).toEqual(APP_STAGES.inbox.map((s) => s.id));
    const dups = (lane: string) => {
      const seen = new Map<string, number>();
      for (const r of prov.provider.ledger(lane)) {
        const k = `${r.kind}|${r.order}`;
        seen.set(k, (seen.get(k) ?? 0) + 1);
      }
      return [...seen.values()].filter((n) => n > 1).length;
    };
    expect(dups('1'), 'rookie repeats after the crash').toBeGreaterThan(0);
    for (const lane of ['2', '3', '4', '5']) expect(dups(lane), `lane ${lane}`).toBe(0);
    expect(prov.provider.ledger('5').some((r) => r.kind === 'ticket')).toBe(true);
  }, 120_000);
});

describe('ticket desk tournament', () => {
  pyIt('plays a tournament round on the inbox: five Python lanes, one drops, desk reviews carry the ticket labels', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'haunt-desk-tourney-'));
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
    const post = async (p: string, body?: unknown) => { const r = await fetch(url + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }); return { status: r.status, body: (await r.json()) as any }; };
    expect((await post('/api/tournament/start', { app: 'inbox', seed: 5, speed: 4, pace: 'normal', rounds: [{ orders: 4 }, { orders: 4 }] })).status).toBe(200);
    const types = () => srv!.log.events.map((e) => e.type);
    for (let i = 0; i < 600 && !types().includes('awaiting_next'); i++) await new Promise((r) => setTimeout(r, 100));
    expect(types()).toContain('awaiting_next');
    const st = (await (await fetch(url + '/api/state')).json()) as any;
    expect(st.app).toBe('inbox');
    expect(st.tournament).toMatchObject({ round: 1, phase: 'awaiting_next' });
    expect(st.tournament.alive).toHaveLength(4);
    expect(st.corpses).toHaveLength(1);
    const reviews = srv.log.events.filter((e) => e.type === 'review') as any[];
    expect(reviews.length).toBeGreaterThan(0);
    expect(reviews[0].detail.subLabels).toMatchObject({ timeliness: 'First response', delivery: 'SLA' });
    expect((await post('/api/next')).status).toBe(200);
    for (let i = 0; i < 600 && !types().includes('tournament_end'); i++) await new Promise((r) => setTimeout(r, 100));
    expect(types().filter((x) => x === 'round_start')).toHaveLength(2);
    expect(types()).toContain('tournament_end');
    const end = (await (await fetch(url + '/api/state')).json()) as any;
    expect(end.tournament.alive).toHaveLength(3);
  }, 240_000);
});
