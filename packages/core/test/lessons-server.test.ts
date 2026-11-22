// TV3-C8: lessons through the live tournament: learning at round end, `lesson` events, the +25 bonus, the overlay file, endpoints.
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { LiveServer, type LiveEngine } from '../src/live';
import type { HauntEvent } from '../../haunt/src/score/score';

let srv: LiveServer | undefined;
afterEach(async () => { await srv?.close(); srv = undefined; });

/** Round 1: lane 2 loses an order to an outage at Payment, lane 3 rides one out with a backoff, the others are calm. */
function engine(policy?: string): LiveEngine {
  return {
    startWave(_wave, settings, record, end) {
      const lanes: number[] = settings.tournament!.lanes;
      const round = settings.tournament!.round;
      const ev = (type: string, lane: number, detail: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => record({ type, lane: String(lane), detail, ...extra } as HauntEvent);
      for (const lane of lanes) {
        const orders = lane === 1 ? 0 : lane * 2;
        for (let i = 1; i <= Math.min(orders, 6); i++) {
          const order = `ord-${String(i).padStart(4, '0')}`;
          ev('order_start', lane, { index: i, total: 6 }, { order });
          ev('stage_start', lane, { attempt: 1 }, { order, stage: 'payment' });
          if (round === 1 && i === 1 && lane === 2 && !(policy && existsSync(policy))) {
            ev('chaos', lane, { fault: 'endpoint_down', creature: 'gargoyle', scope: 'outer', depth: 1, injectedAt: 'during', source: 'random' }, { stage: 'payment' });
            ev('stage_fail', lane, { error: 'x', attempt: 1 }, { order, stage: 'payment' });
            ev('order_failed', lane, { reason: 'charge failed' }, { order });
            continue;
          }
          if (round === 1 && i === 1 && lane === 3) {
            ev('chaos', lane, { fault: 'endpoint_down', creature: 'gargoyle', scope: 'outer', depth: 1, injectedAt: 'during', source: 'random' }, { stage: 'payment' });
            ev('recover_start', lane, { action: 'backoff', attempt: 1 });
            ev('recover_done', lane, { action: 'backoff', ms: 2000 });
          }
          ev('stage_done', lane, { ms: 100, skipped: false }, { order, stage: 'payment' });
          ev('order_done', lane, { clean: true, ms: 1000 }, { order });
        }
      }
      setTimeout(() => end?.(), 5);
    },
    setChaosMode() { /* manual */ },
  };
}

async function boot() {
  const lessonsDir = join(mkdtempSync(join(tmpdir(), 'haunt-ls-')), 'lessons');
  srv = new LiveServer({ engine: engine(join(lessonsDir, 'lane-2.policy.json')), staticDir: '/nonexistent', lessonsDir, patternsFile: join(lessonsDir, '..', 'patterns.json'), runDir: join(lessonsDir, '..'), specsDir: join(lessonsDir, '..', 'specs') });
  const { url } = await srv.listen(0);
  const get = async (p: string) => { const r = await fetch(url + p); return { status: r.status, body: await r.json() as any }; };
  const post = async (p: string, b?: unknown) => { const r = await fetch(url + p, { method: 'POST', body: JSON.stringify(b ?? {}) }); return { status: r.status, body: await r.json() as any }; };
  const del = async (p: string) => { const r = await fetch(url + p, { method: 'DELETE' }); return { status: r.status, body: await r.json() as any }; };
  const until = async (fn: () => boolean) => { for (let i = 0; i < 300 && !fn(); i++) await new Promise((r) => setTimeout(r, 10)); expect(fn()).toBe(true); };
  return { url, lessonsDir, specsDir: join(lessonsDir, '..', 'specs'), get, post, del, until };
}

describe('lessons in a live tournament', () => {
  it('learns at round end, emits lesson events after round_end, pays the first-time bonus, writes the overlay for the next round, serves and resets', async () => {
    const { lessonsDir, get, post, del, until } = await boot();
    await post('/api/tournament/start', { seed: 7, resetLessons: true });
    await until(() => srv!.log.events.some((e) => e.type === 'awaiting_next'));
    const events = srv!.log.events;
    const roundEnd = events.find((e) => e.type === 'round_end')!;
    const lessons = events.filter((e) => e.type === 'lesson');
    expect(lessons.map((e) => [Number(e.lane), (e.detail as any).via, (e.detail as any).mechanism])).toEqual([[2, 'suggested', 'retry_backoff'], [3, 'overcame', 'retry_backoff']]);
    expect(events.indexOf(lessons[0]!)).toBeGreaterThan(events.indexOf(roundEnd));
    expect((lessons[0]!.detail as any).signature).toBe('payment + endpoint_down + order_lost');
    expect((lessons[1]!.detail as any).signature).toBe('payment + endpoint_down + recovered');
    expect((roundEnd.detail as any).lessons).toHaveLength(2);

    // First time overcome: +25 for lane 3 only (capped at +200).
    const st = (roundEnd.detail as any).standings;
    expect(st.find((s: any) => s.lane === 3).lessonsBonus).toBe(25);
    expect(st.find((s: any) => s.lane === 2).lessonsBonus).toBe(0);

    const l2 = (await get('/api/lessons/2')).body;
    expect(l2).toMatchObject({ lane: 2, tier: 'retrier', lessons: [{ via: 'suggested', action: 'retry_backoff', learnedRound: 1 }] });
    expect(l2.policy.rules).toEqual([{ stage: 'payment', fault: 'endpoint_down', action: 'retry_backoff', backoff: 'exp', maxAttempts: 5 }]);
    expect((await get('/api/lessons/9')).status).toBe(400);
    // The overlay of lane 2 is written when round 2 starts, before its bot would.
    expect(existsSync(join(lessonsDir, 'lane-2.policy.json'))).toBe(false);
    await post('/api/next');
    expect(existsSync(join(lessonsDir, 'lane-2.policy.json'))).toBe(true);
    expect(existsSync(join(lessonsDir, 'lane-4.policy.json'))).toBe(false);
    await until(() => srv!.log.events.filter((e) => e.type === 'round_end').length === 2);
    // Learned once: round 2 meets nothing new on lane 2, so no second lesson for the same signature.
    expect(srv!.log.events.filter((e) => e.type === 'lesson' && Number(e.lane) === 2)).toHaveLength(1);

    expect((await del('/api/lessons')).status).toBe(200);
    expect((await get('/api/lessons/2')).body.lessons).toEqual([]);
    expect(existsSync(join(lessonsDir, 'lane-2.policy.json'))).toBe(false);
  });

  it('resetLessons on start clears what an earlier tournament learned', async () => {
    const { get, post, until } = await boot();
    await post('/api/tournament/start', { seed: 7, resetLessons: true });
    await until(() => srv!.log.events.some((e) => e.type === 'awaiting_next'));
    expect((await get('/api/lessons/2')).body.lessons).toHaveLength(1);
    await srv!.close(); srv = undefined;
  });
});

describe('Casebook in a live tournament (TV3-C10)', () => {
  it('serves GET /api/casebook with open and solved cases, emits case events after round_end and crowns awards at the end', async () => {
    const { get, post, until } = await boot();
    expect((await get('/api/casebook')).body).toMatchObject({ cases: [], open: [], awards: [] });
    await post('/api/tournament/start', { seed: 7, resetLessons: true, rounds: [{ lanes: 5, orders: 6, intensity: 3 }, { lanes: 4, orders: 6, intensity: 3 }] });
    await until(() => srv!.log.events.some((e) => e.type === 'awaiting_next'));
    const evs = srv!.log.events;
    const roundEnd = evs.find((e) => e.type === 'round_end')!;
    const cases = evs.filter((e) => e.type === 'case');
    expect(cases.map((e) => [Number(e.lane), (e.detail as any).signature, (e.detail as any).outcome])).toEqual([
      [2, 'payment + endpoint_down + order_lost', 'lost'], [3, 'payment + endpoint_down + recovered', 'solved'],
    ]);
    expect(evs.indexOf(cases[0]!)).toBeGreaterThan(evs.indexOf(roundEnd));
    const book = (await get('/api/casebook')).body;
    expect(book.cases.map((r: any) => [r.signature, r.status])).toEqual([['payment + endpoint_down + order_lost', 'open'], ['payment + endpoint_down + recovered', 'solved']]);
    expect(book.cases[0].recommendedFix).toEqual({ action: 'retry_backoff', part: 'retry', rule: 'R2' });
    expect(book.cases[1].solvedBy).toMatchObject([{ lane: 3, tier: 'journaler', mechanism: 'retry_backoff' }]);
    expect((roundEnd.detail as any).casebook.cases).toHaveLength(2);
    expect((await get('/api/tournament')).body.casebook.cases).toHaveLength(2);
    await post('/api/next');
    await until(() => srv!.log.events.some((e) => e.type === 'tournament_end'));
    const end = srv!.log.events.find((e) => e.type === 'tournament_end')!;
    expect((end.detail as any).awards.map((a: any) => a.id)).toContain('champion');
    expect((end.detail as any).casebook.cases.length).toBeGreaterThanOrEqual(2);
    expect((await get('/api/casebook')).body.awards.length).toBeGreaterThan(0);
  });
});

describe('pattern miner in a live tournament (TV3-C11)', () => {
  it('mines each round into the store, publishes pattern events for qualifying patterns and serves GET /api/patterns', async () => {
    const { get, post, until, del } = await boot();
    expect((await get('/api/patterns')).body).toMatchObject({ patterns: [], qualifying: 0, thresholds: { count: 3, lostOrders: 1, downtimeMs: 30000 } });
    await post('/api/tournament/start', { seed: 7, resetLessons: true });
    await until(() => srv!.log.events.some((e) => e.type === 'awaiting_next'));
    const evs = srv!.log.events;
    const pat = evs.filter((e) => e.type === 'pattern');
    expect(pat.map((e) => (e.detail as any).signature)).toEqual(['payment + endpoint_down + order_lost']);
    expect(pat[0]!.lane).toBeUndefined();
    expect(pat[0]!.detail).toMatchObject({ count: 1, lostOrders: 1, status: 'new', qualifies: true, change: 'new', lanes: [2] });
    expect(evs.indexOf(pat[0]!)).toBeGreaterThan(evs.findIndex((e) => e.type === 'case'));
    const api = (await get('/api/patterns')).body;
    expect(api.qualifying).toBe(1);
    expect(api.patterns[0]).toMatchObject({ signature: 'payment + endpoint_down + order_lost', status: 'new', lostOrders: 1, qualifies: true, shapes: ['case'], lanes: [2] });
    expect(api.patterns[0].firstSeen).toMatchObject({ round: 1, order: 'ord-0001', lane: 2 });
    expect(api.patterns[0].evidence[0]).toMatchObject({ round: 1, report: '/api/waves/1/report' });
    // Round 2 on the same server keeps accumulating into the same file.
    await post('/api/next');
    await until(() => srv!.log.events.filter((e) => e.type === 'round_end').length === 2);
    expect((await get('/api/patterns')).body.patterns.length).toBeGreaterThanOrEqual(1);
    expect((await del('/api/patterns')).status).toBe(200);
    expect((await get('/api/patterns')).body.patterns).toEqual([]);
  });
});

describe('fix specs from a live tournament (TV3-C12)', () => {
  it('POST /api/specs writes a linted hardening folder for the new qualifying patterns, emits spec_written and moves them to suggested', async () => {
    const { get, post, until, specsDir } = await boot();
    expect((await post('/api/specs')).status).toBe(409);
    await post('/api/tournament/start', { seed: 7, resetLessons: true });
    await until(() => srv!.log.events.some((e) => e.type === 'awaiting_next'));
    const r = await post('/api/specs', { runId: 'live-1' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ runId: 'live-1', path: '.kiro/specs/hardening-live-1', lint: { ok: true, issues: [] } });
    expect(r.body.patterns).toHaveLength(1);
    for (const f of ['requirements.md', 'design.md', 'tasks.md', 'README.md']) expect(existsSync(join(specsDir, 'hardening-live-1', f))).toBe(true);
    const ev = srv!.log.events.find((e) => e.type === 'spec_written')!;
    expect(ev.lane).toBeUndefined();
    expect(ev.detail).toMatchObject({ runId: 'live-1', patterns: r.body.patterns });
    const api = (await get('/api/patterns')).body;
    expect(api.patterns[0].status).toBe('suggested');
    expect(srv!.log.events.filter((e) => e.type === 'pattern' && (e.detail as any).status === 'suggested')).toHaveLength(1);
    expect((await get('/api/specs/hardening-live-1')).body).toMatchObject({ ok: true });
    expect((await get('/api/specs/..%2Fevil')).status).toBe(404);
    // Nothing is left that is new, so asking again says so.
    expect((await post('/api/specs', { runId: 'live-2' })).status).toBe(409);
  });

  it('writes the spec by itself when the tournament ends, and the spec passes lint', async () => {
    const { post, until, specsDir } = await boot();
    await post('/api/tournament/start', { seed: 7, resetLessons: true, rounds: [{ lanes: 5, orders: 6, intensity: 3 }] });
    await until(() => srv!.log.events.some((e) => e.type === 'spec_written'));
    const d = (srv!.log.events.find((e) => e.type === 'spec_written')!.detail as any);
    expect(d.lint.ok).toBe(true);
    expect(existsSync(join(specsDir, 'hardening-' + d.runId, 'README.md'))).toBe(true);
  });
});

describe('improve loop on the live server (TV3-C13)', () => {
  it('POST /api/improve runs the plan, applies the overlay, reruns the same plan and reports closed n of m with a verified pattern', async () => {
    const { get, post, until } = await boot();
    expect((await get('/api/improve')).body).toEqual({ phase: 'idle' });
    expect((await post('/api/improve', { rounds: [{ lanes: 9 }] })).status).toBe(400);
    const start = await post('/api/improve', { seed: 7, rounds: [{ lanes: 5, orders: 6, intensity: 3 }] });
    expect(start.status).toBe(200);
    expect(start.body.improve).toMatch(/^imp-/);
    expect((await post('/api/improve', {})).status).toBe(409);
    for (let i = 0; i < 400; i++) { const j = (await get('/api/improve')).body; if (j.phase === 'done' || j.phase === 'error') break; await new Promise((r) => setTimeout(r, 25)); }
    const job = (await get('/api/improve')).body;
    expect(job.error).toBeUndefined();
    expect(job.phase).toBe('done');
    const r = job.report;
    expect(r.summary).toBe('closed 1 of 1 patterns');
    expect(r.patterns[0]).toMatchObject({ signature: 'payment + endpoint_down + order_lost', status: 'verified', closed: true, before: 1, after: 0 });
    expect(r.overlays[0]).toMatchObject({ lane: 2, tier: 'retrier', action: 'retry_backoff' });
    expect(r.lost).toEqual({ before: 1, after: 0 });
    expect(r.reliability.after).toBeGreaterThan(r.reliability.before);
    expect(r.runs.before).toMatch(/-before$/);
    expect(r.text).toMatch(/closed 1 of 1 patterns/);
    // Two tournaments ran on one server, the second after the first (rule 49 pressed by the loop), and the specs step had nothing that needs code.
    expect(srv!.log.events.filter((e) => e.type === 'tournament_end')).toHaveLength(2);
    expect(r.spec).toBeNull();
    expect((await get('/api/patterns')).body.patterns.find((p: any) => p.signature === 'payment + endpoint_down + order_lost').status).toBe('verified');
    expect(srv!.log.events.some((e) => e.type === 'pattern' && (e.detail as any).status === 'verified')).toBe(true);
    void until;
  });
});

describe('haunt improve (CLI)', () => {
  it('asks a running server, follows the job and prints the report', async () => {
    const { url } = await boot();
    const root = process.cwd();
    const out = await new Promise<{ code: number | null; stdout: string }>((resolve) => {
      const c = spawn(process.execPath, [join(root, 'tools', 'run-ts.mjs'), join(root, 'packages', 'core', 'src', 'bin', 'haunt.ts'), 'improve', '--url', url, '--seed', '7', '--rounds', JSON.stringify([{ lanes: 5, orders: 6, intensity: 3 }])], { cwd: root });
      let stdout = '';
      c.stdout.on('data', (d) => { stdout += d; });
      c.on('close', (code) => resolve({ code, stdout }));
    });
    expect(out.code).toBe(0);
    expect(out.stdout).toMatch(/improve started/);
    expect(out.stdout).toMatch(/# Improve: closed 1 of 1 patterns/);
  }, 60000);

  it('says so when no server answers', async () => {
    const root = process.cwd();
    const code = await new Promise<number | null>((resolve) => {
      const c = spawn(process.execPath, [join(root, 'tools', 'run-ts.mjs'), join(root, 'packages', 'core', 'src', 'bin', 'haunt.ts'), 'improve', '--url', 'http://127.0.0.1:9'], { cwd: root });
      c.on('close', resolve);
    });
    expect(code).toBe(2);
  }, 30000);
});
