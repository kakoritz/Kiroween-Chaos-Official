// In-process campaign night (CP-C2): runs lane 1 of a night with the Crew's parts and no child processes.
// The same pieces as the live runtime: the night's plan through `DemoPlayer`, the `RunnerEngine` chaos director, the
// provider's fault bodies, the SDK and pipeline, the repeat detector and the score engine. Time is a virtual clock, so a
// night takes milliseconds and the same gear gives the same lane 1 score. Rivals are not simulated (they are fixed tiers).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Provider, POST_ROUTES, type ProviderClock } from '../provider';
import { DemoPlayer } from '../live/runtime';
import type { DemoScript } from '../live/demo';
import { RunnerEngine } from '../../../haunt/src/runner/engine';
import { RepeatDetector, postProviderArm } from '../../../haunt/src/runner/provider';
import { ScoreEngine, type HauntEvent } from '../../../haunt/src/score/score';
import { ParkSignal, ProcessKilled, Sdk, type Host, type Part, type Transport } from '../../../haunt/src/sdk';
import { InputError, LaneHalted, Pipeline, generateOrders, orderId, tierById } from '../../../haunt/src/pipeline';
import { campaignWaveConfig } from '../../../haunt/src/campaign/wave-config';
import type { CampaignNight, LaneSummary } from '../../../haunt/src/campaign/types';
import type { LedgerRow } from '../provider';

const LANE = '1';
const CLIENT_TIMEOUT_MS = 1500;
const PATHS = Object.fromEntries(Object.entries(POST_ROUTES).map(([p, k]) => [k, p]));
const MAX_RUNS = 12;

export interface NightRun {
  /** Lane 1 summary in the shape the medal rule reads. `stars` and `downtimeMs` are play-test v2 fields and stay unset here. */
  summary: LaneSummary;
  /** Every lane 1 event the night produced, in order, with the repeat and chaos events the runtime adds. */
  events: HauntEvent[];
  /** Provider ledger rows of lane 1. */
  ledger: LedgerRow[];
  /** Per order result: `done`, `failed`, `parked`, `quarantined`, `skipped`, or `halted`. */
  results: Record<string, string>;
  /** Virtual ms the night took. */
  elapsedMs: number;
}

/** Plays a night for lane 1 with the given parts. Deterministic: same night and parts give the same `summary`. */
export async function simulateNight(night: CampaignNight, parts: readonly Part[]): Promise<NightRun> {
  const cfg = campaignWaveConfig(night, parts);
  const dir = mkdtempSync(join(tmpdir(), 'haunt-night-'));
  try {
    return await run(night, cfg.crew.parts as Part[], cfg.scripts as DemoScript[], dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function run(night: CampaignNight, parts: Part[], scripts: DemoScript[], dir: string): Promise<NightRun> {
  let now = 0;
  const clock: ProviderClock = { now: () => now, sleep: async (ms) => { now += ms; } };
  const provider = new Provider({ clock });
  const tier = { ...tierById('crew'), use: parts };
  const orders = generateOrders(String(night.seed), night.orders);
  const events: HauntEvent[] = [];
  const score = new ScoreEngine();
  const repeats = new RepeatDetector();
  const results: Record<string, string> = {};
  let ledgerSeen = 0;
  let current = '';
  let stage: string | null = null;

  const feed = (ev: HauntEvent): void => {
    events.push(ev);
    score.feed(ev);
    for (const p of players) p.observe(ev as never);
    players.forEach((p) => p.step(now - t0));
  };
  // Ledger rows become `repeat` events, before the event that follows them (the runtime does the same).
  const syncLedger = (): void => {
    const rows = provider.ledger(LANE);
    for (; ledgerSeen < rows.length; ledgerSeen++) {
      const row = rows[ledgerSeen]!;
      const r = repeats.add(row);
      if (r) feed({ type: 'repeat', lane: LANE, order: row.order, detail: { kind: row.kind, key: r.key, count: r.count } });
    }
  };
  const record = (ev: HauntEvent): void => {
    // Chaos events carry the order they hit, as the runtime's normalizer does, so the score can pay "survived attack".
    feed(ev.type === 'chaos' ? { ...ev, lane: LANE, order: current || undefined } : ev);
  };

  const engine = new RunnerEngine({
    post: async (body) => { provider.addFault(body); },
    laneInfo: () => ({ state: 'working', stage }),
  });
  const t0 = 0;
  let players: DemoPlayer[] = [];
  engine.startWave(1, { orders: night.orders, seed: night.seed, tiers: 'race', lanes: 1 + night.rivals.length, speed: 1, pace: night.pace, app: night.app ?? 'orders', campaign: { night: night.id, parts } }, record);
  players = scripts.map((s) => new DemoPlayer(engine, record, s, 1));

  const host: Host = {
    now: () => now,
    sleep: async (ms) => {
      for (let left = ms; left > 0; left -= 100) {
        now += Math.min(100, left);
        players.forEach((p) => p.step(now - t0));
      }
    },
    hook: async (point) => {
      const fired = engine.director.onAtPoint(LANE, point);
      if (!fired) return;
      engine.director.processUp(LANE);
      now += fired.restartMs;
      throw new ProcessKilled(point);
    },
    emit: (msg) => {
      if (typeof msg.type !== 'string') return;
      const ev = { ...msg, lane: LANE } as unknown as HauntEvent;
      if (ev.type === 'stage_start') {
        stage = ev.stage ?? null;
        for (const arm of engine.director.onStageStart(LANE, ev.stage ?? '')) void postProviderArm(async (b) => { provider.addFault(b); }, LANE, ev.stage ?? null, arm);
      }
      syncLedger();
      if (ev.type === 'stage_done' || ev.type === 'order_done' || ev.type === 'order_failed' || ev.type === 'order_parked') stage = null;
      feed(ev);
    },
  };

  const transport: Transport = {
    post: async (kind, body, o) => {
      const t = now;
      const r = await provider.handle({
        method: 'POST', path: PATHS[kind]!, body,
        headers: { ...(o.key ? { 'Idempotency-Key': o.key } : {}), 'X-Haunt-Phase': o.recovery ? 'recovery' : 'normal' },
      });
      if (r.drop) throw new Error('dropped');
      if (now - t > CLIENT_TIMEOUT_MS) { now = t + CLIENT_TIMEOUT_MS; throw new Error('client timeout'); }
      return { status: r.status, body: r.body, headers: r.headers };
    },
    lookup: async (kind, key) => {
      const r = await provider.handle({ method: 'GET', path: '/lookup', query: { lane: LANE, kind, key } });
      return r.body as { found: boolean; row?: Record<string, unknown> };
    },
  };

  /** One transit poll with the retry and backoff rules of the bot runtime (runtime.md section 7). */
  const poll = async (shipment: string): Promise<boolean> => {
    const breaker = parts.includes('breaker');
    const max = breaker ? 5 : parts.includes('retry') ? 3 : 1;
    for (let n = 1; ; n++) {
      let failure = '';
      try {
        const t = now;
        const r = await provider.handle({ method: 'GET', path: `/tracking/${shipment}`, query: { lane: LANE } });
        if (now - t > 800) { now = t + 800; throw new Error('poll timeout'); }
        const status = (r.body as { status?: string }).status;
        if (status === 'delivered') return true;
        if (status === 'in_transit' && !(r.body as { reroute?: boolean }).reroute) return false;
        failure = String(status);
      } catch (e) {
        failure = e instanceof Error ? e.message : String(e);
      }
      if (n >= max) {
        // Same as the bot runtime: a Phoenix-class bot parks the order when its transit polls are exhausted.
        if (breaker && parts.includes('offline_queue')) throw new ParkSignal('breaker_open');
        throw new Error(`transit failed: ${failure}`);
      }
      await host.sleep(breaker ? 500 * 2 ** (n - 1) : 500);
    }
  };

  const journalPath = join(dir, 'lane-1.journal.jsonl');
  const readOrder = async (id: string) => {
    const o = orders.find((x) => x.id === id);
    if (!o) throw new InputError('missing', `no order ${id}`);
    return o;
  };

  for (let i = 1; i <= night.orders; i++) {
    const id = orderId(i);
    current = id;
    let last = 'failed';
    let parked = false;
    for (let attempt = 0; attempt < MAX_RUNS; attempt++) {
      const sdk = new Sdk({ tier: tier.id, lane: LANE, use: parts, host, transport, journalPath });
      await sdk.start();
      const pipeline = new Pipeline({
        sdk, tier, seed: String(night.seed), lane: LANE, readOrder, pollTracking: poll,
        hook: (point, ctx) => host.hook(point, ctx), emit: (m) => host.emit(m),
      });
      try {
        last = await pipeline.run(id);
      } catch (e) {
        if (e instanceof ProcessKilled) { last = 'failed'; continue; }
        if (e instanceof LaneHalted) { last = 'halted'; feed({ type: 'lane_halted', lane: LANE, detail: { reason: e.message } }); break; }
        throw e;
      }
      if (last === 'parked') {
        parked = true;
        now += 6000;
        feed({ type: 'order_resumed', lane: LANE, order: id });
        continue;
      }
      break;
    }
    syncLedger();
    engine.director.orderEnd(LANE);
    results[id] = parked && last === 'done' ? 'done' : last;
    if (last === 'halted') break;
  }
  syncLedger();
  for (const p of players) p.stop();

  const c = score.lane(LANE);
  const summary: LaneSummary = {
    score: score.totals.get(LANE) ?? 0,
    repeats: c.repeats,
    orders: { done: c.completed, cancelled: c.failed, parked: c.parked, quarantined: c.quarantined, abandoned: c.abandoned },
  };
  return { summary, events, ledger: provider.ledger(LANE), results, elapsedMs: now };
}
