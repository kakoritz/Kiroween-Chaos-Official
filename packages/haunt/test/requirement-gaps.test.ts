// covers: haunted-house/R1.2 haunted-house/R1.3 haunted-house/R4.3 haunted-house/R6.2
// Spec: .kiro/specs/test-gaps. The first-draft haunted-house rooms became the fault catalog, so each requirement is checked
// against the mechanism that replaced it (docs/SPEC-MAP.md).
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { POST_ROUTES, Provider, type FaultSpec, type ProviderClock } from '../../core/src/provider';
import { FAULTS } from '../src/chaos/catalog';
import { ProcessKilled, Sdk, type Host, type Transport } from '../src/sdk';
import { Pipeline, generateOrders, tierById } from '../src/pipeline';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const faultOf = (id: string) => FAULTS.find((f) => f.id === id)!;

function clocked() {
  let now = 0;
  const clock: ProviderClock = { now: () => now, sleep: async () => {} };
  return { provider: new Provider({ clock }), advance: (ms: number) => { now += ms; } };
}
const arm = (p: Provider, spec: Record<string, unknown>) => p.handle({ method: 'POST', path: '/_fault', body: spec });
const charge = (p: Provider, lane: string) =>
  p.handle({ method: 'POST', path: '/charges', body: { lane, order: 'o1', amount: 5 }, headers: { 'Idempotency-Key': `${lane}:o1:charge` } });

describe('R1.2 bonus rooms: Poltergeist (clears on retry) and Locked Door (dependency down)', () => {
  it('timeouts and 429s are count-bound provider faults, so a retry clears them', async () => {
    for (const id of ['timeout', 'http_429']) {
      const f = faultOf(id);
      expect(f.kind).toBe('provider');
      expect(f.count).toBeGreaterThan(0);
      expect(f.forMs).toBeUndefined();
    }
    const { provider } = clocked();
    await arm(provider, { lane: 'L1', service: 'charge', mode: 'status', value: 429, count: faultOf('http_429').count });
    const seen: number[] = [];
    for (let i = 0; i < faultOf('http_429').count! + 1; i++) seen.push((await charge(provider, 'L1')).status);
    expect(seen).toEqual([429, 429, 429, 201]);
  });

  it('an outage is a time-window fault: every call fails for the whole window, then the dependency is back', async () => {
    for (const id of ['internet_outage', 'endpoint_down']) {
      const f = faultOf(id);
      expect(f.kind).toBe('provider');
      expect(f.forMs).toBeGreaterThan(0);
      expect(f.count).toBeUndefined();
    }
    const { provider, advance } = clocked();
    const spec: FaultSpec = { lane: 'L1', service: '*', mode: 'drop', forMs: faultOf('endpoint_down').forMs! };
    await arm(provider, spec as unknown as Record<string, unknown>);
    expect((await charge(provider, 'L1')).status).toBe(0);
    advance(faultOf('endpoint_down').forMs! - 1);
    expect((await charge(provider, 'L1')).status).toBe(0);
    advance(2);
    expect((await charge(provider, 'L1')).status).toBe(201);
    expect(provider.ledger('L1').filter((r) => r.kind === 'charge')).toHaveLength(1);
  });
});

const PATHS = Object.fromEntries(Object.entries(POST_ROUTES).map(([p, k]) => [k, p]));

async function crashAtPayment(tierId: string, seed: number) {
  const tier = tierById(tierId);
  const { provider } = clocked();
  const LANE = 'L1';
  const orders = generateOrders(seed, 2);
  const msgs: Record<string, unknown>[] = [];
  let armed = true;
  const host: Host = {
    now: () => 0,
    sleep: async () => {},
    hook: async (point, ctx) => {
      if (armed && point === 'after_effect_before_journal' && ctx.stage === 'payment') {
        armed = false;
        throw new ProcessKilled(point);
      }
    },
    emit: (m) => { msgs.push(m); },
  };
  const transport: Transport = {
    post: async (kind, body, o) => {
      const r = await provider.handle({
        method: 'POST', path: PATHS[kind]!, body,
        headers: { ...(o.key ? { 'Idempotency-Key': o.key } : {}), 'X-Haunt-Phase': o.recovery ? 'recovery' : 'normal' },
      });
      return { status: r.status, body: r.body, headers: r.headers };
    },
    lookup: async (kind, key) => {
      const r = await provider.handle({ method: 'GET', path: '/lookup', query: { lane: LANE, kind, key } });
      return r.body as { found: boolean; row?: Record<string, unknown> };
    },
  };
  const journalPath = join(mkdtempSync(join(tmpdir(), 'haunt-gaps-')), 'lane.journal.jsonl');
  const start = async (): Promise<Pipeline> => {
    const sdk = new Sdk({ tier: tier.id, lane: LANE, use: tier.use, host, transport, journalPath });
    await sdk.start();
    return new Pipeline({
      sdk, tier, seed, lane: LANE,
      readOrder: async (id) => orders.find((o) => o.id === id)!,
      pollTracking: async (shipment) => {
        const r = await provider.handle({ method: 'GET', path: `/tracking/${shipment}`, query: { lane: LANE } });
        return (r.body as { status?: string }).status === 'delivered';
      },
      hook: (point, ctx) => host.hook(point, ctx),
      emit: (m) => host.emit(m),
    });
  };
  const id = orders[0]!.id;
  await expect((await start()).run(id)).rejects.toBeInstanceOf(ProcessKilled);
  const killedAt = msgs.length;
  await (await start()).run(id);
  return { orders, rows: provider.ledger(LANE), afterRestart: msgs.slice(killedAt), id };
}

describe('R1.3 both bots run a room with the same seed', () => {
  it('the same seed gives byte-identical orders, and two tiers process the same order set', async () => {
    expect(generateOrders(7, 3)).toEqual(generateOrders(7, 3));
    expect(generateOrders(7, 3)).not.toEqual(generateOrders(8, 3));
    const a = await crashAtPayment('rookie', 7);
    const b = await crashAtPayment('phoenix', 7);
    expect(a.orders).toEqual(b.orders);
    expect(new Set(a.rows.map((r) => r.order))).toEqual(new Set(b.rows.map((r) => r.order)));
  });
});

describe('R4.3 resume facts behind "resumed from step N, skipped M completed steps, repeated 0 side effects"', () => {
  it('after the crash the restarted Phoenix skips every completed stage, resumes at the crash step, and repeats nothing', async () => {
    const r = await crashAtPayment('phoenix', 7);
    const skipped = r.afterRestart.filter((m) => m.type === 'stage_done' && (m.detail as { skipped?: boolean } | undefined)?.skipped === true);
    const names = skipped.map((m) => m.stage as string);
    expect(names.length).toBeGreaterThan(0);
    expect(names).not.toContain('payment');
    expect(r.afterRestart.find((m) => m.type === 'recover_start')).toMatchObject({ detail: { action: 'replay' } });
    const done = r.afterRestart.filter((m) => m.type === 'stage_done' && !(m.detail as { skipped?: boolean } | undefined)?.skipped).map((m) => m.stage);
    expect(done[0]).toBe('payment');
    const perKind = new Map<string, number>();
    for (const row of r.rows.filter((x) => x.order === r.id && ['account', 'charge', 'email', 'dispatch'].includes(x.kind))) perKind.set(row.kind, (perKind.get(row.kind) ?? 0) + 1);
    expect([...perKind.values()].every((n) => n === 1)).toBe(true);
  });
  it('the Rookie control has no journal to resume from: it replays nothing and repeats the charge', async () => {
    const r = await crashAtPayment('rookie', 7);
    expect(r.afterRestart.some((m) => m.type === 'stage_done' && (m.detail as { skipped?: boolean } | undefined)?.skipped === true)).toBe(false);
    expect(r.rows.filter((x) => x.order === r.id && x.kind === 'charge')).toHaveLength(2);
  });
});

describe('R6.2 CLI: the superseded run/list commands are gone, the replacements exist and are documented', () => {
  const src = readFileSync(join(root, 'packages/core/src/bin/haunt.ts'), 'utf8');
  it('dispatches sweep, stack, ramp, soak, boss and report, and has no run or list command', () => {
    for (const c of ['sweep', 'stack', 'ramp', 'soak', 'boss', 'report']) expect(src, c).toContain(`cmd === '${c}'`);
    expect(src).not.toMatch(/cmd === 'run'|cmd === 'list'/);
    expect(src).toMatch(/usage: npm run haunt -- ramp\|sweep\|stack\|soak\|boss/);
  });
  it('the runtime spec section the requirement points to names the same commands', () => {
    const req = readFileSync(join(root, '.kiro/specs/haunted-house/requirements.md'), 'utf8');
    for (const c of ['haunt sweep', 'haunt stack', 'haunt ramp', 'haunt soak', 'haunt boss', 'haunt report']) expect(req).toContain(c);
  });
});
