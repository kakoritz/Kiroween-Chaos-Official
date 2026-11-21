// In-process fake provider: the source of truth for side effects.
// Semantics from .kiro/specs/engine/runtime.md section 4 (it wins over design.md section 2).
import { appendFileSync, closeSync, fsyncSync, openSync, writeFileSync } from 'node:fs';
import { unit } from '@haunt/shared';

export type Kind = 'account' | 'charge' | 'email' | 'dispatch' | 'notify' | 'ticket' | 'reply' | 'refund' | 'discount';
export const KINDS: readonly Kind[] = ['account', 'charge', 'email', 'dispatch', 'notify', 'ticket', 'reply', 'refund', 'discount'];

export const POST_ROUTES: Readonly<Record<string, Kind>> = {
  '/accounts': 'account',
  '/charges': 'charge',
  '/emails': 'email',
  '/shipments': 'dispatch',
  '/notifications': 'notify',
  '/tickets': 'ticket',
  '/replies': 'reply',
  '/refunds': 'refund',
  '/discounts': 'discount',
};

const ID_PREFIX: Record<Kind, string> = {
  account: 'acct', charge: 'ch', email: 'em', dispatch: 'sh', notify: 'nt', ticket: 'tk', reply: 'rp', refund: 'rf', discount: 'dc',
};

export interface LedgerRow {
  id: string;
  lane: string;
  kind: Kind;
  order: string;
  key: string | null;
  amount: number | null;
  /** Notify index, null for every other kind. */
  index: number | null;
  ts: number;
}

export type FaultMode = 'latency' | 'status' | 'drop' | 'stall' | 'no_driver' | 'handoff_block' | 'typo';
export type HandoffBlock = 'no_answer' | 'gated' | 'accident' | 'wrong_order';

export interface FaultSpec {
  lane: string;
  service: Kind | 'tracking' | 'handoff' | '*';
  /** For handoff_block: the status the handoff call answers with (design.md section 2). */
  block?: HandoffBlock;
  mode: FaultMode;
  /** For typo: the one order the wrong-order complaint applies to (design.md section 8). */
  order?: string;
  value?: number;
  /** Apply to the next N matching calls. */
  count?: number;
  /** Or for a time window in ms. One of count or forMs. */
  forMs?: number;
  headers?: Record<string, string>;
  /** Only calls with phase "recovery". */
  nextCaller?: 'recovery';
}

export interface ProviderRequest {
  method: 'GET' | 'POST';
  path: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
}

export interface ProviderResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
  /** Close the connection without answering. */
  drop?: boolean;
}

export interface ProviderClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: ProviderClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export interface ProviderOptions {
  seed?: string;
  clock?: ProviderClock;
  /** Append processed rows here as JSONL with fsync. */
  ledgerPath?: string;
}

interface ActiveFault {
  spec: FaultSpec;
  remaining: number | null;
  until: number | null;
  /** Window length; the window opens at the first matching call (runtime.md section 18). */
  windowMs: number | null;
}

export const CAPACITY_BASE = 8;
export const CAPACITY_HARD = 24;
export const CAPACITY_PENALTY_MS = 50;

const json = (status: number, body: unknown, headers: Record<string, string> = {}): ProviderResponse => ({
  status, body, headers,
});

export class Provider {
  private readonly seed: string;
  private readonly clock: ProviderClock;
  private readonly ledgerPath?: string;
  private rows: LedgerRow[] = [];
  private responses = new Map<string, unknown>();
  private counters = new Map<string, number>();
  private polls = new Map<string, number>();
  private calls = new Map<string, number>();
  private inflight = new Map<string, number>();
  private faults: ActiveFault[] = [];
  /** Called once per new ledger row (not for idempotent replays). The live runtime turns rows into `repeat` events. */
  onRow?: (row: LedgerRow) => void;
  /** Called when a keyed request returns the existing row (idempotent replay, no new row). */
  onReplay?: (row: LedgerRow) => void;

  constructor(opts: ProviderOptions = {}) {
    this.seed = opts.seed ?? 'haunt';
    this.clock = opts.clock ?? realClock;
    this.ledgerPath = opts.ledgerPath;
    if (this.ledgerPath) writeFileSync(this.ledgerPath, '');
  }

  reset(): void {
    this.rows = [];
    this.responses.clear();
    this.counters.clear();
    this.polls.clear();
    this.calls.clear();
    this.inflight.clear();
    this.faults = [];
    if (this.ledgerPath) writeFileSync(this.ledgerPath, '');
  }

  ledger(lane: string): LedgerRow[] {
    return this.rows.filter((r) => r.lane === lane).map((r) => ({ ...r }));
  }

  addFault(spec: FaultSpec): void {
    const hasCount = spec.count !== undefined;
    this.faults.push({
      spec,
      remaining: hasCount ? spec.count! : null,
      until: null,
      windowMs: !hasCount && spec.forMs !== undefined ? spec.forMs : null,
    });
  }

  async handle(req: ProviderRequest): Promise<ProviderResponse> {
    const q = req.query ?? {};
    const h = lower(req.headers ?? {});
    try {
      if (req.method === 'POST' && req.path === '/_reset') {
        this.reset();
        return json(200, {});
      }
      if (req.method === 'POST' && req.path === '/_fault') {
        const spec = req.body as unknown as FaultSpec;
        if (!spec || typeof spec.lane !== 'string' || typeof spec.service !== 'string' || typeof spec.mode !== 'string') {
          return json(400, { error: 'bad fault' });
        }
        this.addFault(spec);
        return json(200, {});
      }
      if (req.method === 'GET' && req.path === '/ledger') {
        if (!q.lane) return json(400, { error: 'lane required' });
        return json(200, { rows: this.ledger(q.lane) });
      }
      if (req.method === 'GET' && req.path === '/lookup') {
        const row = this.rows.find((r) => r.lane === q.lane && r.kind === q.kind && r.key !== null && r.key === q.key);
        return json(200, row ? { found: true, row: { ...row } } : { found: false });
      }
      if (req.method === 'POST' && POST_ROUTES[req.path]) {
        return await this.effect(POST_ROUTES[req.path]!, req.body ?? {}, h);
      }
      const t = /^\/tracking\/([^/]+)$/.exec(req.path);
      if (req.method === 'GET' && t) {
        return await this.tracking(decodeURIComponent(t[1]!), q.lane ?? '', h);
      }
      const hd = /^\/handoff\/([^/]+)$/.exec(req.path);
      if (req.method === 'GET' && hd) {
        return await this.handoff(decodeURIComponent(hd[1]!), q.lane ?? '', h);
      }
      return json(404, { error: 'no route' });
    } catch (e) {
      return json(500, { error: String((e as Error).message) });
    }
  }

  private async effect(kind: Kind, body: Record<string, unknown>, h: Record<string, string>): Promise<ProviderResponse> {
    const lane = body.lane;
    const order = body.order;
    if (typeof lane !== 'string' || typeof order !== 'string') return json(400, { error: 'lane and order required' });
    const key = h['idempotency-key'] ?? null;
    const recovery = h['x-haunt-phase'] === 'recovery';
    return this.gate(lane, kind, order, recovery, async (extraMs, fault) => {
      const known = key !== null ? this.responses.get(`${lane}|${kind}|${key}`) : undefined;
      let res: ProviderResponse;
      if (known !== undefined) {
        res = json(201, known, { 'Idempotent-Replayed': 'true' });
        const k = known as Record<string, unknown>;
        const amount = typeof k.amount === 'number' ? k.amount : null;
        this.onReplay?.({ id: String(k.id), lane, kind, order, key, amount, index: null, ts: this.clock.now() });
      } else {
        const id = `${ID_PREFIX[kind]}_${this.next(`${lane}|${kind}`)}`;
        const amount = kind === 'charge' && typeof body.amount === 'number' ? body.amount : null;
        const index = kind === 'notify' && typeof body.index === 'number' ? body.index : null;
        const payload: Record<string, unknown> = { id };
        if (kind === 'charge') payload.amount = amount;
        if (kind === 'notify') payload.index = index;
        const row: LedgerRow = { id, lane, kind, order, key, amount, index, ts: this.clock.now() };
        this.rows.push(row);
        this.persist(row);
        this.onRow?.({ ...row });
        if (key !== null) this.responses.set(`${lane}|${kind}|${key}`, payload);
        // Wrong order found at confirmation: the email is sent, and the customer complains (design.md section 8).
        if (kind === 'email' && fault?.mode === 'typo') payload.complaint = 'wrong_order';
        res = json(201, payload);
      }
      // Processed before any delay: a latency fault past the client timeout still leaves the row.
      if (extraMs > 0) await this.clock.sleep(extraMs);
      return res;
    });
  }

  private async tracking(shipment: string, lane: string, h: Record<string, string>): Promise<ProviderResponse> {
    const recovery = h['x-haunt-phase'] === 'recovery';
    return this.gate(lane, 'tracking', shipment, recovery, async (extraMs, fault) => {
      if (extraMs > 0) await this.clock.sleep(extraMs);
      if (fault?.mode === 'stall') return json(200, { status: 'in_transit', reroute: true });
      if (fault?.mode === 'no_driver') return json(200, { status: 'no_driver' });
      const k = `${lane}|${shipment}`;
      const n = (this.polls.get(k) ?? 0) + 1;
      this.polls.set(k, n);
      return json(200, n >= 5 ? { status: 'delivered', pct: 100 } : { status: 'in_transit', pct: n * 20 });
    });
  }

  private async handoff(shipment: string, lane: string, h: Record<string, string>): Promise<ProviderResponse> {
    const recovery = h['x-haunt-phase'] === 'recovery';
    return this.gate(lane, 'handoff', shipment, recovery, async (extraMs, fault) => {
      if (extraMs > 0) await this.clock.sleep(extraMs);
      if (fault?.mode === 'handoff_block' || fault?.mode === 'typo') return json(200, { status: fault.block ?? 'no_answer' });
      return json(200, { status: 'delivered' });
    });
  }

  /** Capacity model, then fault matching, then the handler. Rows are only written inside run(). */
  private async gate(
    lane: string,
    service: Kind | 'tracking' | 'handoff',
    order: string,
    recovery: boolean,
    run: (extraMs: number, fault: FaultSpec | null) => Promise<ProviderResponse>,
  ): Promise<ProviderResponse> {
    const n = (this.inflight.get(lane) ?? 0) + 1;
    this.inflight.set(lane, n);
    try {
      if (n > CAPACITY_HARD) return json(503, { error: 'overloaded' });
      const callNo = this.next(`call|${lane}`, this.calls);
      const base = 20 + unit(this.seed, 'latency', lane, order, service, callNo) * 80;
      const over = n > CAPACITY_BASE ? (n - CAPACITY_BASE) * CAPACITY_PENALTY_MS : 0;
      const fault = this.matchFault(lane, service, recovery, order);
      const baseMs = Math.floor(base + over);
      if (fault) {
        const v = fault.value ?? 0;
        if (fault.mode === 'drop') {
          await this.clock.sleep(baseMs);
          return { status: 0, body: null, headers: {}, drop: true };
        }
        if (fault.mode === 'status') {
          await this.clock.sleep(baseMs);
          return json(v, { error: `fault ${v}` }, { ...(fault.headers ?? {}) });
        }
        if (fault.mode === 'latency') return await run(baseMs + v, fault);
        if (fault.mode === 'typo') return await run(baseMs, fault);
        if (fault.mode === 'handoff_block') return service === 'handoff' ? await run(baseMs, fault) : await run(baseMs, null);
        if (service !== 'tracking') return await run(baseMs, null);
        return await run(baseMs + (fault.mode === 'stall' ? v : 0), fault);
      }
      return await run(baseMs, null);
    } finally {
      this.inflight.set(lane, (this.inflight.get(lane) ?? 1) - 1);
    }
  }

  private matchFault(lane: string, service: Kind | 'tracking' | 'handoff', recovery: boolean, order = ''): FaultSpec | null {
    const now = this.clock.now();
    this.faults = this.faults.filter((f) => (f.remaining === null || f.remaining > 0) && (f.until === null || f.until > now));
    for (const f of this.faults) {
      const s = f.spec;
      if (s.lane !== lane) continue;
      if (s.service !== '*' && s.service !== service) continue;
      if (s.nextCaller === 'recovery' && !recovery) continue;
      // Handoff and tracking calls are keyed by shipment, so the order match applies to order-keyed services only.
      if (s.order !== undefined && service !== 'handoff' && service !== 'tracking' && s.order !== order) continue;
      if (f.windowMs !== null && f.until === null) f.until = now + f.windowMs;
      if (f.remaining !== null) f.remaining -= 1;
      return s;
    }
    return null;
  }

  private next(key: string, map: Map<string, number> = this.counters): number {
    const n = (map.get(key) ?? 0) + 1;
    map.set(key, n);
    return n;
  }

  private persist(row: LedgerRow): void {
    if (!this.ledgerPath) return;
    appendFileSync(this.ledgerPath, JSON.stringify(row) + '\n');
    const fd = openSync(this.ledgerPath, 'r+');
    try { fsyncSync(fd); } finally { closeSync(fd); }
  }
}

function lower(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = v;
  return out;
}
