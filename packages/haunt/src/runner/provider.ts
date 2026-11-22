// Provider side of the runner: translate a ProviderArm into a `POST /_fault` body and detect
// repeated effects in the ledger. Spec: runtime.md sections 4, 18, 22 and PROTOCOL `repeat`.
import type { FaultSpec, LedgerRow } from '../../../core/src/provider';
import type { ProviderArm } from '../chaos/director';

type Service = FaultSpec['service'];

const STAGE_SERVICE: Record<string, Service> = {
  account: 'account',
  submit: 'order',
  payment: 'charge',
  confirmation: 'email',
  receive: 'store',
  process: 'store',
  ship: 'dispatch',
  updates: 'notify',
  transit: 'tracking',
  handoff: 'handoff',
};

/** Transit faults (V1_2 section 4): stalls and reroutes on the tracking poll. */
const TRANSIT_FAULTS = new Set(['weather', 'road_hazard', 'delay', 'out_of_gas', 'not_on_truck']);

/** Fault ids that act on every service of the lane, whatever the stage. */
const ALL_SERVICES = new Set(['internet_outage', 'endpoint_down']);

/** Convert an arm to a /_fault body. Returns null for faults the provider does not apply. */
export function faultBody(lane: string, stage: string | null, arm: ProviderArm): FaultSpec | null {
  const service: Service = ALL_SERVICES.has(arm.fault) ? '*' : ((stage && STAGE_SERVICE[stage]) || '*');
  let base: Omit<FaultSpec, 'lane' | 'service'>;
  switch (arm.fault) {
    case 'internet_outage': base = { mode: 'drop' }; break;
    case 'endpoint_down': base = { mode: 'status', value: 503 }; break;
    case 'sms_down': case 'app_down': case 'updates_down': base = { mode: 'status', value: 503, forMs: 8000 }; break;
    case 'timeout':
    case 'comm_timeout': base = { mode: 'latency', value: 3000, count: 1 }; break;
    case 'slow_link': base = { mode: 'latency', value: 600 }; break;
    case 'http_404': base = { mode: 'status', value: 404, count: 2 }; break;
    case 'http_429': base = { mode: 'status', value: 429, count: 3, headers: { 'Retry-After': '2' } }; break;
    case 'http_500': base = { mode: 'status', value: 500, count: 2 }; break;
    case 'hazard_event': base = { mode: 'stall', value: 5000, forMs: 5000 }; break;
    case 'wrong_address': base = { mode: 'stall', value: 5000, forMs: 5000 }; break;
    case 'weather': base = { mode: 'stall', value: 1800, forMs: 1800 }; break;
    case 'road_hazard': base = { mode: 'stall', value: 4000, forMs: 4000 }; break;
    case 'delay': base = { mode: 'stall', value: 600, forMs: 600 }; break;
    case 'out_of_gas': base = { mode: 'stall', value: 7000, forMs: 7000 }; break;
    case 'not_on_truck': base = { mode: 'no_driver', forMs: 4000 }; break;
    case 'no_answer': base = { mode: 'handoff_block', block: 'no_answer', forMs: 3000 }; break;
    case 'gated_house': base = { mode: 'handoff_block', block: 'gated', forMs: 3000 }; break;
    case 'car_accident': base = { mode: 'handoff_block', block: 'accident', forMs: 7000 }; break;
    case 'driver_unreachable': base = { mode: 'no_driver', forMs: 3000 }; break;
    // Wrong order (design.md section 8): the complaint comes back at confirmation (default) or handoff, once, for one order.
    case 'order_typo': base = { mode: 'typo', count: arm.detect === 'process' ? 2 : 1, ...(arm.order ? { order: arm.order } : {}), ...(arm.detect === 'handoff' ? { block: 'wrong_order' as const } : {}) }; break;
    default: return null;
  }
  // Fuzz faults (TV3-C4): an odd status replaces the catalog one, the body may be cut short, a clock jump rides in a header.
  if (arm.status !== undefined && base.mode === 'status') base = { ...base, value: arm.status };
  if (arm.truncated) base = { ...base, truncate: true };
  if (arm.clockJumpMs !== undefined) base = { ...base, headers: { ...(base.headers ?? {}), 'X-Haunt-Clock-Jump': String(arm.clockJumpMs) } };
  const body: FaultSpec = { lane, service: arm.fault === 'hazard_event' || arm.fault === 'driver_unreachable' || arm.fault === 'wrong_address' || TRANSIT_FAULTS.has(arm.fault) ? 'tracking' : arm.fault === 'no_answer' || arm.fault === 'gated_house' || arm.fault === 'car_accident' || (arm.fault === 'order_typo' && arm.detect === 'handoff') ? 'handoff' : arm.fault === 'order_typo' ? (arm.detect === 'process' ? 'store' : arm.detect === 'transit' ? 'tracking' : 'email') : service, ...base };
  // The arm carries the (possibly speed-scaled) window or count and wins over the defaults.
  // order_typo is a call count (catalog forMs 0 is a placeholder), so its count survives.
  if (arm.forMs !== undefined && arm.fault !== 'order_typo') { body.forMs = arm.forMs; delete body.count; }
  else if (arm.count !== undefined && arm.fault !== 'order_typo') { body.count = arm.count; delete body.forMs; }
  if (arm.nextCaller) body.nextCaller = arm.nextCaller;
  return body;
}

export type PostFault = (body: FaultSpec) => Promise<void>;

/** Post an arm to the provider. Returns the body sent, or null if the fault is not a provider fault. */
export async function postProviderArm(post: PostFault, lane: string, stage: string | null, arm: ProviderArm): Promise<FaultSpec | null> {
  const body = faultBody(lane, stage, arm);
  if (body) await post(body);
  return body;
}

export interface RepeatEvent {
  kind: string;
  key: string;
  count: number;
}

/** Tracks ledger rows per (kind, order, index) and reports a repeat each time the row count grows past 1. */
export class RepeatDetector {
  private readonly counts = new Map<string, number>();
  private readonly refunded = new Set<string>();

  /** Feed every new ledger row, in write order. Returns a repeat event when this row is an extra one. */
  add(row: Pick<LedgerRow, 'kind' | 'order' | 'index' | 'lane'> & { key?: string | null }): RepeatEvent | null {
    // Ledger exemption P15 (playtest-v2 design.md section 8): refund and discount rows are legitimate, and a charge
    // keyed :rN after a refund row of the same order is the redo's new charge, not a repeat.
    if (row.kind === 'refund' || row.kind === 'discount') {
      if (row.kind === 'refund') this.refunded.add(`${row.lane}|${row.order}`);
      return null;
    }
    if (row.kind === 'charge' && typeof row.key === 'string' && /:r\d+$/.test(row.key) && this.refunded.has(`${row.lane}|${row.order}`)) return null;
    const key = row.index === null || row.index === undefined ? `${row.order}:${row.kind}` : `${row.order}:${row.kind}:${row.index}`;
    const id = `${row.lane}|${row.kind}|${key}`;
    const n = (this.counts.get(id) ?? 0) + 1;
    this.counts.set(id, n);
    return n > 1 ? { kind: row.kind, key, count: n } : null;
  }

  /** Extra rows seen for a lane (rows minus 1 per group). */
  extraRows(lane: string): number {
    let extra = 0;
    for (const [id, n] of this.counts) if (id.startsWith(`${lane}|`) && n > 1) extra += n - 1;
    return extra;
  }

  reset(): void {
    this.counts.clear();
    this.refunded.clear();
  }
}

/** One-shot scan of a ledger snapshot. */
export function scanRepeats(rows: readonly LedgerRow[]): RepeatEvent[] {
  const d = new RepeatDetector();
  const out: RepeatEvent[] = [];
  for (const r of rows) {
    const e = d.add(r);
    if (e) out.push(e);
  }
  return out;
}
