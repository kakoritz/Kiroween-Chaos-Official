import { describe, expect, it } from 'vitest';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
// @ts-expect-error plain mjs helper
import { bundleBrowser } from '../../../tools/browser-bundle.mjs';
import { BrowserJournal, MemoryStorage, PageLedger, WorkerProcess, type WorkerLike } from '../src/browser';
import { replay } from '../src/sdk/journal';

const ENTRY = fileURLToPath(new URL('./fixtures/browser-pipeline-bot.ts', import.meta.url));

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

describe('browser pipeline bot', () => {
  it('runs the eleven-stage Pipeline in a worker: one side effect per order, journal done', async () => {
    const spawn = await makeSpawn();
    const journal = new BrowserJournal(new MemoryStorage(), 'l5');
    const ledger = new PageLedger();
    const events: Record<string, unknown>[] = [];
    let proc!: WorkerProcess;
    await new Promise<void>((resolve) => {
      proc = new WorkerProcess({ lane: 'l5', spawn, journal, ledger, speed: 60, onEvent: (m) => { events.push(m); if (m.k === 'bot_idle' || m.k === 'bot_error') resolve(); } });
      proc.start();
    });
    proc.kill();
    expect(events.find((e) => e.k === 'bot_error')).toBeUndefined();
    for (const o of ['ord-0001', 'ord-0002']) {
      for (const k of ['account', 'order', 'charge', 'email', 'dispatch'] as const) expect(ledger.count(o, k)).toBe(1);
      expect(ledger.count(o, 'notify')).toBe(2);
    }
    const stages = events.filter((e) => e.type === 'stage_done' && e.order === 'ord-0001').map((e) => e.stage);
    expect(stages).toEqual(['account', 'create', 'submit', 'payment', 'confirmation', 'receive', 'process', 'updates', 'ship', 'transit', 'handoff']);
    expect(events.filter((e) => e.type === 'order_done').map((e) => e.order)).toEqual(['ord-0001', 'ord-0002']);
    expect(replay(journal.records()).get('ord-0002')?.outcome).toBe('done');
  }, 30000);

  it('an armed crash blocks at the hook, the page terminates, the restarted bot finishes without duplicates', async () => {
    const spawn = await makeSpawn();
    const journal = new BrowserJournal(new MemoryStorage(), 'l5');
    const ledger = new PageLedger();
    const events: Record<string, unknown>[] = [];
    let proc!: WorkerProcess;
    let restarted = false;
    await new Promise<void>((resolve) => {
      proc = new WorkerProcess({
        lane: 'l5', spawn, journal, ledger, speed: 60,
        arms: [{ fault: 'crash', point: 'after_effect_before_journal' }],
        onEvent: (m) => {
          events.push(m);
          if (m.k === 'at_point' && !restarted) {
            restarted = true;
            setTimeout(() => proc.start(), 0); // the page restarts; the armed list does not survive, like a fresh process
          }
          if (m.k === 'bot_idle' || m.k === 'bot_error') resolve();
        },
      });
      proc.start();
    });
    proc.kill();
    expect(events.find((e) => e.k === 'bot_error')).toBeUndefined();
    expect(proc.killCount).toBeGreaterThanOrEqual(1);
    for (const o of ['ord-0001', 'ord-0002']) {
      expect(ledger.count(o, 'charge')).toBe(1);
      expect(ledger.count(o, 'dispatch')).toBe(1);
    }
    expect(replay(journal.records()).get('ord-0002')?.outcome).toBe('done');
  }, 40000);
});
