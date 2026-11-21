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
  | { k: 'effect'; id: number; req: Omit<PageEffectRequest, 'lane'> & { recovery?: boolean } }
  | { k: 'lookup'; id: number; kind: PageEffectRequest['kind']; key: string }
  | { k: 'hook'; id: number; point: string; order?: string; stage?: string }
  | { k: 'track'; id: number }
  | { k: 'event'; msg: Record<string, unknown> };

/** Messages the page sends to a bot worker. */
export type PageToWorker =
  | { k: 'init'; lane: string; replay: JournalRecord[]; generation: number; seed?: string | number; orders?: number; speed?: number; arms?: Record<string, unknown>[]; settled?: string[] }
  | { k: 'control'; msg: Record<string, unknown> }
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
  /** Pipeline bots: run seed, order count, speed multiplier and the arms to hold from the start. */
  seed?: string | number;
  orders?: number;
  speed?: number;
  arms?: Record<string, unknown>[];
}

export class WorkerProcess {
  private worker: WorkerLike | null = null;
  private gen = 0;
  private kills = 0;
  private pendingArms: Record<string, unknown>[] | undefined;
  /** Orders that reached a final outcome. A restarted bot skips them, like the node lane's done folder. */
  private readonly settled = new Set<string>();

  constructor(private readonly o: WorkerProcessOptions) {
    this.pendingArms = o.arms;
  }

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
    const init: PageToWorker = {
      k: 'init', lane: this.o.lane, replay: this.o.journal.records(), generation: myGen,
      seed: this.o.seed, orders: this.o.orders, speed: this.o.speed, arms: this.pendingArms, settled: [...this.settled],
    };
    this.pendingArms = undefined; // arms belong to one process life; a restart starts unarmed
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

  /** Forward a runner-style control message (rm, speed) to the live worker. */
  control(msg: Record<string, unknown>): void {
    this.worker?.postMessage({ k: 'control', msg } satisfies PageToWorker);
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
        const fault = this.o.ledger.matchFault(this.o.lane, m.req.kind, m.req.recovery === true);
        if (fault && fault.mode !== 'latency') {
          // status/drop: the call fails before anything is written, like the node provider.
          this.reply(w, { id: m.id, ok: true, body: { fault } });
          return;
        }
        const { row, replayed } = this.o.ledger.apply({ ...m.req, lane: this.o.lane });
        this.reply(w, { id: m.id, ok: true, body: { row, replayed, ...(fault ? { fault } : {}) } });
        return;
      }
      case 'lookup': {
        const row = this.o.ledger.find(this.o.lane, m.kind, m.key);
        this.reply(w, { id: m.id, ok: true, body: row ? { found: true, row } : { found: false } });
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
      case 'track': {
        const fault = this.o.ledger.matchFault(this.o.lane, 'tracking', false);
        this.reply(w, { id: m.id, ok: true, body: fault ? { fault } : {} });
        return;
      }
      case 'event': {
        const e = m.msg;
        if (e.type === 'order_done' || e.type === 'order_failed' || e.type === 'order_quarantined') this.settled.add(String(e.order));
        this.o.onEvent?.(e);
        // The bot reached an armed crash point and blocks. The page ends it, like the runner's SIGKILL.
        if (e.k === 'at_point' && e.fault) this.kill();
        return;
      }
    }
  }
}
