// Browser-target engine host (H6.3 / E12). A bot is a Worker. The page (main thread) owns the journal and
// ledger. "Crash" is worker.terminate(): the worker dies without cleanup and the page-owned stores survive.
// A restart spawns a fresh worker and hands it the journal records to replay.
// No node imports (must bundle for the browser). The Worker itself is injected via WorkerLike.
import type { JournalRecord } from '../sdk/journal';
import { BrowserJournal } from './journal';
import { PageLedger, type PageEffectRequest, type PageLedgerRow } from './ledger';

/** Subset of the DOM Worker used here. */
export interface WorkerLike {
  postMessage(msg: unknown): void;
  terminate(): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror?: ((ev: unknown) => void) | null;
}

/** Messages a bot worker sends to the page. */
export type WorkerToPage =
  | { k: 'journal_append'; id: number; rec: JournalRecord }
  | { k: 'effect'; id: number; req: Omit<PageEffectRequest, 'lane'> }
  | { k: 'hook'; id: number; point: string; order?: string; stage?: string }
  | { k: 'event'; msg: Record<string, unknown> };

/** Messages the page sends to a bot worker. */
export type PageToWorker =
  | { k: 'init'; lane: string; replay: JournalRecord[]; generation: number }
  | { k: 'reply'; id: number; ok: boolean; body?: unknown; error?: string };

export type HookDecision = 'continue' | 'kill';

export interface WorkerProcessOptions {
  lane: string;
  spawn: () => WorkerLike;
  journal: BrowserJournal;
  ledger: PageLedger;
  /** Called for each hook. Return 'kill' to terminate the worker right there (the armed crash point). */
  onHook?: (point: string, ctx: { order?: string; stage?: string }) => HookDecision;
  onEvent?: (msg: Record<string, unknown>) => void;
}

export class WorkerProcess {
  private worker: WorkerLike | null = null;
  private gen = 0;
  private kills = 0;

  constructor(private readonly o: WorkerProcessOptions) {}

  get alive(): boolean {
    return this.worker !== null;
  }

  get generation(): number {
    return this.gen;
  }

  get killCount(): number {
    return this.kills;
  }

  /** Spawn a worker and give it the page-owned journal to replay. */
  start(): void {
    if (this.worker) throw new Error('worker already running');
    const w = this.o.spawn();
    this.worker = w;
    const myGen = ++this.gen;
    w.onmessage = (ev) => {
      if (this.worker !== w) return; // a terminated worker can leave late messages in flight
      this.handle(w, ev.data as WorkerToPage);
    };
    const init: PageToWorker = { k: 'init', lane: this.o.lane, replay: this.o.journal.records(), generation: myGen };
    w.postMessage(init);
  }

  /** The crash: worker.terminate(). No cleanup runs in the worker. */
  kill(): void {
    const w = this.worker;
    if (!w) return;
    this.worker = null;
    this.kills++;
    w.terminate();
  }

  /** Kill then start a new worker that replays the surviving journal. */
  restart(): void {
    this.kill();
    this.start();
  }

  ledgerRows(): PageLedgerRow[] {
    return this.o.ledger.list(this.o.lane);
  }

  private reply(w: WorkerLike, r: Omit<Extract<PageToWorker, { k: 'reply' }>, 'k'>): void {
    if (this.worker === w) w.postMessage({ k: 'reply', ...r } satisfies PageToWorker);
  }

  private handle(w: WorkerLike, m: WorkerToPage): void {
    switch (m.k) {
      case 'journal_append':
        try {
          this.o.journal.append(m.rec);
          this.reply(w, { id: m.id, ok: true });
        } catch (e) {
          this.reply(w, { id: m.id, ok: false, error: (e as { code?: string }).code ?? String(e) });
        }
        return;
      case 'effect': {
        const { row, replayed } = this.o.ledger.apply({ ...m.req, lane: this.o.lane });
        this.reply(w, { id: m.id, ok: true, body: { row, replayed } });
        return;
      }
      case 'hook': {
        const d = this.o.onHook?.(m.point, { order: m.order, stage: m.stage }) ?? 'continue';
        if (d === 'kill') {
          this.kill();
          return;
        }
        this.reply(w, { id: m.id, ok: true });
        return;
      }
      case 'event':
        this.o.onEvent?.(m.msg);
        return;
    }
  }
}
