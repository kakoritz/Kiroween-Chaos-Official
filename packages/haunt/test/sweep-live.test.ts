import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LedgerRow } from '../../core/src/provider';
import type { FaultSpec } from '../../core/src/provider';
import { parseHauntConfig } from '../src/config/haunt-config';
import { CORE_CREATURES, EXTRA_CREATURES } from '../src/creatures';
import { createLiveCellRunner, planSweep, runSweep, sweepReportJson, type LiveCellProvider } from '../src/sweep';

const work = mkdtempSync(join(tmpdir(), 'haunt-sweep-live-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

// Stand-in bot: handshake, report each stage, then move every order to done/ (or failed/ with FAIL_ALL).
const botJs = join(work, 'bot.mjs');
writeFileSync(botJs, `
import { readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
const root = process.env.HAUNT_DIR;
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
send({ k: 'ready' });
createInterface({ input: process.stdin }).on('line', (l) => {
  if (JSON.parse(l).k !== 'go') return;
  for (const f of readdirSync(join(root, 'orders')).sort()) {
    for (const stage of ['intake', 'payment']) send({ type: 'stage_start', order: f.slice(0, 8), stage });
    renameSync(join(root, 'orders', f), join(root, process.env.FAIL_ALL ? 'failed' : 'done', f));
  }
  process.exit(0);
});
`);

function fakeProvider(rows: LedgerRow[] = []): LiveCellProvider & { faults: FaultSpec[]; resets: number } {
  const p = {
    url: 'http://127.0.0.1:1', faults: [] as FaultSpec[], resets: 0,
    reset: () => { p.resets++; },
    ledger: () => rows,
    post: async (b: FaultSpec) => { p.faults.push(b); },
  };
  return p;
}

const row = (kind: LedgerRow['kind'], order: string, id: string): LedgerRow =>
  ({ id, lane: '1', kind, order, key: `${order}:${kind}`, amount: null, index: null, ts: 0 });

const creatures = [...CORE_CREATURES, ...EXTRA_CREATURES];
const cfg = parseHauntConfig(`
name: t
start: node bot.js
truth: http://127.0.0.1:7071
stages:
  - id: intake
    role: input
  - id: payment
    role: effect
    effects:
      - { kind: charge, key: charge, idempotent: required }
`);
if (!cfg.ok) throw new Error(cfg.errors.join(';'));
const plan = planSweep(cfg.config, creatures, { catalogStages: true });

describe('live sweep cell runner', () => {
  it('plans only catalog-applicable cells', () => {
    expect(plan.cells.some((c) => c.stage === 'intake' && c.creature === 'werewolf')).toBe(false);
    expect(plan.cells.some((c) => c.stage === 'payment' && c.creature === 'goblin')).toBe(true);
    expect(plan.cells.some((c) => c.stage === 'payment' && c.creature === 'poltergeist')).toBe(false);
  });

  it('passes a clean cell and posts the provider fault at its stage', async () => {
    const prov = fakeProvider([row('charge', 'ord-0001', 'r1')]);
    const run = createLiveCellRunner({ command: process.execPath, args: [botJs], runDir: work, provider: prov, creatures, orders: 1 });
    const r = await run({ stage: 'payment', creature: 'goblin', fault: 'http_429' }, 3);
    expect(r).toEqual({ outcome: 'pass' });
    expect(prov.faults).toHaveLength(1);
    expect(prov.faults[0]).toMatchObject({ lane: '1', service: 'charge', mode: 'status', value: 429 });
    expect(prov.resets).toBe(1);
  });

  it('scales fault windows by speed', async () => {
    const prov = fakeProvider();
    const run = createLiveCellRunner({ command: process.execPath, args: [botJs], runDir: work, provider: prov, creatures, orders: 1, speed: 4 });
    await run({ stage: 'payment', creature: 'banshee', fault: 'internet_outage' }, 3);
    expect(prov.faults[0]).toMatchObject({ mode: 'drop', forMs: 2000 });
  });

  it('reports a repeated charge and a lost order', async () => {
    const prov = fakeProvider([row('charge', 'ord-0001', 'r1'), row('charge', 'ord-0001', 'r2')]);
    const run = createLiveCellRunner({ command: process.execPath, args: [botJs], runDir: work, provider: prov, creatures, orders: 1, env: { FAIL_ALL: '1' } });
    const r = await run({ stage: 'payment', creature: 'zombie', fault: 'timeout' }, 3);
    expect(r).toEqual({ outcome: 'repeat', repeatedKinds: ['charge'], lost: true });
  });

  it('fails a cell whose orders end in failed/', async () => {
    const run = createLiveCellRunner({ command: process.execPath, args: [botJs], runDir: work, provider: fakeProvider(), creatures, orders: 2, env: { FAIL_ALL: '1' } });
    const r = await run({ stage: 'intake', creature: 'doppelganger', fault: 'duplicate_request' }, 3);
    expect(r).toEqual({ outcome: 'fail' });
  });

  it('plugs into runSweep with a deterministic report', async () => {
    const small = { ...plan, cells: plan.cells.filter((c) => c.creature === 'goblin' || c.creature === 'ghost') };
    const mk = () => createLiveCellRunner({ command: process.execPath, args: [botJs], runDir: work, provider: fakeProvider(), creatures, orders: 1 });
    const a = sweepReportJson(await runSweep(small, mk(), 9));
    const b = sweepReportJson(await runSweep(small, mk(), 9));
    expect(a).toBe(b);
    expect(JSON.parse(a).grade).toBe('A');
  });
});
