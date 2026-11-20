// Browser-target journal (H6.3 / E12). Same append-only record model as sdk/journal.ts, but backed by
// a StorageLike (localStorage in the page, a Map-backed fake in tests) instead of node:fs.
// A crash is worker.terminate(): the page-owned storage survives, so a new worker replays from it.
// No node imports here: this file must be bundleable for the browser.
import type { JournalRecord } from '../sdk/journal';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

export class BrowserJournalWriteError extends Error {
  constructor(readonly code: string) {
    super(`journal write failed: ${code}`);
  }
}

/** Parse JSONL text; torn or invalid lines are ignored and never throw. */
export function parseBrowserJournal(text: string | null): JournalRecord[] {
  const out: JournalRecord[] = [];
  if (!text) return out;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const rec = JSON.parse(line) as JournalRecord;
      if (rec && typeof rec === 'object' && typeof rec.t === 'string' && typeof rec.order === 'string') out.push(rec);
    } catch {
      // torn line
    }
  }
  return out;
}

export class BrowserJournal {
  private failures = 0;

  constructor(
    private readonly storage: StorageLike,
    readonly key: string,
  ) {}

  /** `disk_full`: the next write throws ENOSPC once, as in the Node journal. */
  failNextWrite(): void {
    this.failures++;
  }

  append(rec: JournalRecord): void {
    if (this.failures > 0) {
      this.failures--;
      throw new BrowserJournalWriteError('ENOSPC');
    }
    const prev = this.storage.getItem(this.key) ?? '';
    this.storage.setItem(this.key, prev + JSON.stringify(rec) + '\n');
  }

  records(): JournalRecord[] {
    return parseBrowserJournal(this.storage.getItem(this.key));
  }
}
