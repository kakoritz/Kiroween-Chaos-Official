// Event log: assigns seq, appends JSONL with fsync, fans out to subscribers, reads back tolerating a torn last line.
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import type { HauntEvent } from '../score/score';

export type Listener = (ev: Required<Pick<HauntEvent, 'seq' | 'ts' | 'type'>> & HauntEvent) => void;

export class EventLog {
  private seq = 0;
  private fd: number | undefined;
  private readonly listeners = new Set<Listener>();
  readonly events: Array<Required<Pick<HauntEvent, 'seq' | 'ts' | 'type'>> & HauntEvent> = [];

  /** `file` is optional; without it the log is memory-only. `now` is injectable for tests. */
  constructor(private readonly file?: string, private readonly now: () => number = () => Date.now()) {
    if (file) {
      mkdirSync(dirname(file), { recursive: true });
      this.fd = openSync(file, 'a');
    }
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(ev: HauntEvent): Required<Pick<HauntEvent, 'seq' | 'ts' | 'type'>> & HauntEvent {
    const full = { ...ev, seq: ++this.seq, ts: ev.ts ?? this.now() };
    // Global events carry no lane key at all (protocol rule 16).
    if (full.lane === undefined) delete full.lane;
    this.events.push(full);
    if (this.fd !== undefined) {
      writeSync(this.fd, JSON.stringify(full) + '\n');
      fsyncSync(this.fd);
    }
    for (const l of this.listeners) l(full);
    return full;
  }

  close(): void {
    if (this.fd !== undefined) closeSync(this.fd);
    this.fd = undefined;
  }
}

/** Read a JSONL event file. A partial or unparsable last line is ignored; earlier bad lines are skipped too. */
export function readEventLog(file: string): HauntEvent[] {
  if (!existsSync(file)) return [];
  const out: HauntEvent[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* torn line */
    }
  }
  return out;
}
