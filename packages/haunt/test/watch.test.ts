import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PatternStore } from '../src/miner/patterns';
import { FilePatternStore } from '../src/miner/pattern-store';
import { lintSpecDir } from '../src/miner/specs';
import type { Ev } from '../src/tournament/rp';
import { checkWatch, Watch, WATCH_ROUND_MS, type RoundContext, type RoundResult } from '../src/monkey/watch';
import { defaultConfig } from '../src/monkey/config';
import { monkeyRoundRunner, scaleConfig } from '../src/monkey/host';
import type { InjectionTarget, Sample } from '../src/monkey/monkey';
import { watchCommand } from '../src/monkey/cli';

let dir = '';
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'haunt-watch-')); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }); });

/** A round whose probe failed 4 of 6 times at /api/items: the "endpoint fails often" pattern (count 4, over the threshold of 3). */
function failingRound(index: number): RoundResult {
  const events: Ev[] = [];
  let seq = 0;
  for (let i = 0; i < 6; i++) {
    events.push({ seq: ++seq, type: 'stage_start', lane: 1, order: `r${index}-${i}`, stage: '/api/items' });
    if (i < 4) events.push({ seq: ++seq, type: 'stage_fail', lane: 1, order: `r${index}-${i}`, stage: '/api/items', detail: { error: 'probe failed' } });
  }
  return { events, status: 'completed', injections: 1, samples: 6, successRate: 2 / 6 };
}
const healthy = (): RoundResult => ({ events: [], status: 'completed', injections: 0, samples: 6, successRate: 1 });

function setup(round: (c: RoundContext) => Promise<RoundResult>, over: Partial<ConstructorParameters<typeof Watch>[0]> = {}) {
  const store = new FilePatternStore(join(dir, '.haunt', 'patterns.json'));
  const watch = new Watch({ mode: 'staging', round, store, specsDir: join(dir, 'specs'), reportFile: join(dir, '.haunt', 'watch-report.json'), runId: 'watch-test', ...over });
  return { store, watch };
}

describe('watch speed rules', () => {
  it('accepts 1x to 100x in observe and staging, refuses anything else, and only 1x in prod-guarded', () => {
    for (const m of ['observe', 'staging'] as const) for (const s of [1, 2, 10, 50, 100]) expect(checkWatch(m, s)).toBeNull();
    for (const s of [0, 0.5, 101, -1, Number.NaN]) expect(checkWatch('staging', s)).toMatch(/outside 1x to 100x/);
    expect(checkWatch('prod-guarded', 1)).toBeNull();
    for (const s of [2, 10, 100]) expect(checkWatch('prod-guarded', s)).toMatch(/1x only/);
  });
  it('the constructor refuses what the check refuses', () => {
    const store = new PatternStore('');
    expect(() => new Watch({ mode: 'prod-guarded', speed: 5, round: async () => healthy(), store })).toThrow(/1x only/);
    expect(() => new Watch({ mode: 'staging', speed: 500, round: async () => healthy(), store })).toThrow(/outside/);
  });
});

describe('haunt watch loop (fake timers)', () => {
  it('runs a round every roundMs / speed', async () => {
    for (const speed of [1, 10, 100]) {
      let n = 0;
      const { watch } = setup(async () => { n++; return healthy(); }, { speed, runId: `s${speed}` });
      const done = watch.start();
      await vi.advanceTimersByTimeAsync(WATCH_ROUND_MS); // one 1x interval
      expect(n).toBe(1 + speed); // the first round runs at once, then one per interval
      watch.stop();
      await done;
    }
  });

  it('1x waits the full interval between rounds', async () => {
    let n = 0;
    const { watch } = setup(async () => { n++; return healthy(); });
    const done = watch.start();
    await vi.advanceTimersByTimeAsync(WATCH_ROUND_MS - 1);
    expect(n).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(n).toBe(2);
    watch.stop();
    await done;
  });

  it('mines every round into the pattern store, writes one spec when a pattern qualifies, and not again for the same pattern', async () => {
    const lines: string[] = [];
    const { watch, store } = setup(async (c) => failingRound(c.index), { log: (l) => lines.push(l), maxRounds: 3, roundMs: 10 });
    const done = watch.start();
    await vi.advanceTimersByTimeAsync(100);
    const report = await done;
    expect(report.rounds).toBe(3);
    const ps = store.list();
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ stage: '/api/items', consequence: 'degraded', count: 12, status: 'suggested' });
    expect(existsSync(join(dir, '.haunt', 'patterns.json'))).toBe(true);
    expect(report.specs).toHaveLength(1);
    expect(lines.filter((l) => l.startsWith('spec written'))).toHaveLength(1);
    expect(lintSpecDir(report.specs[0]!).ok).toBe(true);
    expect(readFileSync(join(report.specs[0]!, 'requirements.md'), 'utf8')).toContain('/api/items');
    expect(report.patterns).toEqual({ total: 1, qualifying: 1 });
  });

  it('persists the pattern store to .haunt/patterns.json across runs (the miner feed)', async () => {
    const a = setup(async (c) => failingRound(c.index), { maxRounds: 1, roundMs: 10, runId: 'run-a' });
    const da = a.watch.start();
    await vi.advanceTimersByTimeAsync(20);
    await da;
    const file = join(dir, '.haunt', 'patterns.json');
    expect(JSON.parse(readFileSync(file, 'utf8')).patterns).toHaveLength(1);
    const b = setup(async (c) => failingRound(c.index), { maxRounds: 1, roundMs: 10, runId: 'run-b' });
    const db = b.watch.start();
    await vi.advanceTimersByTimeAsync(20);
    await db;
    const ps = new FilePatternStore(file).list();
    expect(ps).toHaveLength(1);
    expect(ps[0]!.runs).toEqual(['run-a#1', 'run-b#1']);
    expect(ps[0]!.count).toBe(8);
  });

  it('writes a rolling report after every round, with a rolling success rate', async () => {
    const report = join(dir, 'roll.json');
    const { watch } = setup(async (c) => (c.index % 2 ? failingRound(c.index) : healthy()), { reportFile: report, roundMs: 100, windowRounds: 2, specsDir: undefined });
    const done = watch.start();
    await vi.advanceTimersByTimeAsync(0);
    let j = JSON.parse(readFileSync(report, 'utf8'));
    expect(j).toMatchObject({ rounds: 1, running: true, mode: 'staging', speed: 1 });
    await vi.advanceTimersByTimeAsync(100);
    j = JSON.parse(readFileSync(report, 'utf8'));
    expect(j.rounds).toBe(2);
    await vi.advanceTimersByTimeAsync(300);
    j = JSON.parse(readFileSync(report, 'utf8'));
    expect(j.rounds).toBeGreaterThanOrEqual(4);
    expect(j.recent).toHaveLength(2); // the window trims
    expect(j.rollingSuccessRate).toBeGreaterThan(2 / 6);
    expect(j.rollingSuccessRate).toBeLessThan(1);
    watch.stop('test over');
    const final = await done;
    expect(final.running).toBe(false);
    expect(JSON.parse(readFileSync(report, 'utf8'))).toMatchObject({ running: false, stopReason: 'test over' });
  });

  it('stop() is clean: aborts the round in flight, leaves no timers and resolves', async () => {
    let aborted = false;
    const { watch } = setup((c) => new Promise<RoundResult>((res) => { c.signal.addEventListener('abort', () => { aborted = true; res(healthy()); }); }));
    const done = watch.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(watch.active).toBe(true);
    watch.stop('kill switch');
    const r = await done;
    expect(aborted).toBe(true);
    expect(r.stopReason).toBe('kill switch');
    expect(watch.active).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stop() during the wait between rounds ends at once', async () => {
    let n = 0;
    const { watch } = setup(async () => { n++; return healthy(); });
    const done = watch.start();
    await vi.advanceTimersByTimeAsync(10);
    watch.stop();
    await done;
    await vi.advanceTimersByTimeAsync(WATCH_ROUND_MS * 3);
    expect(n).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a round that throws is counted and the watch carries on', async () => {
    let n = 0;
    const { watch } = setup(async () => { n++; if (n === 1) throw new Error('boom'); return healthy(); }, { roundMs: 10, maxRounds: 3 });
    const done = watch.start();
    await vi.advanceTimersByTimeAsync(100);
    const r = await done;
    expect(r.errors).toBe(1);
    expect(r.rounds).toBe(3);
    expect(r.recent[0]).toMatchObject({ status: 'error', reason: 'boom' });
  });

  it('prod-guarded rounds are refused by the monkey outside the window, and the watch keeps its 1x pace', async () => {
    const seen: number[] = [];
    const { watch } = setup(async (c) => { seen.push(c.speed); return { events: [], status: 'refused', reason: 'outside the schedule window', samples: 0 }; }, { mode: 'prod-guarded', roundMs: 1000, maxRounds: 2 });
    const done = watch.start();
    await vi.advanceTimersByTimeAsync(1500);
    const r = await done;
    expect(seen).toEqual([1, 1]);
    expect(r.recent.map((x) => x.status)).toEqual(['refused', 'refused']);
  });
});

describe('monkey round runner (the real Monkey under fake timers)', () => {
  const target = (): InjectionTarget & { added: unknown[] } => {
    const t = { added: [] as unknown[], addFault(f: unknown) { t.added.push(f); return t.added.length; }, removeFault() {}, clearFaults() { t.added.length = 0; }, stats: () => ({ forwarded: 0, injected: 0, byKind: { status: 0, drop: 0, latency: 0 } }) };
    return t;
  };

  it('scales probes and the duration cap by the speed, and leaves 1x untouched', () => {
    const c = defaultConfig('staging');
    expect(scaleConfig(c, 1)).toBe(c);
    const f = scaleConfig(c, 50);
    expect(f.hypothesis.intervalMs).toBe(10);
    expect(f.blast.maxDurationMs).toBe(c.blast.maxDurationMs / 50);
  });

  it('turns failed probes into miner events and an outage on a breach', async () => {
    const cfg = { ...defaultConfig('staging'), blast: { ...defaultConfig('staging').blast, maxDurationMs: 5000 }, hypothesis: { ...defaultConfig('staging').hypothesis, intervalMs: 50, minSamples: 3, window: 6, threshold: 0.9 } };
    let n = 0;
    const probe = async (): Promise<Sample> => { n++; return { ok: n <= 3, ms: 5 }; }; // healthy baseline, then everything fails
    const run = monkeyRoundRunner({ base: cfg, target: target(), probe, probePath: '/api/items' });
    const p = run({ index: 1, speed: 1, mode: 'staging', signal: new AbortController().signal });
    await vi.advanceTimersByTimeAsync(1000);
    const r = await p;
    expect(r.status).toBe('aborted');
    const types = r.events.map((e) => e.type);
    expect(types).toContain('stage_fail');
    expect(types).toContain('outage');
    expect(r.events.filter((e) => e.type === 'stage_start').length).toBe(r.samples);
  });

  it('the abort signal is the kill switch of the round in flight', async () => {
    const t = target();
    const cfg = defaultConfig('staging');
    const ac = new AbortController();
    const run = monkeyRoundRunner({ base: cfg, target: t, probe: async () => ({ ok: true, ms: 1 }), probePath: '/api/items' });
    const p = run({ index: 1, speed: 1, mode: 'staging', signal: ac.signal });
    await vi.advanceTimersByTimeAsync(2000);
    expect(t.added.length).toBeGreaterThan(0);
    ac.abort();
    const r = await p;
    expect(r.status).toBe('stopped');
    expect(t.added.length).toBe(0);
  });
});

describe('haunt watch CLI', () => {
  it('refuses a bad speed, prod-guarded above 1x and a missing mode (exit 2, nothing started)', async () => {
    const out: string[] = [];
    const log = (s: string): void => { out.push(s); };
    expect(await watchCommand(['--mode', 'staging', '--speed', '101'], log)).toBe(2);
    expect(await watchCommand(['--mode', 'staging', '--speed', '0'], log)).toBe(2);
    expect(await watchCommand([], log)).toBe(2);
    const prod = join(dir, 'prod.yaml');
    (await import('node:fs')).writeFileSync(prod, 'mode: prod-guarded\nschedule: { startHourUtc: 0, endHourUtc: 24 }\n');
    expect(await watchCommand(['--mode', 'prod-guarded', '--config', prod, '--speed', '2'], log)).toBe(2);
    expect(out.join('\n')).toMatch(/1x only/);
    expect(await watchCommand(['--mode', 'staging', '--rounds', '0'], log)).toBe(2);
  });

  it('--dry-run prints the plan and starts nothing', async () => {
    const out: string[] = [];
    expect(await watchCommand(['--mode', 'staging', '--speed', '10', '--dry-run'], (s) => out.push(s))).toBe(0);
    expect(out.join('\n')).toMatch(/dry run[\s\S]*watch: speed 10x/);
  });
});

describe('haunt watch SIGINT (real timers, real demo target on 127.0.0.1)', () => {
  it('stops cleanly on SIGINT: report written, control file and ports released', async () => {
    vi.useRealTimers();
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const out: string[] = [];
      const run = watchCommand(['--mode', 'observe', '--speed', '20', '--round-ms', '100', '--control-port', '0'], (s) => out.push(s));
      await new Promise((r) => setTimeout(r, 700));
      expect(existsSync(join(dir, '.haunt', 'monkey.control.json'))).toBe(true);
      process.emit('SIGINT');
      expect(await run).toBe(0);
      expect(existsSync(join(dir, '.haunt', 'monkey.control.json'))).toBe(false);
      const rep = JSON.parse(readFileSync(join(dir, '.haunt', 'watch-report.json'), 'utf8'));
      expect(rep).toMatchObject({ running: false, stopReason: 'signal', mode: 'observe', speed: 20 });
      expect(rep.rounds).toBeGreaterThanOrEqual(1);
      expect(rep.injections).toBe(0); // observe injects nothing
      expect(out.join('\n')).toMatch(/watch ended \(signal\)/);
    } finally { process.chdir(cwd); }
  });
});
