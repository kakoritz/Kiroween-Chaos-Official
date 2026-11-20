// A minimal real bot process for the kill tests. Bundled with esbuild and run by process.execPath.
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { Sdk, type Part } from '../../src/sdk';
import { ChaosHost } from '../../src/chaos';

const dir = process.env.HAUNT_DIR!;
const parts = (process.env.HAUNT_PARTS ?? '').split(',').filter(Boolean) as Part[];
const mark = (s: string) => appendFileSync(join(dir, 'marks.log'), `${process.pid} ${s}\n`);
const send = (m: Record<string, unknown>) => process.stdout.write(`${JSON.stringify(m)}\n`);

const host = new ChaosHost({
  parts, mode: 'child', send,
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
});

const sdk = new Sdk({
  tier: 'fixture', lane: 'L1', use: parts, host,
  journalPath: join(dir, 'lane-1.journal.jsonl'),
  transport: {
    async post() { mark('call'); return { status: 200, body: { id: 'c1', amount: 10 }, headers: {} }; },
    async lookup() { return { found: false }; },
  },
});
host.bind(sdk);

const rl = createInterface({ input: process.stdin });
const go = new Promise<void>((res) => {
  rl.on('line', (l) => {
    const m = JSON.parse(l) as Record<string, unknown>;
    host.control(m);
    if (m.k === 'go') res();
  });
});

send({ k: 'ready' });
await go;
await sdk.start();
mark('started');
await sdk.order('O1', async (s) => {
  await s.stage('payment', async (st) => {
    await st.effect('charge', { key: parts.includes('idempotency') ? st.key('charge') : undefined, body: { amount: 10 } });
    mark('effect_returned');
  });
});
mark('done');
sdk.close();
process.exit(0);
