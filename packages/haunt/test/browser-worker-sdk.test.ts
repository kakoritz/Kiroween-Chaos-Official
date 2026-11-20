import { describe, expect, it } from 'vitest';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
// @ts-expect-error plain mjs helper
import { bundleBrowser } from '../../../tools/browser-bundle.mjs';
import {
  BrowserClock, BrowserJournal, InPageHaunt, MemoryStorage, PageLedger, WorkerProcess, installHaunt, type WorkerLike,
} from '../src/browser';
import { replay } from '../src/sdk/journal';

const ENTRY = fileURLToPath(new URL('./fixtures/browser-bot.ts', import.meta.url));

// The bundle is browser code (platform browser, no node builtins). A worker_threads shim stands in for `self`.
async function makeSpawn(): Promise<() => WorkerLike> {
  const code = (await bundleBrowser(ENTRY, { write: false })) as string;
  const shim = `const { parentPort } = require('node:worker_threads');
globalThis.__haunt_scope = { postMessage: (m) => parentPort.postMessage(m), set onmessage(f) { parentPort.on('message', (data) => f({ data })); } };
${code}`;
  return () => {
    const w = new Worker(shim, { eval: true });
    const like: WorkerLike = { onmessage: null, postMessage: (m) => w.postMessage(m), terminate: () => void w.terminate() };
    w.on('message', (data) => like.onmessage?.({ data }));
    return like;
  };
}

describe('browser worker SDK', () => {
  it('browser bundle has no node builtins and the Sdk runs two orders in a worker', async () => {
    const spawn = await makeSpawn();
    const journal = new BrowserJournal(new MemoryStorage(), 'l1');
    const ledger = new PageLedger();
    const events: Record<string, unknown>[] = [];
    let proc!: WorkerProcess;
    await new Promise<void>((resolve) => {
      proc = new WorkerProcess({ lane: 'l1', spawn, journal, ledger, onEvent: (m) => { events.push(m); if (m.k === 'bot_idle') resolve(); } });
      proc.start();
    });
    proc.kill();
    expect(ledger.list().map((r) => r.kind)).toEqual(['charge', 'email', 'charge', 'email']);
    expect(events.filter((e) => e.type === 'order_done').map((e) => e.order)).toEqual(['ord-0001', 'ord-0002']);
    expect(events.find((e) => e.k === 'hello')).toMatchObject({ tier: 'phoenix', parts: ['retry', 'journal', 'idempotency'] });
    const st = replay(journal.records());
    expect(st.get('ord-0001')?.outcome).toBe('done');
  }, 20000);

  it('worker.terminate() between effect and journal: restart reconciles, one charge per order', async () => {
    const spawn = await makeSpawn();
    const journal = new BrowserJournal(new MemoryStorage(), 'l1');
    const ledger = new PageLedger();
    const events: Record<string, unknown>[] = [];
    let killed = false;
    let proc!: WorkerProcess;
    await new Promise<void>((resolve) => {
      proc = new WorkerProcess({
        lane: 'l1', spawn, journal, ledger,
        onHook: (point) => {
          if (point === 'after_effect_before_journal' && !killed) {
            killed = true;
            setTimeout(() => proc.restart(), 0);
            return 'kill';
          }
          return 'continue';
        },
        onEvent: (m) => { events.push(m); if (m.k === 'bot_idle') resolve(); },
      });
      proc.start();
    });
    proc.kill();
    expect(proc.killCount).toBeGreaterThanOrEqual(1);
    expect(ledger.count('ord-0001', 'charge')).toBe(1);
    expect(ledger.count('ord-0002', 'charge')).toBe(1);
    expect(events.some((e) => e.k === 'reconciled')).toBe(true);
    expect(replay(journal.records()).get('ord-0002')?.outcome).toBe('done');
  }, 20000);
});

describe('BrowserClock', () => {
  it('speed scales now() and sleep()', async () => {
    let t = 1000;
    const c = new BrowserClock(10, () => t);
    t += 100;
    expect(c.now()).toBe(2000);
    c.setSpeed(1);
    t += 50;
    expect(c.now()).toBe(2050);
    const t0 = performance.now();
    await new BrowserClock(100).sleep(1000);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe('window.__haunt in-page transport', () => {
  it('reports mode browser, replays events from `since`, and unsubscribes', async () => {
    const api = new InPageHaunt({ getState: () => ({ wave: 1 }), startWave: async (o) => ({ ok: true, ...o }) });
    const target: { __haunt?: unknown } = {};
    installHaunt(target as never, api);
    expect(target.__haunt).toBe(api);
    expect(api.getState()).toMatchObject({ mode: 'browser', wave: 1 });
    api.publish({ type: 'a' });
    api.publish({ type: 'b' });
    const seen: unknown[] = [];
    const off = api.subscribe((e) => seen.push(e.type), { since: 1 });
    api.publish({ type: 'c' });
    off();
    api.publish({ type: 'd' });
    expect(seen).toEqual(['b', 'c']);
    expect(await api.startWave({ seed: 7 })).toEqual({ ok: true, seed: 7 });
    await expect(api.chaos({})).rejects.toThrow();
  });
});
