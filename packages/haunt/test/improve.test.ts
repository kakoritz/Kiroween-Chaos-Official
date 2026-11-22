// TV3-C13: the self-improving loop (spec 8.3).
import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PatternStore, improve, lintSpecDir, runGrade, runReliability, type RunResult } from '../src/miner';
import { LessonsStore } from '../src/tournament/lessons';
import { parsePolicy } from '../src/sdk';
import type { Ev } from '../src/tournament/rp';

let seq = 0;
const e = (type: string, lane: number, detail: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Ev => ({ type, lane: String(lane), detail, seq: ++seq, ...extra });
const order = (lane: number, n: number, fault: string, end: 'done' | 'failed', o: { repeat?: boolean; recover?: string } = {}): Ev[] => {
  const id = `ord-${String(n).padStart(4, '0')}`;
  return [e('order_start', lane, {}, { order: id }), e('stage_start', lane, {}, { order: id, stage: 'payment' }), e('chaos', lane, { fault }, { stage: 'payment' }),
    ...(o.recover ? [e('recover_start', lane, { action: o.recover }), e('recover_done', lane, { action: o.recover, ms: 900 })] : []),
    ...(o.repeat ? [e('repeat', lane, { kind: 'charge' }, { order: id })] : []),
    end === 'done' ? e('order_done', lane, {}, { order: id }) : e('order_failed', lane, {}, { order: id })];
};

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'haunt-improve-'));
  const store = new PatternStore(join(root, 'patterns.json'));
  const lessons = new LessonsStore(join(root, 'lessons'));
  return { root, store, lessons, specsDir: join(root, 'specs') };
}

describe('improve: run, mine, apply, spec, rerun, compare', () => {
  it('closes the pattern a policy overlay can fix, writes a spec for the one that needs code, and marks only what the rerun shows gone as verified', async () => {
    const { store, lessons, specsDir } = setup();
    const phases: string[] = [];
    const report = await improve({
      store, lessons, specsDir, plan: 'the tournament with seed 7', specRunId: 'imp-test',
      onPhase: (p) => phases.push(p),
      async runPlan(label) {
        const patched = existsSync(lessons.policyFile(2));
        // Lane 2 (Retrier) loses orders to an outage until it has the overlay; lane 3 (Journaler) repeats a charge on a timeout whatever happens.
        const events = label === 'before' || !patched
          ? [...order(2, 1, 'endpoint_down', 'failed'), ...order(2, 2, 'endpoint_down', 'failed'), ...order(3, 1, 'timeout', 'done', { repeat: true, recover: 'retry' }), ...order(3, 2, 'timeout', 'done', { repeat: true, recover: 'retry' }), ...order(3, 3, 'timeout', 'done', { repeat: true, recover: 'retry' })]
          : [...order(2, 1, 'endpoint_down', 'done', { recover: 'backoff' }), ...order(2, 2, 'endpoint_down', 'done', { recover: 'backoff' }), ...order(3, 1, 'timeout', 'done', { repeat: true, recover: 'retry' }), ...order(3, 2, 'timeout', 'done', { repeat: true, recover: 'retry' }), ...order(3, 3, 'timeout', 'done', { repeat: true, recover: 'retry' })];
        const lost = events.filter((x) => x.type === 'order_failed').length;
        const repeats = events.filter((x) => x.type === 'repeat').length;
        return { run: `run-${label}`, events, orders: 5, ok: 5 - lost, lost, repeats, score: label === 'before' ? -300 : 200, reports: [`/api/waves/${label === 'before' ? 1 : 2}/report`] } satisfies RunResult;
      },
    });
    expect(phases).toEqual(['before', 'mining', 'applying', 'after', 'comparing']);
    expect(report.summary).toBe('closed 1 of 2 patterns');
    expect([report.closed, report.of]).toEqual([1, 2]);
    const by = Object.fromEntries(report.patterns.map((p) => [p.signature, p]));
    expect(by['payment + endpoint_down + order_lost']).toMatchObject({ handling: 'overlay', before: 2, after: 0, status: 'verified', closed: true });
    expect(by['payment + timeout + duplicate_effect']).toMatchObject({ handling: 'spec', before: 3, after: 3, status: 'suggested', closed: false });

    // The overlay is data for a tier that can take it: lane 2, retry with backoff.
    expect(report.overlays).toEqual([{ lane: 2, tier: 'retrier', signature: 'payment + endpoint_down + order_lost', action: 'retry_backoff', stage: 'payment', fault: 'endpoint_down', existing: false }]);
    expect(parsePolicy(JSON.parse(readFileSync(lessons.policyFile(2), 'utf8'))).rules).toEqual([{ stage: 'payment', fault: 'endpoint_down', action: 'retry_backoff', backoff: 'exp', maxAttempts: 5 }]);
    expect(existsSync(lessons.policyFile(3))).toBe(false);

    // The spec covers what needs code, passes lint, and is not applied.
    expect(report.spec).toMatchObject({ runId: 'imp-test', path: '.kiro/specs/hardening-imp-test', lint: { ok: true } });
    expect(report.spec!.patterns).toHaveLength(1);
    expect(lintSpecDir(join(specsDir, 'hardening-imp-test')).ok).toBe(true);
    expect(readFileSync(join(specsDir, 'hardening-imp-test', 'requirements.md'), 'utf8')).toMatch(/payment \+ timeout \+ duplicate_effect/);
    expect(readFileSync(join(specsDir, 'hardening-imp-test', 'requirements.md'), 'utf8')).not.toMatch(/endpoint_down/);
    expect(readFileSync(join(specsDir, 'hardening-imp-test', 'tasks.md'), 'utf8')).toMatch(/rerun the tournament with seed 7/);

    // Grade and numbers.
    expect(report.grade).toEqual({ before: 'F', after: 'C' });
    expect(report.reliability).toEqual({ before: 30, after: 70 });
    expect(report.lost).toEqual({ before: 2, after: 0 });
    expect(report.score).toEqual({ before: -300, after: 200 });
    expect(report.newPatterns).toEqual([]);
    expect(report.text).toMatch(/# Improve: closed 1 of 2 patterns/);
    expect(report.text).toContain('| Grade | F | C |');
    expect(report.text).toMatch(/lane 2 \(retrier\): `retry_backoff`/);
    expect(report.text).toMatch(/Kiro applies it with the review step/);
    // The store carries the statuses of the flow.
    const st = Object.fromEntries(store.list().map((p) => [p.signature, p.status]));
    expect(st['payment + endpoint_down + order_lost']).toBe('verified');
    expect(st['payment + timeout + duplicate_effect']).toBe('suggested');
  });

  it('a pattern the loop acted on that is still there is applied, not verified; a rerun that finds a new pattern says so', async () => {
    const { store, lessons, specsDir } = setup();
    const report = await improve({
      store, lessons, specsDir,
      async runPlan(label) {
        const base = [...order(2, 1, 'endpoint_down', 'failed'), ...order(2, 2, 'endpoint_down', 'failed')];
        const events = label === 'before' ? base : [...base, ...order(4, 1, 'http_500', 'failed')];
        const lost = events.filter((x) => x.type === 'order_failed').length;
        return { run: label, events, orders: 6, ok: 6 - lost, lost, repeats: 0, score: 0 };
      },
    });
    expect(report.summary).toBe('closed 0 of 1 patterns');
    expect(report.patterns[0]).toMatchObject({ handling: 'overlay', status: 'applied', closed: false });
    expect(report.newPatterns).toEqual(['payment + http_500 + order_lost']);
    expect(report.spec).toBeNull();
    expect(store.list().find((p) => p.signature === 'payment + http_500 + order_lost')!.status).toBe('new');
  });

  it('a Rookie that meets a pattern gets no overlay (its parts allow none) and the pattern goes to the spec', async () => {
    const { store, lessons, specsDir } = setup();
    const report = await improve({
      store, lessons, specsDir,
      async runPlan() {
        const events = [...order(1, 1, 'endpoint_down', 'failed'), ...order(1, 2, 'endpoint_down', 'failed')];
        return { run: 'r', events, orders: 4, ok: 2, lost: 2, repeats: 0, score: 0 };
      },
    });
    expect(report.overlays).toEqual([]);
    expect(lessons.lanes()).toEqual([]);
    expect(report.patterns[0]).toMatchObject({ handling: 'spec', status: 'suggested' });
    expect(report.spec!.patterns).toHaveLength(1);
  });

  it('applies only what a policy can change: a Phoenix lane (a breaker bot) gets no retry overlay, a Retrier lane does', async () => {
    const { store, lessons, specsDir } = setup();
    const report = await improve({
      store, lessons, specsDir,
      async runPlan() {
        const events = [...order(2, 1, 'endpoint_down', 'failed'), ...order(5, 1, 'endpoint_down', 'failed')];
        return { run: 'r', events, orders: 4, ok: 2, lost: 2, repeats: 0, score: 0 };
      },
    });
    expect(report.overlays.map((o) => [o.lane, o.tier])).toEqual([[2, 'retrier']]);
    expect(lessons.lanes()).toEqual([2]);
    expect(existsSync(lessons.policyFile(5))).toBe(false);
  });

  it('with nothing above the threshold there is nothing to do and nothing is written', async () => {
    const { store, lessons, specsDir } = setup();
    const report = await improve({ store, lessons, specsDir, async runPlan() { return { run: 'r', events: order(2, 1, 'timeout', 'done', { recover: 'backoff' }), orders: 1, ok: 1, lost: 0, repeats: 0, score: 0 }; } });
    expect(report).toMatchObject({ closed: 0, of: 0, spec: null, overlays: [] });
    expect(existsSync(specsDir)).toBe(false);
  });

  it('a spec that cannot be written without lint passing is never silently skipped; no source file is touched', async () => {
    const { store, lessons } = setup();
    // Without a specs folder the spec step is skipped, and the pattern stays new rather than pretending to be suggested.
    const report = await improve({ store, lessons, async runPlan() { return { run: 'r', events: [...order(1, 1, 'endpoint_down', 'failed')], orders: 2, ok: 1, lost: 1, repeats: 0, score: 0 }; } });
    expect(report.spec).toBeNull();
    expect(store.list()[0]!.status).toBe('new');
  });

  it('run grade: orders done over orders given, each repeat half an order', () => {
    expect(runReliability({ orders: 10, ok: 10, repeats: 0 })).toBe(100);
    expect(runReliability({ orders: 10, ok: 8, repeats: 2 })).toBe(70);
    expect(runReliability({ orders: 0, ok: 0, repeats: 0 })).toBe(0);
    expect(runGrade({ orders: 10, ok: 10, repeats: 0 })).toBe('A');
    expect(runGrade({ orders: 10, ok: 3, repeats: 0 })).toBe('F');
  });
});
