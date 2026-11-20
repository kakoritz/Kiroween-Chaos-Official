// In-page ledger for the browser target (H6.3 / E12): the source of truth for side effects, owned by the
// main thread so a worker kill cannot touch it. No node imports (must bundle for the browser).
export type LedgerKind = 'account' | 'charge' | 'email' | 'dispatch' | 'notify' | 'ticket' | 'reply';

export interface PageLedgerRow {
  id: string;
  lane: string;
  kind: LedgerKind;
  order: string;
  key: string | null;
  index: number | null;
  amount: number | null;
  ts: number;
}

export interface PageEffectRequest {
  lane: string;
  kind: LedgerKind;
  order: string;
  key?: string | null;
  index?: number | null;
  amount?: number | null;
}

const PREFIX: Record<LedgerKind, string> = {
  account: 'acct', charge: 'ch', email: 'em', dispatch: 'sh', notify: 'nt', ticket: 'tk', reply: 'rp',
};

export type PageFaultMode = 'latency' | 'status' | 'drop';

/** Provider fault armed on the page ledger (same shape as the node provider's /_fault body). */
export interface PageFaultSpec {
  lane: string;
  service: LedgerKind | 'tracking' | '*';
  mode: PageFaultMode;
  value?: number;
  count?: number;
  forMs?: number;
  headers?: Record<string, string>;
  nextCaller?: 'recovery';
}

/** What a matched fault does to one call. `latency` still applies the effect, then delays the reply. */
export interface PageFaultHit {
  mode: PageFaultMode;
  value: number;
  headers: Record<string, string>;
}

interface ActiveFault {
  spec: PageFaultSpec;
  remaining: number | null;
  until: number | null;
  windowMs: number | null;
}

export class PageLedger {
  private faults: ActiveFault[] = [];
  private rows: PageLedgerRow[] = [];
  private byKey = new Map<string, PageLedgerRow>();
  private n = 0;

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Arm a provider fault. A count applies to the next N matching calls; forMs opens at the first matching call. */
  addFault(spec: PageFaultSpec): void {
    const hasCount = spec.count !== undefined;
    this.faults.push({
      spec,
      remaining: hasCount ? spec.count! : null,
      until: null,
      windowMs: !hasCount && spec.forMs !== undefined ? spec.forMs : null,
    });
  }

  /** First armed fault matching this call, consuming one count. Null when the call is clean. */
  matchFault(lane: string, service: LedgerKind | 'tracking', recovery: boolean): PageFaultHit | null {
    const t = this.now();
    this.faults = this.faults.filter((f) => !(f.remaining !== null && f.remaining <= 0) && !(f.until !== null && t >= f.until));
    for (const f of this.faults) {
      const s = f.spec;
      if (s.lane !== lane || (s.service !== '*' && s.service !== service)) continue;
      if (s.nextCaller === 'recovery' && !recovery) continue;
      if (f.windowMs !== null && f.until === null) f.until = t + f.windowMs;
      if (f.remaining !== null) f.remaining--;
      return { mode: s.mode, value: s.value ?? 0, headers: { ...(s.headers ?? {}) } };
    }
    return null;
  }

  /** Apply an effect. A repeated idempotency key returns the first row and adds nothing. */
  apply(req: PageEffectRequest): { row: PageLedgerRow; replayed: boolean } {
    const key = req.key ?? null;
    const dedupe = key === null ? null : `${req.lane}|${req.kind}|${key}`;
    if (dedupe !== null) {
      const hit = this.byKey.get(dedupe);
      if (hit) return { row: hit, replayed: true };
    }
    const row: PageLedgerRow = {
      id: `${PREFIX[req.kind]}_${(++this.n).toString().padStart(4, '0')}`,
      lane: req.lane,
      kind: req.kind,
      order: req.order,
      key,
      index: req.index ?? null,
      amount: req.amount ?? null,
      ts: this.now(),
    };
    this.rows.push(row);
    if (dedupe !== null) this.byKey.set(dedupe, row);
    return { row, replayed: false };
  }

  /** Reconcile lookup: the row an idempotency key already produced, if any. */
  find(lane: string, kind: LedgerKind, key: string): PageLedgerRow | null {
    return this.byKey.get(`${lane}|${kind}|${key}`) ?? null;
  }

  /** Rows for a lane (or all lanes), in write order. */
  list(lane?: string): PageLedgerRow[] {
    return (lane ? this.rows.filter((r) => r.lane === lane) : this.rows).slice();
  }

  /** Side effects of one kind for one order: the duplicate count the scoring cares about. */
  count(order: string, kind: LedgerKind, lane?: string): number {
    return this.rows.filter((r) => r.order === order && r.kind === kind && (!lane || r.lane === lane)).length;
  }
}
