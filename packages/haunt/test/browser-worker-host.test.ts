import { describe, expect, it } from 'vitest';
import { Worker } from 'node:worker_threads';
import {
  BrowserJournal, MemoryStorage, PageLedger, WorkerProcess, type WorkerLike,
} from '../src/browser';
import { replay } from '../src/sdk/journal';

// A real thread stands in for a browser Worker: terminate() is a real kill with no cleanup.
const BOT = `
const { parentPort } = require('node:worker_threads');
let id = 0; const pending = new Map();
const call = (msg) => new Promise((r) => { const i = ++id; pending.set(i, r); parentPort.postMessage({ ...msg, id: i }); });
parentPort.on('message', (m) => {
  if (m.k === 'reply') { const f = pending.get(m.id); if (f) f(m); return; }
  if (m.k === 'init') run(m);
});
async function run(init) {
  const had = init.replay.some((r) => r.t === 'intent' && r.order === 'o1');
  if (!had) await call({ k: 'journal_append', rec: { t: 'intent', order: 'o1', stage: 'pay', kind: 'charge', key: 'k1', eid: 'e1', ts: 1 } });
  const e = await call({ k: 'effect', req: { kind: 'charge', order: 'o1', key: 'k1' } });
  await call({ k: 'hook', point: 'after_effect_before_journal', order: 'o1', stage: 'pay' });
  await call({ k: 'journal_append', rec: { t: 'result', order: 'o1', stage: 'pay', kind: 'charge', key: 'k1', eid: 'e1', payload: e.body.row.id, ts: 2 } });
  parentPort.postMessage({ k: 'event', msg: { type: 'bot_done', generation: init.generation, replayed: e.body.replayed } });
}
`;

function spawnThread(): WorkerLike {
  const w = new Worker(BOT, { eval: true });
  const like: WorkerLike = {
    onmessage: null,
    postMessage: (m) => w.postMessage(m),
    terminate: () => void w.terminate(),
  };
  w.on('message', (data) => like.onmessage?.({ data }));
  return like;
}

describe('browser worker host', () => {
  it('worker.terminate() mid-order: journal and ledger survive, restart replays, one side effect', async () => {
    const storage = new MemoryStorage();
    const journal = new BrowserJournal(storage, 'lane1');
    const ledger = new PageLedger();
    const events: Record<string, unknown>[] = [];
    let killed = false;
    let proc!: WorkerProcess;
    const done = new Promise<void>((resolve) => {
      proc = new WorkerProcess({
        lane: 'lane1',
        spawn: spawnThread,
        journal,
        ledger,
        onHook: (point) => {
          if (point === 'after_effect_before_journal' && !killed) {
            killed = true;
            // Restart on the next tick so the kill lands first, like a supervisor noticing the death.
            setTimeout(() => proc.restart(), 0);
            return 'kill';
          }
          return 'continue';
        },
        onEvent: (m) => {
          events.push(m);
          if (m.type === 'bot_done') resolve();
        },
      });
    });
    proc.start();
    await done;
    proc.kill();

    expect(proc.killCount).toBeGreaterThanOrEqual(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ generation: 2, replayed: true });
    expect(ledger.count('o1', 'charge')).toBe(1);
    const st = replay(journal.records());
    expect(st.get('o1')?.stages.get('pay')?.effects.get('e1')?.result).toBe(true);
  });

  it('without a key the replayed effect is a duplicate (what the Phoenix tier prevents)', () => {
    const ledger = new PageLedger();
    ledger.apply({ lane: 'a', kind: 'charge', order: 'o1' });
    ledger.apply({ lane: 'a', kind: 'charge', order: 'o1' });
    expect(ledger.count('o1', 'charge')).toBe(2);
  });

  it('dedupes by key per lane and kind', () => {
    const ledger = new PageLedger();
    const a = ledger.apply({ lane: 'a', kind: 'charge', order: 'o1', key: 'k' });
    const b = ledger.apply({ lane: 'a', kind: 'charge', order: 'o1', key: 'k' });
    const c = ledger.apply({ lane: 'b', kind: 'charge', order: 'o1', key: 'k' });
    expect(b.replayed).toBe(true);
    expect(b.row.id).toBe(a.row.id);
    expect(c.replayed).toBe(false);
    expect(ledger.list()).toHaveLength(2);
  });

  it('start twice throws, kill is idempotent, late messages from a killed worker are ignored', () => {
    const sent: unknown[] = [];
    let terminated = 0;
    const w: WorkerLike = { onmessage: null, postMessage: (m) => void sent.push(m), terminate: () => void terminated++ };
    const ledger = new PageLedger();
    const p = new WorkerProcess({ lane: 'l', spawn: () => w, journal: new BrowserJournal(new MemoryStorage(), 'l'), ledger });
    p.start();
    expect(() => p.start()).toThrow();
    p.kill();
    p.kill();
    expect(terminated).toBe(1);
    w.onmessage?.({ data: { k: 'effect', id: 1, req: { kind: 'charge', order: 'o' } } });
    expect(ledger.list()).toHaveLength(0);
  });
});
