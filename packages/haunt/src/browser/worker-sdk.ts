// Worker-side SDK adapters for the browser target (H6.3 / E12). Runs inside a Web Worker: the bot's
// resilience code uses the same Sdk as the node target, with a browser Clock, a page-backed journal store and
// a page-backed provider transport. Everything durable lives on the page, so worker.terminate() loses nothing.
// No node imports (must bundle for the browser).
import { JournalWriteError, type JournalRecord } from '../sdk/journal';
import {
  Sdk, type HookPoint, type Host, type JournalStore, type OrderResult, type Part, type Transport, type TransportResponse,
} from '../sdk/sdk';
import type { PageToWorker, WorkerToPage } from './worker-host';
import { LEDGER_KIND_RE, type LedgerKind } from './ledger';

/** Subset of DedicatedWorkerGlobalScope used here. */
export interface WorkerScopeLike {
  postMessage(msg: unknown): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

/** Browser Clock: virtual 1x time. `speed` shortens sleeps and speeds `now()`, like the node runtime clock. */
export class BrowserClock {
  private anchorReal: number;
  private anchorVirtual: number;

  constructor(private speed = 1, private readonly real: () => number = () => Date.now()) {
    this.anchorReal = this.anchorVirtual = real();
  }

  now = (): number => this.anchorVirtual + (this.real() - this.anchorReal) * this.speed;

  sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, Math.max(0, ms / this.speed)));

  setSpeed(speed: number): void {
    if (!(speed > 0)) return;
    this.anchorVirtual = this.now();
    this.anchorReal = this.real();
    this.speed = speed;
  }
}

/** Request/reply channel to the page. Replies come back as `{k:'reply', id}`. */
export class PageChannel {
  private n = 0;
  private readonly pending = new Map<number, (m: Extract<PageToWorker, { k: 'reply' }>) => void>();

  constructor(private readonly scope: WorkerScopeLike) {}

  /** Route a reply. Returns true if the message was a reply. */
  handle(m: PageToWorker): boolean {
    if (m.k !== 'reply') return false;
    const f = this.pending.get(m.id);
    if (f) {
      this.pending.delete(m.id);
      f(m);
    }
    return true;
  }

  /** Fire and forget (the journal: the page applies messages in order). */
  send(msg: DistributiveOmit<WorkerToPage, 'id'>): void {
    this.scope.postMessage({ ...msg, id: ++this.n });
  }

  call(msg: DistributiveOmit<WorkerToPage, 'id'>): Promise<Extract<PageToWorker, { k: 'reply' }>> {
    const id = ++this.n;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.scope.postMessage({ ...msg, id });
    });
  }

  post(msg: WorkerToPage): void {
    this.scope.postMessage(msg);
  }
}

type DistributiveOmit<T, K extends string> = T extends unknown ? Omit<T, K> : never;

/** Journal store that writes through to the page-owned BrowserJournal. `disk_full` is injected locally. */
export class PageJournalStore implements JournalStore {
  private failures = 0;

  constructor(private readonly ch: PageChannel) {}

  failNextWrite(): void {
    this.failures++;
  }

  append(rec: JournalRecord): void {
    if (this.failures > 0) {
      this.failures--;
      throw new JournalWriteError('ENOSPC');
    }
    this.ch.send({ k: 'journal_append', rec });
  }
}


/** Provider adapter: effects and reconcile lookups go to the in-page ledger instead of HTTP. */
export class PageTransport implements Transport {
  constructor(
    private readonly ch: PageChannel,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  async post(kind: string, body: Record<string, unknown>, o: { key: string | null; recovery?: boolean }): Promise<TransportResponse> {
    if (!LEDGER_KIND_RE.test(kind) || kind === 'tracking' || kind === 'handoff') throw new Error(`unknown effect kind ${kind}`);
    const r = await this.ch.call({
      k: 'effect',
      req: {
        kind: kind as LedgerKind,
        order: String(body.order),
        key: o.key,
        index: typeof body.index === 'number' ? body.index : null,
        amount: typeof body.amount === 'number' ? body.amount : null,
        recovery: o.recovery === true,
      },
    });
    const rb = r.body as {
      row?: { id: string; amount: number | null; index: number | null };
      fault?: { mode: string; value: number; headers: Record<string, string> };
    };
    const fault = rb.fault;
    if (fault?.mode === 'drop') throw new Error('connection dropped');
    if (fault?.mode === 'status') return { status: fault.value, body: { error: 'fault ' + fault.value }, headers: fault.headers };
    // latency: the effect is already recorded; the reply arrives late (a client timeout still leaves the row).
    if (fault?.mode === 'latency') await this.sleep(fault.value);
    const row = rb.row!;
    const out: Record<string, unknown> = { id: row.id };
    if (row.amount !== null) out.amount = row.amount;
    if (row.index !== null) out.index = row.index;
    return { status: 200, body: out, headers: {} };
  }

  async lookup(kind: string, key: string): Promise<{ found: boolean; row?: Record<string, unknown> }> {
    const r = await this.ch.call({ k: 'lookup', kind: kind as LedgerKind, key });
    return r.body as { found: boolean; row?: Record<string, unknown> };
  }
}

export interface WorkerBotDef {
  tier: string;
  use: readonly Part[];
  /** The bot body: process orders with the given SDK. */
  run(sdk: Sdk, lane: string): Promise<void>;
}

/** Wire a bot into a worker scope. On `init` it builds the SDK over the page adapters and runs. */
export function connectWorkerBot(scope: WorkerScopeLike, def: WorkerBotDef, clock: BrowserClock = new BrowserClock()): PageChannel {
  const ch = new PageChannel(scope);
  scope.onmessage = (ev) => {
    const m = ev.data as PageToWorker;
    if (ch.handle(m)) return;
    if (m.k !== 'init') return;
    const host: Host = {
      now: clock.now,
      sleep: clock.sleep,
      async hook(point: HookPoint, ctx) {
        // The page may terminate this worker while it answers; this await then never resumes.
        await ch.call({ k: 'hook', point, order: ctx.order, stage: ctx.stage });
      },
      emit(msg) {
        ch.post({ k: 'event', msg });
      },
    };
    const sdk = new Sdk({
      tier: def.tier,
      lane: m.lane,
      use: def.use,
      host,
      transport: new PageTransport(ch, clock.sleep),
      journalStore: new PageJournalStore(ch),
      initialRecords: m.replay,
      pid: m.generation,
    });
    void sdk
      .start()
      .then(() => def.run(sdk, m.lane))
      .then(() => ch.post({ k: 'event', msg: { k: 'bot_idle', generation: m.generation } }))
      .catch((e) => ch.post({ k: 'event', msg: { k: 'bot_error', reason: e instanceof Error ? e.message : String(e) } }));
  };
  return ch;
}

export type { OrderResult };
