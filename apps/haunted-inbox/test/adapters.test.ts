// H6.2: the Python Haunted Inbox driven through the H3.7 Proxy adapter and Process adapter (127.0.0.1 only).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startProvider } from '../../../packages/core/src/provider';
import { ProcessAdapter, startFaultProxy } from '../../../packages/haunt/src/adapters';
import { loadHauntConfig } from '../../../packages/haunt/src/config';

const root = resolve(__dirname, '../../..');
const app = join(root, 'apps/haunted-inbox');

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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(cond: () => boolean, ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await sleep(25);
}

interface Setup {
  runDir: string;
  lane: string;
  orders: string;
  adapter: ProcessAdapter;
  close: () => Promise<void>;
  ledger: () => { kind: string; order: string }[];
  proxy: Awaited<ReturnType<typeof startFaultProxy>>;
}

async function setup(mails: number): Promise<Setup> {
  const prov = await startProvider({ port: 0 });
  const proxy = await startFaultProxy({ upstream: prov.url });
  const runDir = mkdtempSync(join(tmpdir(), 'haunt-inbox-ad-'));
  const lane = join(runDir, 'lane-1');
  const orders = join(lane, 'orders');
  execFileSync(py!, [join(app, 'bot/make_inbox.py'), orders, String(mails)]);
  const cfg = loadHauntConfig(join(app, 'haunt.yaml'));
  if (!cfg.ok) throw new Error('config invalid');
  expect(cfg.config.adapter).toEqual(['process']);
  const start = cfg.config.start.replace(/^python\b/, py!);
  const adapter = new ProcessAdapter({
    start,
    cwd: app,
    inputDir: orders,
    env: {
      HAUNT_RUN_DIR: runDir, HAUNT_LANE: '1', HAUNT_TIER: 'phoenix', HAUNT_SEED: 'h62', HAUNT_PROVIDER: proxy.url,
      HAUNT_ORDERS_DIR: orders, HAUNT_SPEED: '8', HAUNT_ATTEMPT: '1',
    },
  });
  return {
    runDir, lane, orders, adapter, proxy,
    ledger: () => prov.provider.ledger('1').map((r) => ({ kind: r.kind, order: r.order })),
    close: async () => {
      if (adapter.running) await adapter.kill();
      await proxy.close();
      await prov.close();
      rmSync(runDir, { recursive: true, force: true });
    },
  };
}

describe('Haunted Inbox through the Proxy and Process adapters', () => {
  pyIt('phoenix rides out injected 503s on /tickets: one ticket and one reply per order', async () => {
    const s = await setup(3);
    try {
      s.proxy.addFault({ kind: 'status', status: 503, count: 2, pathPrefix: '/tickets' });
      s.adapter.start();
      const exit = await Promise.race([s.adapter.exited, sleep(60000).then(() => null)]);
      expect(exit).not.toBeNull();
      expect(s.proxy.stats().injected).toBeGreaterThanOrEqual(1);
      expect(s.ledger().filter((x) => x.kind === 'ticket').length).toBe(3);
      expect(s.ledger().filter((x) => x.kind === 'reply').length).toBe(3);
      expect(readdirSync(join(s.lane, 'done')).length).toBe(3);
      expect(s.adapter.output().some((l) => l.includes('order_done'))).toBe(true);
    } finally {
      await s.close();
    }
  }, 90000);

  pyIt('a real SIGKILL and restart through the Process adapter loses no order and duplicates no effect', async () => {
    const s = await setup(3);
    try {
      s.adapter.start();
      await until(() => s.adapter.output().some((l) => l.includes('order_done')), 30000);
      const exit = await s.adapter.kill();
      expect(exit.code === null || s.adapter.output().length > 0).toBe(true);
      if (s.adapter.output().filter((l) => l.includes('order_done')).length < 3) {
        await s.adapter.restart();
        await Promise.race([s.adapter.exited, sleep(60000)]);
      }
      expect(s.adapter.startCount).toBeGreaterThanOrEqual(1);
      expect(s.ledger().filter((x) => x.kind === 'ticket').length).toBe(3);
      expect(s.ledger().filter((x) => x.kind === 'reply').length).toBe(3);
      expect(readdirSync(join(s.lane, 'done')).length).toBe(3);
    } finally {
      await s.close();
    }
  }, 120000);

  pyIt('feedInput and removeInput manage the inbox folder', async () => {
    const s = await setup(1);
    try {
      s.adapter.feedInput('ord-0002.json', '{}');
      expect(existsSync(join(s.orders, 'ord-0002.json'))).toBe(true);
      s.adapter.removeInput('ord-0002.json');
      expect(existsSync(join(s.orders, 'ord-0002.json'))).toBe(false);
    } finally {
      await s.close();
    }
  });
});
