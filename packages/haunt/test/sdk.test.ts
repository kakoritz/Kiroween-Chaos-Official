import { describe, expect, it } from 'vitest';
import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST_ROUTES, Provider, type FaultSpec, type ProviderClock } from '../../core/src/provider';
import {
  ProcessKilled, Sdk, parseJournal, replay,
  type HookPoint, type Host, type Part, type Transport,
} from '../src/sdk';

const LANE = 'L1';
const PATHS = Object.fromEntries(Object.entries(POST_ROUTES).map(([p, k]) => [k, p]));

class World {
  now = 0;
  readonly provider: Provider;
  readonly msgs: Record<string, unknown>[] = [];
  /** One-shot kill: the next time this hook is reached (optionally for a stage) the process dies. */
  killAt: { point: HookPoint; stage?: string } | null = null;
  readonly dir = mkdtempSync(join(tmpdir(), 'haunt-sdk-'));
  readonly journalPath = join(this.dir, 'lane-1.journal.jsonl');

  constructor() {
    const clock: ProviderClock = { now: () => this.now, sleep: async () => {} };
    this.provider = new Provider({ clock });
  }

  host: Host = {
    now: () => this.now,
    sleep: async (ms) => { this.now += ms; },
    hook: async (point, ctx) => {
      const k = this.killAt;
      if (k && k.point === point && (k.stage === undefined || k.stage === ctx.stage)) {
        this.killAt = null;
        throw new ProcessKilled(point);
      }
    },
    emit: (m) => { this.msgs.push(m); },
  };

  transport: Transport = {
    post: async (kind, body, o) => {
      const r = await this.provider.handle({
        method: 'POST', path: PATHS[kind]!, body,
        headers: { ...(o.key ? { 'Idempotency-Key': o.key } : {}), 'X-Haunt-Phase': o.recovery ? 'recovery' : 'normal' },
      });
      if (r.drop) throw new Error('dropped');
      return { status: r.status, body: r.body, headers: r.headers };
    },
    lookup: async (kind, key) => {
      const r = await this.provider.handle({ method: 'GET', path: '/lookup', query: { lane: LANE, kind, key } });
      return r.body as { found: boolean; row?: Record<string, unknown> };
    },
  };

  fault(spec: Partial<FaultSpec>): void {
    this.provider.addFault({ lane: LANE, service: '*', mode: 'status', ...spec } as FaultSpec);
  }

  sdk(use: Part[]): Sdk {
    return new Sdk({ tier: 't', lane: LANE, use, host: this.host, transport: this.transport, journalPath: this.journalPath });
  }

  count(kind: string): number {
    return this.provider.ledger(LANE).filter((r) => r.kind === kind).length;
  }

  types(): string[] {
    return this.msgs.map((m) => String(m.type ?? m.k));
  }
}

/** One order through intake (work only), account, payment, dispatch. Keys only when the tier uses them. */
async function runOrder(sdk: Sdk, use: Part[], id = 'ord-1') {
  const keyed = use.includes('idempotency');
  return sdk.order(id, async () => {
    await sdk.stage('intake', async (s) => { await s.work(100); });
    await sdk.stage('account', async (s) => { await s.effect('account', { key: keyed ? s.key('account') : undefined, body: { email: 'a@b.c' } }); });
    await sdk.stage('payment', async (s) => { await s.effect('charge', { key: keyed ? s.key('charge') : undefined, body: { amount: 500 } }); });
    await sdk.stage('dispatch', async (s) => { await s.effect('dispatch', { key: keyed ? s.key('dispatch') : undefined }); });
  });
}

/** Run, die at the armed point, restart with a fresh SDK on the same journal, run again. */
async function crashAndRestart(use: Part[], at: { point: HookPoint; stage: string }) {
  const w = new World();
  w.killAt = at;
  const a = w.sdk(use);
  await a.start();
  await expect(runOrder(a, use)).rejects.toBeInstanceOf(ProcessKilled);
  a.close();
  const b = w.sdk(use);
  await b.start();
  const result = await runOrder(b, use);
  b.close();
  return { w, result };
}

const ROOKIE: Part[] = [];
const RETRIER: Part[] = ['retry'];
const JOURNALER: Part[] = ['retry', 'journal'];
const RECONCILER: Part[] = ['retry', 'journal', 'idempotency'];
const PHOENIX: Part[] = ['retry', 'journal', 'idempotency', 'breaker', 'offline_queue'];

describe('crash points (acceptance A1-A4, H1)', () => {
  it('A1 crash at payment before_effect: only the repeated account differs', async () => {
    const r = await crashAndRestart(ROOKIE, { point: 'before_effect', stage: 'payment' });
    expect([r.w.count('account'), r.w.count('charge')]).toEqual([2, 1]);
    for (const tier of [JOURNALER, RECONCILER, PHOENIX]) {
      const j = await crashAndRestart(tier, { point: 'before_effect', stage: 'payment' });
      expect([j.w.count('account'), j.w.count('charge')]).toEqual([1, 1]);
    }
  });

  it('A2 crash at payment after_effect_before_journal: Journaler repeats the charge, Reconciler does not', async () => {
    const rookie = await crashAndRestart(ROOKIE, { point: 'after_effect_before_journal', stage: 'payment' });
    expect([rookie.w.count('account'), rookie.w.count('charge')]).toEqual([2, 2]);
    const journaler = await crashAndRestart(JOURNALER, { point: 'after_effect_before_journal', stage: 'payment' });
    expect([journaler.w.count('account'), journaler.w.count('charge')]).toEqual([1, 2]);
    for (const tier of [RECONCILER, PHOENIX]) {
      const r = await crashAndRestart(tier, { point: 'after_effect_before_journal', stage: 'payment' });
      expect([r.w.count('account'), r.w.count('charge'), r.result]).toEqual([1, 1, 'done']);
      expect(r.w.msgs.some((m) => m.k === 'reconciled' && m.kind === 'charge')).toBe(true);
    }
  });

  it('A3 / H1 crash at after_journal: a result without stage_done counts as done for Journaler', async () => {
    for (const tier of [JOURNALER, RECONCILER, PHOENIX]) {
      const r = await crashAndRestart(tier, { point: 'after_journal', stage: 'payment' });
      expect([r.w.count('account'), r.w.count('charge'), r.result]).toEqual([1, 1, 'done']);
    }
    const rookie = await crashAndRestart(ROOKIE, { point: 'after_journal', stage: 'payment' });
    expect([rookie.w.count('account'), rookie.w.count('charge')]).toEqual([2, 2]);
  });

  it('A4 crash at account after_effect_before_journal: only idempotency saves the account', async () => {
    const journaler = await crashAndRestart(JOURNALER, { point: 'after_effect_before_journal', stage: 'account' });
    expect(journaler.w.count('account')).toBe(2);
    const reconciler = await crashAndRestart(RECONCILER, { point: 'after_effect_before_journal', stage: 'account' });
    expect([reconciler.w.count('account'), reconciler.w.count('charge')]).toEqual([1, 1]);
  });

  it('A5 crash at intake mid_stage repeats nothing for any tier', async () => {
    for (const tier of [ROOKIE, RETRIER, JOURNALER, RECONCILER, PHOENIX]) {
      const r = await crashAndRestart(tier, { point: 'mid_stage', stage: 'intake' });
      expect([r.w.count('account'), r.w.count('charge'), r.w.count('dispatch')]).toEqual([1, 1, 1]);
    }
  });

  it('stage_done is replayed as skipped after a restart, and a duplicate order is skipped', async () => {
    const { w, result } = await crashAndRestart(RECONCILER, { point: 'before_effect', stage: 'payment' });
    expect(result).toBe('done');
    expect(w.msgs.filter((m) => m.type === 'stage_done' && (m.detail as { skipped?: boolean } | undefined)?.skipped).length).toBeGreaterThanOrEqual(2);
    const again = w.sdk(RECONCILER);
    await again.start();
    expect(await runOrder(again, RECONCILER)).toBe('skipped');
    expect(w.msgs.some((m) => m.k === 'duplicate_skipped')).toBe(true);
    expect(w.count('charge')).toBe(1);
  });
});

describe('journal', () => {
  it('P3 replay is idempotent', async () => {
    const w = new World();
    const s = w.sdk(RECONCILER);
    await s.start();
    await runOrder(s, RECONCILER);
    s.close();
    const recs = parseJournal(readFileSync(w.journalPath, 'utf8'));
    expect(recs.length).toBeGreaterThan(10);
    expect(replay([...recs, ...recs])).toEqual(replay(recs));
  });

  it('P4 a torn last line is ignored and never throws', async () => {
    const w = new World();
    const s = w.sdk(JOURNALER);
    await s.start();
    await runOrder(s, JOURNALER);
    s.close();
    const text = readFileSync(w.journalPath, 'utf8');
    for (const cut of [1, 5, 17]) {
      expect(() => parseJournal(text.slice(0, text.length - cut))).not.toThrow();
    }
    appendFileSync(w.journalPath, '{"t":"stage_sta');
    const again = w.sdk(JOURNALER);
    await again.start();
    expect(await runOrder(again, JOURNALER)).toBe('skipped');
  });

  it('records are written in the documented order for one effect stage', async () => {
    const w = new World();
    const s = w.sdk(RECONCILER);
    await s.start();
    await runOrder(s, RECONCILER);
    s.close();
    const recs = parseJournal(readFileSync(w.journalPath, 'utf8')).filter((r) => 'stage' in r && r.stage === 'payment');
    expect(recs.map((r) => r.t)).toEqual(['stage_start', 'intent', 'result', 'stage_done']);
  });

  it('A18 disk_full: one write fails, is retried once and absorbed (journal part only)', async () => {
    const w = new World();
    const s = w.sdk(JOURNALER);
    await s.start();
    expect(s.armDiskFull()).toBe(true);
    expect(await runOrder(s, JOURNALER)).toBe('done');
    expect(w.msgs.some((m) => m.k === 'absorbed')).toBe(true);
    expect(w.count('charge')).toBe(1);
    expect(w.sdk(ROOKIE).armDiskFull()).toBe(false);
  });
});

describe('retry and breaker', () => {
  it('A10 two 404s at payment: Rookie fails, Retrier completes with one charge', async () => {
    const rookieW = new World();
    rookieW.fault({ service: 'charge', value: 404, count: 2 });
    const rs = rookieW.sdk(ROOKIE);
    await rs.start();
    expect(await runOrder(rs, ROOKIE)).toBe('failed');

    const w = new World();
    w.fault({ service: 'charge', value: 404, count: 2 });
    const s = w.sdk(RETRIER);
    await s.start();
    expect(await runOrder(s, RETRIER)).toBe('done');
    expect(w.count('charge')).toBe(1);
    expect(w.now).toBeGreaterThanOrEqual(1000 + 100);
  });

  it('retry gives up after 3 attempts', async () => {
    const w = new World();
    w.fault({ service: 'charge', value: 500, count: 3 });
    const s = w.sdk(RETRIER);
    await s.start();
    expect(await runOrder(s, RETRIER)).toBe('failed');
    expect(w.msgs.filter((m) => m.type === 'stage_fail')).toHaveLength(3);
  });

  it('A12 three 429s with Retry-After 2: Phoenix completes on attempt 4, Reconciler fails', async () => {
    const w = new World();
    w.fault({ service: 'charge', value: 429, count: 3, headers: { 'Retry-After': '2' } });
    const s = w.sdk(PHOENIX);
    await s.start();
    expect(await runOrder(s, PHOENIX)).toBe('done');
    expect(w.count('charge')).toBe(1);
    expect(w.now).toBeGreaterThanOrEqual(6000);

    const rw = new World();
    rw.fault({ service: 'charge', value: 429, count: 3, headers: { 'Retry-After': '2' } });
    const rs = rw.sdk(RECONCILER);
    await rs.start();
    expect(await runOrder(rs, RECONCILER)).toBe('failed');
  });

  it('A14 sustained outage: the breaker opens after 4 failures, the order parks, a probe later resumes it', async () => {
    const w = new World();
    w.fault({ service: 'charge', value: 503, count: 4 });
    const s = w.sdk(PHOENIX);
    await s.start();
    expect(await runOrder(s, PHOENIX)).toBe('parked');
    expect(w.msgs.filter((m) => m.type === 'stage_fail')).toHaveLength(4);
    expect(s.breakerOpenUntil('charge')).not.toBeNull();
    expect(w.count('charge')).toBe(0);
    // While open, the next attempt does not call the provider.
    expect(await runOrder(s, PHOENIX)).toBe('parked');
    // Parking on an open breaker is still a stage_fail followed by order_parked{stage} (PROTOCOL.md rule 3), with no provider call behind it.
    const fails = w.msgs.filter((m) => m.type === 'stage_fail');
    expect(fails).toHaveLength(5);
    expect(fails[4]).toMatchObject({ stage: 'payment', detail: { error: 'breaker_open' } });
    const parks = w.msgs.filter((m) => m.type === 'order_parked');
    expect(parks.map((m) => m.detail)).toEqual([{ stage: 'payment', reason: 'breaker_open' }, { stage: 'payment', reason: 'breaker_open' }]);
    expect(w.count('charge')).toBe(0);
    w.now += 5000;
    expect(await runOrder(s, PHOENIX)).toBe('done');
    expect([w.count('account'), w.count('charge'), w.count('dispatch')]).toEqual([1, 1, 1]);
  });

  it('parts() reports the parts the bot used, including idempotency from key presence', async () => {
    const w = new World();
    const s = w.sdk(JOURNALER);
    await s.start();
    expect(s.parts()).toEqual(['retry', 'journal']);
    await s.order('o', async () => {
      await s.stage('payment', async (c) => { await c.effect('charge', { key: c.key('charge'), body: { amount: 1 } }); });
    });
    expect(s.parts()).toEqual(['retry', 'journal', 'idempotency']);
  });
});
