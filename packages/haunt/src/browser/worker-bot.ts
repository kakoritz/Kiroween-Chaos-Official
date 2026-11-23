// Full Pipeline + ChaosHost bot for the browser target (H6.3 / E12). Runs in a Web Worker: the same eight-stage
// Pipeline and kill-rendezvous ChaosHost as the node bot runtime, over the page-owned journal and ledger.
// Orders are generated in memory from the seed. No node imports (must bundle for the browser).
import { ChaosHost } from '../chaos/hooks';
import { LaneHalted, Pipeline, STAGES, generateOrders, tierById, type OrderData, type TierDef } from '../pipeline';
import { PARTS, Sdk, type Part } from '../sdk/sdk';
import type { PageToWorker } from './worker-host';
import { BrowserClock, PageChannel, PageJournalStore, PageTransport, type WorkerScopeLike } from './worker-sdk';

export interface PipelineBotDef {
  tier: TierDef['id'];
  use: readonly Part[];
  /** Defaults when the page's `init` does not carry them. */
  seed?: string | number;
  orders?: number;
}

const SERVICES = ['account', 'order', 'charge', 'email', 'store', 'dispatch', 'notify', 'tracking'];

/** Wire a full pipeline bot into a worker scope. On `init` it builds Sdk, ChaosHost and Pipeline and runs every order. */
export function connectPipelineBot(scope: WorkerScopeLike, def: PipelineBotDef, clock: BrowserClock = new BrowserClock()): PageChannel {
  const ch = new PageChannel(scope);
  const use = PARTS.filter((p) => def.use.includes(p));
  const hasPart = (p: Part) => use.includes(p);
  let host: ChaosHost | null = null;
  scope.onmessage = (ev) => {
    const m = ev.data as PageToWorker;
    if (ch.handle(m)) return;
    if (m.k === 'control') {
      const c = m.msg;
      if (c.k === 'speed' && typeof c.speed === 'number') clock.setSpeed(c.speed);
      else host?.control(c);
      return;
    }
    if (m.k !== 'init' || host) return;
    void run(m).catch((e) => ch.post({ k: 'event', msg: { k: 'bot_error', reason: e instanceof Error ? e.message : String(e) } }));
  };

  async function run(m: Extract<PageToWorker, { k: 'init' }>): Promise<void> {
    if (m.speed && m.speed > 0) clock.setSpeed(m.speed);
    const seed = m.seed ?? def.seed ?? 1;
    const lane = m.lane;
    const tier: TierDef = { ...tierById(def.tier), use };
    const settled = new Set(m.settled ?? []);

    let cur: { order: string; stage: string; at: number } | null = null;
    let lastParkReason = 'breaker_open';
    const send = (msg: Record<string, unknown>) => {
      if (msg.type === 'progress') msg = { ...msg, type: 'stage_progress' };
      if (msg.type === 'stage_start') cur = { order: String(msg.order), stage: String(msg.stage), at: clock.now() };
      else if (msg.type === 'stage_done' || msg.type === 'order_done' || msg.type === 'order_failed' || msg.type === 'order_parked') cur = null;
      if (msg.type === 'order_parked') lastParkReason = String((msg.detail as { reason?: string } | undefined)?.reason ?? 'breaker_open');
      ch.post({ k: 'event', msg });
    };
    const heartbeat = setInterval(() => {
      if (!cur) return;
      const sd = STAGES.find((s) => s.id === cur!.stage);
      const pct = Math.min(95, Math.floor(((clock.now() - cur.at) / (sd?.max ?? 1000)) * 100));
      send({ type: 'stage_progress', order: cur.order, stage: cur.stage, detail: { pct, label: sd?.label ?? cur.stage } });
    }, 300);

    // The kill rendezvous: an armed crash sends `at_point` and blocks, the page ends this worker.
    const chaos = new ChaosHost({ parts: use, now: clock.now, sleep: clock.sleep, send, mode: 'child' });
    host = chaos;
    for (const a of m.arms ?? []) chaos.control({ k: 'arm', ...a });
    const hostIf = {
      now: clock.now,
      sleep: clock.sleep,
      emit: (msg: Record<string, unknown>) => chaos.emit(msg),
      async hook(point: Parameters<ChaosHost['hook']>[0], ctx: { order?: string; stage?: string }) {
        await chaos.hook(point, ctx);
        // The page may terminate this worker while it answers; this await then never resumes.
        await ch.call({ k: 'hook', point, order: ctx.order, stage: ctx.stage });
      },
    };
    const sdk = new Sdk({
      tier: def.tier, lane, use, host: hostIf,
      transport: new PageTransport(ch, clock.sleep),
      journalStore: new PageJournalStore(ch),
      initialRecords: m.replay,
      pid: m.generation,
    });
    chaos.bind(sdk);

    const orders = new Map<string, OrderData>(generateOrders(seed, m.orders ?? def.orders ?? 6).map((o) => [o.id, o]));
    let curOrder = '';

    // Transit polls sit outside sdk.effect, so they get the same retry / backoff rules here (runtime.md section 7).
    const polls = new Map<string, number>();
    const pollTracking = async (shipment: string): Promise<boolean> => {
      await clock.sleep(300);
      const max = hasPart('breaker') ? 5 : hasPart('retry') ? 3 : 1;
      for (let n = 1; ; n++) {
        let failure = '';
        try {
          const r = await ch.call({ k: 'track' });
          const fault = (r.body as { fault?: { mode: string; value: number } } | undefined)?.fault;
          if (fault?.mode === 'drop') throw new Error('connection dropped');
          if (fault?.mode === 'status') failure = `status ${fault.value}`;
          else {
            if (fault?.mode === 'latency') await clock.sleep(fault.value);
            const seen = (polls.get(shipment) ?? 0) + 1;
            polls.set(shipment, seen);
            return seen >= 2; // in transit on the first poll, delivered on the second
          }
        } catch (e) {
          failure = e instanceof Error ? e.message : String(e);
        }
        send({ type: 'stage_fail', order: curOrder, stage: 'transit', detail: { attempt: n, reason: failure } });
        if (n >= max) throw new Error(`tracking failed: ${failure}`);
        const action = hasPart('breaker') ? 'backoff' : 'retry';
        send({ type: 'recover_start', order: curOrder, stage: 'transit', detail: { action, attempt: n } });
        await hostIf.hook('during_backoff', { order: curOrder, stage: 'transit' });
        await clock.sleep(hasPart('breaker') ? 500 * 2 ** (n - 1) : 500);
        send({ type: 'recover_done', order: curOrder, stage: 'transit', detail: { action, attempt: n } });
      }
    };

    const pipeline = new Pipeline({
      sdk, tier, seed, lane, speed: 1, attempt: m.generation,
      readOrder: async () => orders.get(curOrder)!,
      pollTracking,
      emit: send,
      hook: (point, ctx) => hostIf.hook(point, ctx),
    });

    await sdk.start();

    const queue = [...orders.keys()].filter((id) => !settled.has(id));
    const parked = new Map<string, string>();
    const breakersClear = () => SERVICES.every((s) => (sdk.breakerOpenUntil(s) ?? 0) <= clock.now());
    let halted = false;
    for (;;) {
      let id = queue.shift();
      if (!id) {
        if (!hasPart('offline_queue') || parked.size === 0) break;
        const ready = [...parked].filter(([, why]) => why === 'missing_file' || breakersClear()).map(([k]) => k).sort();
        if (ready.length === 0) {
          await clock.sleep(1000);
          continue;
        }
        for (const r of ready) {
          parked.delete(r);
          send({ type: 'order_resumed', order: r });
          queue.push(r);
        }
        id = queue.shift()!;
      }
      curOrder = id;
      let result;
      try {
        result = await pipeline.run(id);
      } catch (e) {
        if (e instanceof LaneHalted) {
          send({ type: 'lane_halted', detail: { reason: e.message } });
          halted = true;
          break;
        }
        throw e;
      }
      if (result === 'parked') parked.set(id, lastParkReason);
    }
    clearInterval(heartbeat);
    if (!halted) send({ k: 'idle' });
    sdk.close();
    ch.post({ k: 'event', msg: { k: 'bot_idle', generation: m.generation } });
  }
  return ch;
}
