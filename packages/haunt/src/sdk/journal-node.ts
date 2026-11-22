// The file journal (node only): every record is written with writeSync then fsyncSync. Importing this module registers it with the SDK, so
// `new Sdk({ journalPath })` works in node. The browser bundle imports ../sdk/sdk directly and injects its own store.
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeSync } from 'node:fs';
import { JournalWriteError, parseJournal, type JournalRecord } from './journal';
import { registerNodeJournal } from './sdk';

export function readJournal(path: string): JournalRecord[] {
  return existsSync(path) ? parseJournal(readFileSync(path, 'utf8')) : [];
}

export class Journal {
  private fd: number;
  private failures = 0;

  constructor(readonly path: string) {
    this.fd = openSync(path, 'a');
  }

  /** `disk_full`: the next write throws ENOSPC once. */
  failNextWrite(): void {
    this.failures++;
  }

  /** Throws JournalWriteError on an injected failure. A real fs error propagates unchanged. */
  append(rec: JournalRecord): void {
    if (this.failures > 0) {
      this.failures--;
      throw new JournalWriteError('ENOSPC');
    }
    writeSync(this.fd, JSON.stringify(rec) + '\n');
    fsyncSync(this.fd);
  }

  close(): void {
    closeSync(this.fd);
  }
}

registerNodeJournal({ open: (path) => new Journal(path), read: readJournal });
