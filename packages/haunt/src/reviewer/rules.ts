// Rule-based reviewer: findings from a wave's events. Spec: engine design.md section 11, runtime.md section 9.
import type { HauntEvent } from '../score/score';
import type { Finding, Severity } from '../report/builder';

export interface LedgerKey { order: string; kind: string }

export interface ReviewOptions {
  /** Recovery target in ms (default 20000). */
  recoverMs?: number;
  /** Stage ids that take input files (default intake, fetch). */
  inputStages?: string[];
  /** R7 inputs: journal results and ledger rows. Rule is skipped when both are omitted. */
  journal?: LedgerKey[];
  ledger?: LedgerKey[];
}

const d = (e: HauntEvent) => (e.detail ?? {}) as Record<string, any>;
const seqOf = (e: HauntEvent) => e.seq ?? 0;

function p95(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]!;
}

function isTransient(e: HauntEvent): boolean {
  const x = d(e);
  const status = Number(x.status);
  const text = `${x.error ?? ''} ${x.fault ?? ''}`.toLowerCase();
  return status === 429 || status >= 500 || /429|5\d\d|drop|reset|timeout/.test(text);
}

type Draft = Omit<Finding, 'id'>;

export function reviewEvents(events: HauntEvent[], opts: ReviewOptions = {}): Finding[] {
  const evs = [...events].sort((a, b) => seqOf(a) - seqOf(b));
  const recoverTarget = opts.recoverMs ?? 20000;
  const inputStages = opts.inputStages ?? ['intake', 'fetch'];
  const out: Draft[] = [];
  const add = (rule: string, severity: Severity, e: { stage?: string }, fault: string, summary: string, seqs: number[], part: string) =>
    out.push({ rule, severity, stage: e.stage ?? '', fault, summary, evidenceSeq: [...new Set(seqs)].sort((a, b) => a - b), suggestedPart: part });

  // R1: repeated side effects.
  for (const e of evs.filter((x) => x.type === 'repeat')) {
    const prior = [...evs].reverse().find((x) => x.type === 'chaos' && x.lane === e.lane && seqOf(x) < seqOf(e));
    const fault = String(d(e).fault ?? d(prior ?? e).fault ?? '');
    add('R1', 'high', e, fault, `Side effect ${d(e).kind ?? '?'} repeated on order ${e.order ?? '?'} at stage ${e.stage ?? '?'}`, [seqOf(e), ...(prior ? [seqOf(prior)] : [])], 'idempotency');
  }

  const failedOrders = evs.filter((x) => x.type === 'order_failed');
  // R2: retryable failure that ended the order.
  for (const f of evs.filter((x) => x.type === 'stage_fail' && d(x).retryable === true && !d(x).degraded)) {
    const end = failedOrders.find((o) => o.lane === f.lane && o.order === f.order && seqOf(o) > seqOf(f));
    if (end) add('R2', 'medium', f, String(d(f).error ?? ''), `Transient error at ${f.stage ?? '?'} killed order ${f.order ?? '?'}`, [seqOf(f), seqOf(end)], 'retry');
  }

  // R3: three or more transient failures in one stage of one order.
  const groups = new Map<string, HauntEvent[]>();
  for (const f of evs.filter((x) => x.type === 'stage_fail' && isTransient(x))) {
    const k = `${f.lane ?? ''}|${f.order ?? ''}|${f.stage ?? ''}`;
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  for (const g of [...groups.values()].filter((x) => x.length >= 3)) {
    add('R3', 'medium', g[0]!, String(d(g[0]!).error ?? ''), `${g.length} transient failures at ${g[0]!.stage ?? '?'} for order ${g[0]!.order ?? '?'}`, g.map(seqOf), 'breaker');
  }

  // R4: lane halted.
  for (const e of evs.filter((x) => x.type === 'lane_halted')) {
    add('R4', 'high', e, String(d(e).error ?? d(e).reason ?? ''), `Lane ${e.lane ?? '?'} halted on an unhandled error`, [seqOf(e)], 'offline_queue');
  }

  // R5: input stage failed on a missing file.
  for (const o of failedOrders) {
    const fails = evs.filter((x) => x.type === 'stage_fail' && x.lane === o.lane && x.order === o.order && seqOf(x) < seqOf(o));
    const enoent = [o, ...fails].filter((x) => /ENOENT/.test(JSON.stringify(d(x))));
    const atInput = inputStages.includes(o.stage ?? '') || enoent.some((x) => inputStages.includes(x.stage ?? ''));
    if (enoent.length && atInput) add('R5', 'medium', enoent[0]!, 'missing_file', `Order ${o.order ?? '?'} failed on a missing input file`, [...enoent.map(seqOf), seqOf(o)], 'offline_queue');
  }

  // R6: slow recovery.
  const rec = evs.filter((x) => x.type === 'recover_done' && Number.isFinite(Number(d(x).ms)));
  const p = p95(rec.map((x) => Number(d(x).ms)));
  if (rec.length && p > recoverTarget) {
    const slow = rec.filter((x) => Number(d(x).ms) > recoverTarget);
    add('R6', 'medium', slow[0] ?? rec[0]!, '', `Recovery p95 ${p} ms is above the ${recoverTarget} ms target`, (slow.length ? slow : rec).map(seqOf), 'journal');
  }

  // R7: journal and ledger disagree per (order, kind).
  if (opts.journal || opts.ledger) {
    const count = (xs: LedgerKey[] = []) => {
      const m = new Map<string, number>();
      for (const x of xs) m.set(`${x.order}|${x.kind}`, (m.get(`${x.order}|${x.kind}`) ?? 0) + 1);
      return m;
    };
    const j = count(opts.journal);
    const l = count(opts.ledger);
    for (const k of [...new Set([...j.keys(), ...l.keys()])].sort()) {
      const rows = l.get(k) ?? 0;
      if ((j.has(k) && rows === 0) || rows > 1) {
        const [order, kind] = k.split('|');
        const ev = evs.find((x) => x.order === order && (x.type === 'effect' || x.type === 'repeat'));
        add('R7', 'high', { stage: ev?.stage }, '', `Journal and ledger disagree for ${kind} on order ${order}: ${rows} ledger row(s)`, ev ? [seqOf(ev)] : [], 'idempotency');
      }
    }
  }

  // R8: a deep nest (depth >= 3) ended in failure or halt.
  for (const c of evs.filter((x) => x.type === 'chaos' && Number(d(x).depth) >= 3)) {
    const end = evs.find((x) => (x.type === 'order_failed' || x.type === 'lane_halted') && x.lane === c.lane && seqOf(x) > seqOf(c));
    if (end) add('R8', 'medium', c, String(d(c).fault ?? ''), `Nested depth ${d(c).depth} died on lane ${c.lane ?? '?'}`, [seqOf(c), seqOf(end)], 'review recovery code');
  }

  const rank: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  out.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0) || (a.evidenceSeq[0] ?? 0) - (b.evidenceSeq[0] ?? 0));
  return out.map((f, i) => ({ id: `F${i + 1}`, ...f }));
}
