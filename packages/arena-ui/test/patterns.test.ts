import { describe, expect, it } from 'vitest';
import {
  foldPattern, gradeMove, isRunning, metricText, overlayText, parseImprove, parsePatterns, patternOf, patternTitle, phaseProgress, plainFix, reportOf, secText, sortByCost, specResultOf,
} from '../src/arena/patterns';
import { applyCurseEvent, countAnswer, curseShort, curseTable, emptyCurseLedger, stageOfEndpoint, type CurseHost } from '../src/arena/curses';
import { applyEvent, emptyVM, loadSnapshot } from '../src/arena/model';
import { caseRows, emptyCasebook, loadCasebook, solvedCounts } from '../src/arena/casebook';
import { awardsOf } from '../src/arena/tournament';
import { ArenaScene, laneBoxes } from '../src/arena/scene';

const P = (id: string, extra: Record<string, unknown> = {}) => ({ id, signature: `payment + timeout + ${id}`, stage: 'payment', fault: 'timeout', consequence: id, shapes: ['case'], count: 3, lanes: [2, 3], downtimeMsTotal: 1000, lostOrders: 1, repeats: 0, points: 0, status: 'new', qualifies: true, evidence: [{ run: 'r', seq: [1, 2], journal: ['a:1'], report: '/r' }], ...extra });

describe('patterns (TV3-U11)', () => {
  it('reads GET /api/patterns, sorted by the server cost, with evidence counted', () => {
    const v = parsePatterns({ thresholds: { count: 3, lostOrders: 1, downtimeMs: 30000 }, patterns: [P('a', { cost: 10 }), P('b', { cost: 99 }), { nope: 1 }], qualifying: 2 });
    expect(v.rows.map((r) => r.id)).toEqual(['b', 'a']);
    expect(v.rows[0]!.evidence).toBe(4);
    expect(v.qualifying).toBe(2);
    expect(v.thresholds).toContain('3 occurrences');
    expect(v.thresholds).toContain('30 s');
    expect(parsePatterns('junk').rows).toEqual([]);
  });
  it('without a cost it sorts by downtime, then lost orders and repeats', () => {
    const rows = [P('a', { downtimeMsTotal: 5 }), P('b', { downtimeMsTotal: 900 }), P('c', { downtimeMsTotal: 900, lostOrders: 4 })].map((x) => patternOf(x)!);
    expect(sortByCost(rows).map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });
  it('a pattern event replaces the row with the same id and keeps its evidence; a bad status falls back to new', () => {
    let rows = parsePatterns({ patterns: [P('a'), P('b', { status: 'bogus' })] }).rows;
    expect(rows.find((r) => r.id === 'b')!.status).toBe('new');
    rows = foldPattern(rows, { id: 'a', signature: 'payment + timeout + a', status: 'suggested', count: 4, downtimeMsTotal: 2000, change: 'updated' });
    const a = rows.find((r) => r.id === 'a')!;
    expect(a).toMatchObject({ status: 'suggested', count: 4, change: 'updated' });
    expect(a.evidence).toBe(4);
    expect(rows).toHaveLength(2);
    expect(foldPattern(rows, { id: 'x' })).toHaveLength(2);
    rows = foldPattern(rows, { id: 'z', signature: 'ship + delay + order_lost', status: 'verified' });
    expect(rows.find((r) => r.id === 'z')!.status).toBe('verified');
  });
  it('titles and plain-words fixes', () => {
    expect(patternTitle(patternOf(P('duplicate_effect'))!, (s) => s.toUpperCase())).toBe('PAYMENT: timeout, duplicate effect');
    expect(plainFix({ fault: 'timeout', consequence: 'duplicate_effect', shapes: [] })).toContain('idempotency key');
    expect(plainFix({ fault: 'timeout', consequence: 'order_lost', shapes: [] })).toContain('backoff');
    expect(plainFix({ fault: 'crash', consequence: 'order_lost', shapes: [] })).toContain('journal');
    expect(plainFix({ fault: 'x', consequence: 'y', shapes: ['hang'] })).toContain('timeout');
    expect(plainFix({ fault: 'x', consequence: 'y', shapes: ['retry_storm'] })).toContain('breaker');
    expect(plainFix({ fault: 'x', consequence: 'y', shapes: ['curse'] })).toContain('swallow');
    expect(plainFix({ fault: 'x', consequence: 'y', shapes: [] }).length).toBeGreaterThan(10);
    expect([secText(0), secText(800), secText(16000), secText(95000)]).toEqual(['0 s', '0.8 s', '16 s', '1 min 35 s']);
  });
  it('reads the spec result with lint ok or issues, from the answer or the event', () => {
    const ok = specResultOf({ runId: 'imp-1', path: '.kiro/specs/hardening-imp-1', patterns: ['p-1', { id: 'p-2' }], refused: [], lint: { ok: true, issues: [] } })!;
    expect(ok).toMatchObject({ path: '.kiro/specs/hardening-imp-1', patterns: ['p-1', 'p-2'], lintOk: true, issues: [] });
    const bad = specResultOf({ runId: 'r', path: 'p', refused: [{ signature: 's' }], lint: { ok: false, issues: ['R1 has no evidence', { message: 'no test' }] } })!;
    expect(bad).toMatchObject({ lintOk: false, refused: ['s'], issues: ['R1 has no evidence', 'no test'] });
    expect(specResultOf({})).toBeNull();
    expect(specResultOf({ runId: 'x', path: 'y' })!.lintOk).toBeNull();
  });
});

describe('improve loop (TV3-U11)', () => {
  const report = { closed: 7, of: 9, summary: 'closed 7 of 9 patterns', grade: { before: 'C', after: 'A' }, reliability: { before: 62, after: 91 }, score: { before: 100, after: 400 }, lost: { before: 9, after: 1 }, repeats: { before: 6, after: 0 },
    patterns: [{ id: 'p-1', signature: 'payment + timeout + order_lost', handling: 'overlay', before: 4, after: 0, status: 'verified', closed: true }, { id: 'p-2', signature: 'ship + delay + order_lost', handling: 'spec', before: 2, after: 2, status: 'suggested', closed: false }],
    overlays: [{ lane: 2, tier: 'retrier', signature: 'payment + timeout + order_lost', action: 'retry_backoff', stage: 'payment', fault: 'timeout', existing: false }], spec: { runId: 'imp-1', path: 'x', patterns: [], refused: [], lint: { ok: true, issues: [] } }, newPatterns: [{}], text: 't' };
  it('follows the phases', () => {
    expect(parseImprove({ improve: 'imp-1', phase: 'before' })).toMatchObject({ id: 'imp-1', phase: 'before', report: null });
    expect(parseImprove({ id: 'imp-1', phase: 'nonsense' })).toBeNull();
    expect(parseImprove({ phase: 'done' })).toBeNull();
    expect(isRunning(parseImprove({ id: 'i', phase: 'mining' }))).toBe(true);
    expect(isRunning(parseImprove({ id: 'i', phase: 'done' }))).toBe(false);
    expect(isRunning(parseImprove({ id: 'i', phase: 'error', error: 'x' }))).toBe(false);
    expect(isRunning(null)).toBe(false);
    const order = ['before', 'mining', 'applying', 'after', 'comparing', 'done'] as const;
    const ps = order.map(phaseProgress);
    expect(ps).toEqual([...ps].sort((a, b) => a - b));
    expect(ps[0]).toBeGreaterThan(0);
    expect(ps[5]).toBe(1);
  });
  it('reads the compare report: closed of, grade, four metrics, per-pattern before and after, overlays, spec', () => {
    const r = parseImprove({ id: 'i', phase: 'done', report })!.report!;
    expect(r).toMatchObject({ closed: 7, of: 9, summary: 'closed 7 of 9 patterns', grade: { before: 'C', after: 'A' }, newPatterns: 1 });
    expect(r.reliability).toEqual({ before: 62, after: 91 });
    expect(r.patterns.map((p) => [p.id, p.before, p.after, p.closed])).toEqual([['p-1', 4, 0, true], ['p-2', 2, 2, false]]);
    expect(r.spec!.lintOk).toBe(true);
    expect(overlayText(r.overlays[0]!, (s) => s.toUpperCase())).toBe('Retrier: retry backoff at PAYMENT');
    expect(overlayText({ ...r.overlays[0]!, existing: true })).toContain('already learned');
    expect(reportOf({})).toBeNull();
    const lean = reportOf({ patterns: [{ signature: 'a + b + c', closed: true }, { signature: 'd + e + f' }] })!;
    expect([lean.closed, lean.of, lean.summary]).toEqual([1, 2, 'closed 1 of 2 patterns']);
  });
  it('grade moves and metric text', () => {
    expect(gradeMove({ before: 'C', after: 'A' })).toBe(1);
    expect(gradeMove({ before: 'B', after: 'B' })).toBe(0);
    expect(gradeMove({ before: 'A', after: 'C+' })).toBe(-1);
    expect(gradeMove({ before: 'B-', after: 'B' })).toBe(1);
    expect(gradeMove({ before: null, after: 'A' })).toBe(1);
    expect(metricText('reliability', 0.62)).toBe('62%');
    expect(metricText('reliability', 91)).toBe('91%');
    expect(metricText('score', 11603.4)).toBe('11603');
    expect(metricText('count', null)).toBe('-');
  });
});

describe('curses (TV3-U11)', () => {
  const IDS = ['account', 'create', 'submit', 'payment', 'confirmation'];
  it('curse_start puts a curse on the stage named by the endpoint, curse_end removes it', () => {
    const l: CurseHost = {};
    applyCurseEvent(l, { type: 'curse_start', detail: { id: 'c1', kind: '404', endpoint: '/api/payment', rate: 0.3 } }, 100, IDS);
    expect(l.curses).toEqual([{ id: 'c1', kind: '404', endpoint: '/api/payment', stage: 'payment', rate: 0.3, startedAt: 100 }]);
    applyCurseEvent(l, { type: 'curse_start', stage: 'submit', detail: { id: 'c2', kind: 'slow', endpoint: 'orders' } }, 110, IDS);
    expect(l.curses!.map((c) => c.stage)).toEqual(['payment', 'submit']);
    applyCurseEvent(l, { type: 'curse_start', detail: { id: 'c1', kind: 'flaky500', endpoint: 'x' } }, 120, IDS);
    expect(l.curses!.filter((c) => c.id === 'c1')).toHaveLength(1);
    applyCurseEvent(l, { type: 'curse_end', detail: { id: 'c1' } }, 130, IDS);
    expect(l.curses!.map((c) => c.id)).toEqual(['c2']);
    expect(applyCurseEvent(l, { type: 'curse_start', detail: {} }, 0, IDS)).toBeNull();
    expect(stageOfEndpoint('/api/confirmation', IDS)).toBe('confirmation');
    expect(stageOfEndpoint('/nowhere', IDS)).toBe('');
    expect([curseShort('404'), curseShort('flaky500'), curseShort('rate_limit'), curseShort('clock_skew'), curseShort('slow')]).toEqual(['404', '500', '429', 'SKEW', 'SLOW']);
  });
  it('every answer pops once per response, classified; bad classes are ignored', () => {
    const l: CurseHost = {};
    expect(applyCurseEvent(l, { type: 'curse_response', stage: 'payment', detail: { curse: 'c1', class: 'swallowed' } }, 50, IDS)).toBe('swallowed');
    expect(applyCurseEvent(l, { type: 'curse_response', detail: { stage: 'submit', curse: 'c1', class: 'handled' } }, 60, IDS)).toBe('handled');
    expect(applyCurseEvent(l, { type: 'curse_response', detail: { class: 'shrugged' } }, 70, IDS)).toBeNull();
    expect(l.cursepops!.map((p) => [p.stage, p.cls])).toEqual([['payment', 'swallowed'], ['submit', 'handled']]);
    for (let i = 0; i < 9; i++) applyCurseEvent(l, { type: 'curse_response', stage: 'payment', detail: { class: 'crashed' } }, 5000 + i, IDS);
    expect(l.cursepops!.length).toBeLessThanOrEqual(6);
  });
  it('the curse table counts answers per lane, worst first', () => {
    const led = emptyCurseLedger();
    countAnswer(led, 1, 'handled'); countAnswer(led, 1, 'handled'); countAnswer(led, 2, 'swallowed'); countAnswer(led, 3, 'crashed'); countAnswer(led, 3, 'handled');
    expect(curseTable(led).map((r) => [r.lane, r.handled, r.swallowed, r.crashed, r.total])).toEqual([[3, 1, 0, 1, 2], [2, 0, 1, 0, 1], [1, 2, 0, 0, 2]]);
    expect(curseTable(emptyCurseLedger())).toEqual([]);
  });
  it('flows through the view model and is drawn on the chip, the lane card and as a pop', () => {
    class FakePath { constructor(public d?: string) {} addPath(): void {} ellipse(): void {} roundRect(): void {} rect(): void {} moveTo(): void {} lineTo(): void {} arc(): void {} closePath(): void {} quadraticCurveTo(): void {} bezierCurveTo(): void {} }
    (globalThis as Record<string, unknown>).Path2D = FakePath;
    const chain = (): CanvasRenderingContext2D => { const fn: unknown = new Proxy(function () {}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 30 }) : fn), set: () => true, apply: () => fn }); return fn as CanvasRenderingContext2D; };
    const vm = emptyVM();
    loadSnapshot(vm, { app: 'orders', stages: IDS.map((id) => ({ id, label: id, icon: '', workAnimation: 'think' })), lanes: [{ lane: 1, tier: 'rookie', label: 'Rookie', state: 'working', order: 'o1', stage: 'payment', stageIndex: 3, orderIndex: 1, ordersTotal: 3, score: 0, counts: { completed: 0, failed: 0, parked: 0, quarantined: 0, repeats: 0 }, depth: 0, parts: [] }] } as never, 0);
    applyEvent(vm, { seq: 1, ts: 1, type: 'curse_start', lane: 1, detail: { id: 'c1', kind: '404', endpoint: 'payment' } } as never, 10);
    applyEvent(vm, { seq: 2, ts: 2, type: 'curse_response', lane: 1, stage: 'payment', detail: { curse: 'c1', class: 'swallowed' } } as never, 20);
    expect(vm.lanes[0]!.curses).toHaveLength(1);
    const scene = new ArenaScene(chain());
    const draw = (now: number) => (scene as unknown as { drawLane(c: CanvasRenderingContext2D, v: typeof vm, l: (typeof vm.lanes)[0], b: { top: number; h: number }, n: number): void }).drawLane(chain(), vm, vm.lanes[0]!, laneBoxes(5)[0]!, now);
    draw(300);
    expect(scene.hot.some((h) => h.tip.includes('Cursed 404 on payment'))).toBe(true);
    scene.reducedMotion = true;
    expect(() => draw(5000)).not.toThrow();
    applyEvent(vm, { seq: 3, ts: 3, type: 'curse_end', lane: 1, detail: { id: 'c1' } } as never, 30);
    expect(vm.lanes[0]!.curses).toHaveLength(0);
  });
});

describe('Casebook polish (TV3-U11)', () => {
  it('reads per-lane outcomes from lanes[] objects and keeps the plain-number fallback', () => {
    const cb = emptyCasebook();
    loadCasebook(cb, { cases: [{ signature: 'payment + timeout + order_lost', lanes: [{ lane: 1, outcome: 'lost' }, { lane: 4, outcome: 'solved', mechanism: 'retry_backoff' }, { lane: 5, outcome: 'partly' }], cost: { downtimeMs: 900, points: 120 }, status: 'solved', recommendedFix: { action: 'retry_backoff', part: 'retry' } }] });
    const [row] = caseRows(cb);
    expect(row!.entries.map((e) => [e.lane, e.outcome])).toEqual([[1, 'lost'], [4, 'solved'], [5, 'partly']]);
    expect(row!.solvedBy).toEqual([{ lane: 4, mechanism: 'retry_backoff' }]);
    expect(row!.open).toBe(false);
    const plain = emptyCasebook();
    loadCasebook(plain, { cases: [{ signature: 'a + b + order_lost', lanes: [1, 2], solvedBy: [{ lane: 2, mechanism: 'retry' }] }] });
    expect(caseRows(plain)[0]!.entries.map((e) => [e.lane, e.outcome])).toEqual([[1, 'lost'], [2, 'solved']]);
  });
  it('an absorbed case is not solved and not open', () => {
    const cb = emptyCasebook();
    loadCasebook(cb, { cases: [{ signature: 'payment + http_429 + absorbed', lanes: [{ lane: 1, outcome: 'solved', mechanism: 'absorbed' }, { lane: 2, outcome: 'solved', mechanism: 'absorbed' }], solvedBy: [{ lane: 1, mechanism: 'absorbed' }] },
      { signature: 'payment + http_429 + absorbed ', lanes: [3], solvedBy: [{ lane: 3, mechanism: 'absorbed' }] }] });
    for (const r of caseRows(cb)) expect([r.absorbed, r.open, r.solvedBy.length]).toEqual([true, false, 0]);
    expect(solvedCounts(cb).size).toBe(0);
  });
  it('hides a Fastest Recovery award with value 0, keeps the others', () => {
    const awards = awardsOf([{ id: 'fastest_recovery', label: 'Fastest Recovery', lane: 1, value: 0, text: 'x' }, { id: 'battle_tested', label: 'Battle-Tested', lane: 4, value: 3, text: 'y' }]);
    expect(awards.map((a) => [a.id, a.value])).toEqual([['fastest_recovery', 0], ['battle_tested', 3]]);
  });
});
