// TV3-C11: pattern miner (spec 8.1, V1_2 section 5/6).
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PatternStore, FilePatternStore, THRESHOLDS, journalRefs, minePatterns, patternEvent, patternId, qualifies, costOf, type Pattern } from '../src/miner';
import type { Ev } from '../src/tournament/rp';
import { validateEvents } from '../src/contract/validate';
import { mockTournament } from '../../core/src/sim/tournament-fixtures';

let seq = 0;
const e = (type: string, lane: number, detail: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Ev => ({ type, lane: String(lane), detail, seq: ++seq, ...extra });

/** One order of one lane that meets `fault` at Payment and ends as `end`. */
function order(lane: number, n: number, fault: string, end: 'done' | 'failed', o: { repeat?: boolean; recover?: string } = {}): Ev[] {
  const id = `ord-${String(n).padStart(4, '0')}`;
  return [
    e('order_start', lane, {}, { order: id }), e('stage_start', lane, {}, { order: id, stage: 'payment' }),
    e('chaos', lane, { fault, source: 'random' }, { stage: 'payment' }),
    ...(o.recover ? [e('recover_start', lane, { action: o.recover }), e('recover_done', lane, { action: o.recover, ms: 700 })] : []),
    ...(o.repeat ? [e('repeat', lane, { kind: 'charge' }, { order: id })] : []),
    end === 'done' ? e('order_done', lane, {}, { order: id }) : e('order_failed', lane, { reason: 'x' }, { order: id }),
  ];
}

describe('mining cases', () => {
  const evs = [...order(1, 1, 'timeout', 'failed'), ...order(1, 2, 'timeout', 'failed'), ...order(2, 1, 'timeout', 'failed'), ...order(3, 1, 'timeout', 'done', { recover: 'backoff' }), ...order(3, 2, 'timeout', 'done', { recover: 'backoff' })];

  it('counts the occurrences that hurt, not the solved ones, and notes who already copes', () => {
    const m = minePatterns({ run: 'r1', round: 2, events: evs });
    const lost = m.find((p) => p.signature === 'payment + timeout + order_lost')!;
    expect(lost).toMatchObject({ stage: 'payment', fault: 'timeout', consequence: 'order_lost', count: 3, lanes: [1, 2], lostOrders: 3, shape: 'case' });
    expect(lost.firstSeen).toMatchObject({ run: 'r1', round: 2, order: 'ord-0001', lane: 1 });
    expect(lost.evidence).toMatchObject({ run: 'r1', round: 2 });
    expect(lost.evidence.seq.length).toBeGreaterThan(0);
    // The two orders lane 3 got through are not a pattern, and the lost pattern knows nobody solved it.
    expect(m.some((p) => p.signature.includes('recovered'))).toBe(false);
    expect(lost.solvedBy).toEqual([]);
  });

  it('reads duplicate effects as repeats and keeps the solved signature of another lane as the lessons that cover it', () => {
    const dup = [...order(2, 1, 'timeout', 'done', { repeat: true, recover: 'retry' }), ...order(4, 1, 'timeout', 'done', { recover: 'backoff' })];
    const p = minePatterns({ run: 'r1', events: dup }).find((x) => x.consequence === 'duplicate_effect')!;
    expect(p).toMatchObject({ signature: 'payment + timeout + duplicate_effect', repeats: 1, lostOrders: 0, downtimeMs: 700, lanes: [2] });
    const mk = (lane: number, outcome: 'partly' | 'solved', mechanism: 'none' | 'idempotency_key') => ({ signature: p.signature, stage: 'payment', fault: 'timeout', consequence: 'duplicate_effect' as const, lane, round: 1, order: 'ord-0009', outcome, mechanism, costMs: 0, costPoints: 0 });
    const withSolver = minePatterns({ run: 'r1', events: dup, cases: [mk(2, 'partly', 'none'), mk(5, 'solved', 'idempotency_key')] })[0]!;
    expect(withSolver.count).toBe(1);
    expect(withSolver.solvedBy).toEqual([{ lane: 5, mechanism: 'idempotency_key' }]);
  });

  it('is deterministic and sorted by cost', () => {
    expect(minePatterns({ run: 'r1', events: evs })).toEqual(minePatterns({ run: 'r1', events: evs }));
    const m = minePatterns({ run: 'r1', events: [...evs, ...order(2, 5, 'http_500', 'done', { repeat: true })] });
    const cost = (p: (typeof m)[number]) => p.downtimeMs + p.lostOrders * 10_000;
    expect(m.map(cost)).toEqual([...m.map(cost)].sort((a, b) => b - a));
  });

  it('keeps journal line references as evidence when journals are given', () => {
    const dir = mkdtempSync(join(tmpdir(), 'haunt-miner-'));
    const path = join(dir, 'journal.jsonl');
    writeFileSync(path, ['{"t":"order_start","order":"ord-0009"}', '{"t":"intent","order":"ord-0001","stage":"payment","kind":"charge"}', '{"t":"result","order":"ord-0001","stage":"payment"}'].join('\n'));
    expect(journalRefs(path, 'ord-0001', 'payment')).toEqual([`${path.replace(/\\/g, '/')}:2`, `${path.replace(/\\/g, '/')}:3`]);
    expect(journalRefs(join(dir, 'nope.jsonl'), 'a', 'b')).toEqual([]);
    const m = minePatterns({ run: 'r1', events: order(1, 1, 'timeout', 'failed'), journals: [{ lane: 1, path }], readRefs: journalRefs, reportLink: '/api/waves/1/report' });
    expect(m[0]!.evidence.journal).toHaveLength(2);
    expect(m[0]!.evidence.report).toBe('/api/waves/1/report');
  });
});

describe('time shapes', () => {
  const stageRun = (lane: number, n: number, ms: number, t0: number): Ev[] => {
    const id = `ord-${String(n).padStart(4, '0')}`;
    return [e('stage_start', lane, {}, { order: id, stage: 'ship', ts: t0 }), e('stage_done', lane, { ms }, { order: id, stage: 'ship', ts: t0 + ms })];
  };

  it('a stage stuck far longer than its p95 is a hang', () => {
    const evs = [...Array.from({ length: 20 }, (_, i) => stageRun(1 + (i % 3), i + 1, 800 + (i % 5) * 20, i * 10_000)).flat(), ...stageRun(2, 30, 15_000, 300_000)];
    const hang = minePatterns({ run: 'r', events: evs }).find((p) => p.shape === 'hang')!;
    expect(hang).toMatchObject({ signature: 'ship + hang + stuck', count: 1, lanes: [2] });
    expect(hang.downtimeMs).toBeGreaterThan(13_000);
    expect(minePatterns({ run: 'r', events: stageRun(1, 1, 15_000, 0) }).some((p) => p.shape === 'hang')).toBe(false);
  });

  it('three failed attempts at one stage of one order are a retry storm, with the fault that was pressed', () => {
    const evs = [e('chaos', 2, { fault: 'http_500' }, { stage: 'payment' }), ...[1, 2, 3].map(() => e('stage_fail', 2, { error: 'x' }, { order: 'ord-0001', stage: 'payment' }))];
    expect(minePatterns({ run: 'r', events: evs }).find((p) => p.shape === 'retry_storm')).toMatchObject({ signature: 'payment + http_500 + retry_storm', count: 1 });
    expect(minePatterns({ run: 'r', events: evs.slice(0, 3) }).some((p) => p.shape === 'retry_storm')).toBe(false);
  });

  it('an endpoint that fails in 30 percent or more of its attempts is a failure rate pattern; degraded updates do not count', () => {
    const evs = [
      ...Array.from({ length: 6 }, (_, i) => e('stage_start', 1, {}, { order: `ord-${i + 1}`, stage: 'receive' })),
      ...[1, 2, 3].map((i) => e('stage_fail', 1, {}, { order: `ord-${i}`, stage: 'receive' })),
      ...Array.from({ length: 4 }, (_, i) => e('stage_start', 1, {}, { order: `ord-${i + 1}`, stage: 'updates' })),
      ...[1, 2, 3, 4].map((i) => e('stage_fail', 1, { degraded: true }, { order: `ord-${i}`, stage: 'updates' })),
    ];
    const m = minePatterns({ run: 'r', events: evs }).filter((p) => p.shape === 'failure_rate');
    expect(m.map((p) => p.signature)).toEqual(['receive + endpoint_failure_rate + degraded']);
  });

  it('swallowed and crashed curse answers are patterns; handled ones are not; outage windows add their downtime', () => {
    const evs = [
      e('order_start', 1, {}, { order: 'ord-0001' }), e('curse_response', 1, { class: 'swallowed', curse: '404', stage: 'payment', order: 'ord-0001' }), e('order_done', 1, {}, { order: 'ord-0001' }),
      e('order_start', 1, {}, { order: 'ord-0002' }), e('curse_response', 1, { class: 'handled', curse: '404', stage: 'payment' }), e('order_done', 1, {}, { order: 'ord-0002' }),
      e('order_start', 2, {}, { order: 'ord-0002' }), e('curse_response', 2, { class: 'crashed', curse: 'flaky500', stage: 'ship', order: 'ord-0002' }), e('order_done', 2, {}, { order: 'ord-0002' }),
      e('outage', 3, { outageMs: 21_000, fault: 'endpoint_down', seed: 7 }, { stage: 'payment' }), e('outage', 3, { outageMs: 15_000, fault: 'endpoint_down', seed: 7 }, { stage: 'payment' }),
    ];
    const m = Object.fromEntries(minePatterns({ run: 'r', events: evs }).map((p) => [p.signature, p]));
    expect(m['payment + curse_404 + swallowed']).toMatchObject({ count: 1, lostOrders: 1, shape: 'curse' });
    expect(m['ship + curse_flaky500 + crashed']).toMatchObject({ lostOrders: 1, shape: 'curse' });
    expect(m['payment + curse_404 + handled']).toBeUndefined();
    expect(m['payment + endpoint_down + outage']).toMatchObject({ count: 2, downtimeMs: 36_000 });
    expect(qualifies({ count: 2, lostOrders: 0, downtimeMsTotal: 36_000 })).toBe(true);
  });
});

describe('thresholds and the store', () => {
  const base = { count: 1, lostOrders: 0, downtimeMsTotal: 0 };

  it('a pattern qualifies at a count of 3, any lost order, or more than 30 s of downtime', () => {
    expect(THRESHOLDS).toEqual({ count: 3, lostOrders: 1, downtimeMs: 30_000 });
    expect(qualifies(base)).toBe(false);
    expect(qualifies({ ...base, count: 3 })).toBe(true);
    expect(qualifies({ ...base, lostOrders: 1 })).toBe(true);
    expect(qualifies({ ...base, downtimeMsTotal: 30_000 })).toBe(false);
    expect(qualifies({ ...base, downtimeMsTotal: 30_001 })).toBe(true);
  });

  const mine = (run: string, n: number) => minePatterns({ run, events: [...order(1, 1, 'timeout', 'done', { repeat: true, recover: 'retry' }), ...(n > 1 ? order(2, 1, 'timeout', 'done', { repeat: true, recover: 'retry' }) : [])] });

  it('accumulates across runs and rounds, never counts the same run twice, keeps first and last seen', () => {
    const store = new FilePatternStore(join(mkdtempSync(join(tmpdir(), 'haunt-pat-')), 'patterns.json'));
    const c1 = store.ingest(mine('run-a', 2), 'run-a#r1');
    expect(c1.map((c) => c.kind)).toEqual(['new']);
    expect(store.ingest(mine('run-a', 2), 'run-a#r1')).toEqual([]);
    const c2 = store.ingest(mine('run-b', 1), 'run-b#r1');
    expect(c2[0]!.kind).toBe('updated');
    const p = new FilePatternStore(store.file).list()[0]!;
    expect(p).toMatchObject({ id: patternId('payment + timeout + duplicate_effect'), count: 3, status: 'new', lanes: [1, 2], repeats: 3, runs: ['run-a#r1', 'run-b#r1'] });
    expect(p.firstSeen.run).toBe('run-a');
    expect(p.lastSeen.run).toBe('run-b');
    expect(p.downtimeMsTotal).toBe(2100);
    expect(costOf(p)).toBe(2100 + 3 * 2000);
  });

  it('follows the status flow and a verified pattern that comes back is new again', () => {
    const store = new PatternStore('');
    store.ingest(mine('a', 1), 'a');
    const id = store.list()[0]!.id;
    for (const s of ['suggested', 'accepted', 'applied', 'verified', 'rejected'] as const) expect(store.setStatus(id, s)!.status).toBe(s);
    store.setStatus(id, 'verified');
    expect(store.ingest(mine('b', 1), 'b')[0]).toMatchObject({ kind: 'regressed' });
    expect(store.list()[0]!.status).toBe('new');
    expect(store.setStatus('p-nope', 'applied')).toBeUndefined();
    store.reset();
    expect(store.list()).toEqual([]);
  });

  it('pattern events carry id, signature, count, downtime, status, qualifies', () => {
    const store = new PatternStore('');
    store.ingest(mine('a', 1), 'a');
    const ev = patternEvent(store.list()[0] as Pattern, 'new');
    expect(ev).toMatchObject({ type: 'pattern', detail: { signature: 'payment + timeout + duplicate_effect', count: 1, status: 'new', qualifies: false, change: 'new' } });
  });
});

describe('mock tournament stream', () => {
  const ev = mockTournament({ upTo: 2 });

  it('carries valid pattern events for qualifying patterns, accumulating over rounds', () => {
    expect(validateEvents(ev)).toEqual([]);
    const p = ev.filter((x) => x.type === 'pattern');
    expect(p.length).toBeGreaterThan(0);
    expect(p.every((x) => x.detail!.qualifies === true)).toBe(true);
    expect(p.some((x) => x.detail!.change === 'new')).toBe(true);
    expect(p.every((x) => ['new', 'suggested', 'accepted', 'applied', 'verified', 'rejected'].includes(x.detail!.status as string))).toBe(true);
  });

  it('the validator rejects a pattern with a bad status or signature (rule 64)', () => {
    const run = (mut: (l: typeof ev) => void) => { const c = ev.map((x) => ({ ...x, detail: x.detail ? { ...x.detail } : x.detail })); mut(c); return validateEvents(c as never).map((v) => v.rule); };
    expect(run((l) => { l.find((x) => x.type === 'pattern')!.detail!.status = 'done'; })).toContain('R64');
    expect(run((l) => { l.find((x) => x.type === 'pattern')!.detail!.signature = 'payment'; })).toContain('R64');
  });
});
