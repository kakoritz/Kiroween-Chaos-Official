// covers: CP-C5
// CP-C5: campaign night 6 runs live on the Python Ticket Desk with the Crew's parts. Python only; skipped when it is not on PATH.
// 127.0.0.1 only, no network. The Crew is lane 1; lanes 2 to 5 are the rivals.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { LiveServer, createLiveRuntime, makeBotCommand } from '../src/live';
import { findPython } from '../src/live/inbox-command';
import { startProvider } from '../src/provider';
import { loadCampaign } from '../../haunt/src/campaign/load';
import { computeMedal } from '../../haunt/src/campaign/medals';
import { laneSummary, medalFromEvents } from '../../haunt/src/campaign/balance';
import { pyTest } from './python-skip';

const root = resolve(__dirname, '../../..');
const pyIt = pyTest(findPython());
const night6 = loadCampaign().nights.find((n) => n.id === 6)!;
const ALL = ['retry', 'journal', 'idempotency', 'breaker', 'offline_queue'];

let srv: LiveServer | undefined;
let stopProvider: (() => Promise<void>) | undefined;
const dirs: string[] = [];
afterEach(async () => {
  await srv?.close(); srv = undefined;
  await stopProvider?.(); stopProvider = undefined;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function playNight6(parts: string[]) {
  const runDir = mkdtempSync(join(tmpdir(), 'haunt-night6-'));
  dirs.push(runDir);
  const prov = await startProvider({ port: 0 });
  stopProvider = () => prov.close();
  const rt = createLiveRuntime({
    clock: false, travel: false,
    botCommand: makeBotCommand({ root, runDir, providerUrl: prov.url }),
    ledgerRows: (lane) => prov.provider.ledger(lane),
  });
  prov.provider.onRow = rt.ledgerRow;
  prov.provider.onCurse = (h) => rt.engine.noteCurse(h);
  prov.provider.onReplay = (row) => rt.ledgerRow(row, true);
  srv = new LiveServer({ engine: rt.live, ledger: rt.ledger });
  const { url } = await srv.listen(0);
  const r = await fetch(url + '/api/wave/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ campaign: { night: 6, parts }, speed: 4 }) });
  expect(r.status).toBe(200);
  await rt.spawner!.done;
  const events = srv.log.events;
  const state = (await (await fetch(url + '/api/state')).json()) as any;
  return { events, state, ledger: (lane: string) => prov.provider.ledger(lane) };
}

describe('campaign night 6 live on the Ticket Desk', () => {
  pyIt('the Crew with all five parts wins gold on the Python app, with no repeated ticket', async () => {
    const run = await playNight6(ALL);
    expect(run.state.app).toBe('inbox');
    const ready = run.events.find((e) => e.type === 'lane_ready' && e.lane === '1')!;
    expect(ready.detail).toMatchObject({ tier: 'crew', label: 'Your Crew', parts: ALL });
    const crew = laneSummary(run.events as never, 1)!;
    expect(crew, 'wave_end summary for the Crew').toBeDefined();
    expect(crew.orders!.done, JSON.stringify(crew)).toBe(night6.orders);
    expect(crew.repeats, JSON.stringify(crew)).toBe(0);
    const medal = medalFromEvents(night6, run.events as never, 1);
    expect(medal, JSON.stringify(crew)).toBe('gold');
    const phoenix = laneSummary(run.events as never, 5)!;
    expect(computeMedal(night6, phoenix), `Phoenix on the desk: ${JSON.stringify(phoenix)}`).toBe('gold');
    const seen = new Map<string, number>();
    for (const row of run.ledger('1')) seen.set(`${row.kind}|${row.order}`, (seen.get(`${row.kind}|${row.order}`) ?? 0) + 1);
    expect([...seen.values()].filter((n) => n > 1)).toEqual([]);
    expect(run.ledger('1').some((row) => row.kind === 'ticket')).toBe(true);
  }, 180_000);

  pyIt('the Crew with no parts is the Rookie: it repeats after the crash and earns no medal', async () => {
    const run = await playNight6([]);
    const crew = laneSummary(run.events as never, 1)!;
    expect(crew.repeats, JSON.stringify(crew)).toBeGreaterThan(0);
    expect(computeMedal(night6, crew)).toBe('none');
  }, 180_000);
});
