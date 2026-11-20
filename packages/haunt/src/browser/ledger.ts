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

export class PageLedger {
  private rows: PageLedgerRow[] = [];
  private byKey = new Map<string, PageLedgerRow>();
  private n = 0;

  constructor(private readonly now: () => number = () => Date.now()) {}

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
