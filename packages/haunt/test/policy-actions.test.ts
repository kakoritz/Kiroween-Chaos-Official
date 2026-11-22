// TV3-C9 follow-up: the four policy actions change what the SDK does (not only retry_backoff), and a lesson matches a stage, not one status.
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST_ROUTES, Provider, type FaultSpec, type ProviderClock } from '../../core/src/provider';
import { ENFORCED_ACTIONS, Sdk, backoffRule, isTransient, policyTakes, ruleFor, type Host, type Part, type Policy, type Transport } from '../src/sdk';

const LANE = '2';
const PATHS = Object.fromEntries(Object.entries(POST_ROUTES).map(([p, k]) => [k, p]));
const rule = (action: Policy['rules'][number]['action'], stage = 'payment', fault = 'http_404'): Policy => ({ version: 1, rules: [{ stage, fault, action, ...(action === 'retry_backoff' ? { backoff: 'exp' as const, maxAttempts: 5 } : {}) }] });

class World {
  now = 0;
  readonly provider: Provider;
  readonly msgs: Record<string, unknown>[] = [];
  readonly keys: (string | null)[] = [];
  readonly journalPath = join(mkdtempSync(join(tmpdir(), 'haunt-pol-')), 'lane.journal.jsonl');
  constructor() { this.provider = new Provider({ clock: { now: () => this.now, sleep: async () => {} } as ProviderClock }); }
  host: Host = { now: () => this.now, sleep: async (ms) => { this.now += ms; }, hook: async () => {}, emit: (m) => { this.msgs.push(m); } };
  transport: Transport = {
    post: async (kind, body, o) => {
      this.keys.push(o.key);
      const r = await this.provider.handle({ method: 'POST', path: PATHS[kind]!, body, headers: { ...(o.key ? { 'Idempotency-Key': o.key } : {}), 'X-Haunt-Phase': o.recovery ? 'recovery' : 'normal' } });
      if (r.drop) throw new Error('dropped');
      return { status: r.status, body: r.body, headers: r.headers };
    },
    lookup: async (kind, key) => (await this.provider.handle({ method: 'GET', path: '/lookup', query: { lane: LANE, kind, key } })).body as { found: boolean; row?: Record<string, unknown> },
  };
  fault(spec: Partial<FaultSpec>): void { this.provider.addFault({ lane: LANE, service: 'charge', mode: 'status', value: 503, ...spec } as FaultSpec); }
  sdk(use: Part[], policy?: Policy): Sdk { return new Sdk({ tier: 't', lane: LANE, use, host: this.host, transport: this.transport, journalPath: this.journalPath, ...(policy ? { policy } : {}) }); }
  charges(): number { return this.provider.ledger(LANE).filter((r) => r.kind === 'charge').length; }
  actions(): string[] { return this.msgs.filter((m) => m.type === 'recover_start').map((m) => String((m.detail as { action: string }).action)); }
}

/** One order with a payment stage that sends the charge without a key (the bot did not pass one). */
async function pay(w: World, use: Part[], policy?: Policy) {
  const sdk = w.sdk(use, policy);
  await sdk.start();
  const r = await sdk.order('ord-1', async () => {
    await sdk.stage('payment', async (s) => { await s.effect('charge', { body: { amount: 500 } }); });
  });
  sdk.close();
  return r;
}

describe('policy actions are enforced', () => {
  it('all four are enforced, and only for a tier whose parts allow them', () => {
    expect(ENFORCED_ACTIONS).toEqual(['retry_backoff', 'idempotency_key', 'journal_replay', 'breaker_park']);
    expect(policyTakes(['retry'], 'retry_backoff')).toBe(true);
    expect(policyTakes(['retry'], 'journal_replay')).toBe(false);
    expect(policyTakes(['retry', 'journal'], 'journal_replay')).toBe(true);
    expect(policyTakes(['retry', 'journal'], 'idempotency_key')).toBe(false);
    expect(policyTakes(['retry', 'journal', 'idempotency'], 'idempotency_key')).toBe(true);
    expect(policyTakes(['retry', 'journal', 'idempotency', 'breaker', 'offline_queue'], 'breaker_park')).toBe(true);
    // A breaker bot already backs off on its own.
    expect(policyTakes(['retry', 'journal', 'idempotency', 'breaker', 'offline_queue'], 'retry_backoff')).toBe(false);
  });

  it('a lesson is about the stage: a rule taught by a 404 answers a 429 or a 500 of the same stage, and not another stage or a client error', () => {
    const p = rule('retry_backoff');
    for (const status of [404, 429, 500, 503, 522, 408, null]) expect(backoffRule(p, 'payment', status, 'x')).toBeDefined();
    expect(backoffRule(p, 'payment', 400, 'x')).toBeUndefined();
    expect(backoffRule(p, 'account', 404, 'x')).toBeUndefined();
    expect(isTransient(409)).toBe(false);
    // Without a call (checking a lever up front) a rule matches by stage alone.
    expect(ruleFor(rule('idempotency_key'), 'idempotency_key', 'payment')).toBeDefined();
    expect(ruleFor(rule('idempotency_key'), 'idempotency_key', 'account')).toBeUndefined();
  });

  it('retry_backoff: a 4 s 500 storm loses the order on three plain attempts and is ridden out with the lesson (a different status than the one it learned)', async () => {
    const a = new World(); a.fault({ forMs: 4000, value: 500 });
    expect(await pay(a, ['retry'])).toBe('failed');
    const b = new World(); b.fault({ forMs: 4000, value: 500 });
    expect(await pay(b, ['retry'], rule('retry_backoff'))).toBe('done');
    expect(b.actions()).toContain('backoff');
    expect(b.charges()).toBe(1);
  });

  it('idempotency_key: a bot with the part that sent no key gets one from the lesson; without the lesson, or without the part, the call stays unkeyed', async () => {
    const plain = new World();
    await pay(plain, ['retry', 'journal', 'idempotency']);
    expect(plain.keys).toEqual([null]);
    const learned = new World();
    expect(await pay(learned, ['retry', 'journal', 'idempotency'], rule('idempotency_key'))).toBe('done');
    expect(learned.keys).toEqual(['ord-1:charge']);
    expect(learned.provider.ledger(LANE).find((r) => r.kind === 'charge')!.key).toBe('ord-1:charge');
    const noPart = new World();
    await pay(noPart, ['retry', 'journal'], rule('idempotency_key'));
    expect(noPart.keys).toEqual([null]);
  });

  it('journal_replay: a stage the retries could not beat is replayed from the journal after a cool-down instead of failing the order', async () => {
    const a = new World(); a.fault({ forMs: 5000 });
    expect(await pay(a, ['retry', 'journal'])).toBe('failed');
    const b = new World(); b.fault({ forMs: 5000 });
    expect(await pay(b, ['retry', 'journal'], rule('journal_replay'))).toBe('done');
    expect(b.actions()).toContain('replay');
    expect(b.charges()).toBe(1);
    // A bot without a journal cannot replay.
    const c = new World(); c.fault({ forMs: 5000 });
    expect(await pay(c, ['retry'], rule('journal_replay'))).toBe('failed');
    // Once per order: a storm longer than the cool-down still fails the order the second time.
    const d = new World(); d.fault({ forMs: 60000 });
    expect(await pay(d, ['retry', 'journal'], rule('journal_replay'))).toBe('failed');
    expect(d.actions().filter((x) => x === 'replay')).toHaveLength(1);
  });

  it('breaker_park: the breaker trips after two failed attempts instead of four, so the order parks sooner and the lane stops hammering', async () => {
    const phoenix: Part[] = ['retry', 'journal', 'idempotency', 'breaker', 'offline_queue'];
    const fails = (w: World) => w.msgs.filter((m) => m.type === 'stage_fail').length;
    const a = new World(); a.fault({ forMs: 60000 });
    expect(await pay(a, phoenix)).toBe('parked');
    expect(fails(a)).toBe(4);
    const b = new World(); b.fault({ forMs: 60000 });
    expect(await pay(b, phoenix, rule('breaker_park'))).toBe('parked');
    expect(fails(b)).toBe(2);
    expect(b.msgs.some((m) => m.type === 'breaker' && (m.detail as { state: string }).state === 'open')).toBe(true);
    // Without the offline queue there is nothing to park in: the lesson changes nothing.
    const c = new World(); c.fault({ forMs: 60000 });
    expect(await pay(c, ['retry', 'journal', 'idempotency', 'breaker'], rule('breaker_park'))).toBe('failed');
  });
});
