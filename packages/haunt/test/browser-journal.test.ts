import { describe, expect, it } from 'vitest';
import { BrowserJournal, BrowserJournalWriteError, MemoryStorage, parseBrowserJournal } from '../src/browser';
import { replay } from '../src/sdk/journal';

describe('BrowserJournal', () => {
  it('survives a "worker terminate" because storage is page-owned', () => {
    const storage = new MemoryStorage();
    const w1 = new BrowserJournal(storage, 'lane1');
    w1.append({ t: 'stage_start', order: 'o1', stage: 'payment', attempt: 1, ts: 1 });
    w1.append({ t: 'intent', order: 'o1', stage: 'payment', kind: 'charge', key: 'k1', eid: 'e1', ts: 2 });
    const w2 = new BrowserJournal(storage, 'lane1');
    const state = replay(w2.records());
    expect(state.get('o1')?.stages.get('payment')?.effects.get('e1')?.intent).toBe(true);
    expect(state.get('o1')?.stages.get('payment')?.effects.get('e1')?.result).toBe(false);
  });

  it('keeps lanes separate by key', () => {
    const storage = new MemoryStorage();
    new BrowserJournal(storage, 'a').append({ t: 'order_done', order: 'o1', ts: 1 });
    expect(new BrowserJournal(storage, 'b').records()).toEqual([]);
  });

  it('injects ENOSPC once', () => {
    const j = new BrowserJournal(new MemoryStorage(), 'a');
    j.failNextWrite();
    expect(() => j.append({ t: 'order_done', order: 'o1', ts: 1 })).toThrow(BrowserJournalWriteError);
    j.append({ t: 'order_done', order: 'o1', ts: 2 });
    expect(j.records()).toHaveLength(1);
  });

  it('ignores torn lines', () => {
    const text = JSON.stringify({ t: 'order_done', order: 'o1', ts: 1 }) + '\n{"t":"inten';
    expect(parseBrowserJournal(text)).toHaveLength(1);
    expect(parseBrowserJournal(null)).toEqual([]);
  });
});
