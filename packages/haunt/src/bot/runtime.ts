// Bot runtime: turns a bot definition into a real child process that speaks the runner protocol.
// Spec: .kiro/specs/engine/runtime.md sections 1, 2, 5, 19, 20, 28, 29, 32.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { ChaosHost } from '../chaos';
import { InputError, LaneHalted, Pipeline, STAGES, tierById, type OrderData, type TierDef } from '../pipeline';
import { PARTS, ParkSignal, Sdk, type Part, type Transport } from '../sdk';

export interface BotDef {
  tier: TierDef['id'];
  use: readonly Part[];
}

/**
 * Declares a bot. The parts in `use` are the bot's resilience code: add `retry`, `journal`, `idempotency`
 * and the keys flow through every effect call. When the bundle is the process entry (the runner sets
 * `HAUNT_TIER`, or `--parts` is passed) it starts running; importing it in a test does nothing.
 */
export function defineBot(def: BotDef): BotDef {
  const frozen: BotDef = { tier: def.tier, use: PARTS.filter((p) => def.use.includes(p)) };
  if (process.argv.includes('--parts') || process.env.HAUNT_TIER !== undefined) {
    runBot(frozen).catch((e) => {
      process.stderr.write(`bot ${def.tier} crashed: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
      process.exit(1);
    });
  }
  return frozen;
}

const PATHS: Record<string, string> = {
  account: '/accounts', charge: '/charges', email: '/emails', dispatch: '/shipments',
  notify: '/notifications', ticket: '/tickets', reply: '/replies',
};
const ORDER_FILE = /^ord-(\d{4})(\.dup)?\.json$/;
const SERVICES = ['account', 'charge', 'email', 'dispatch', 'notify', 'tracking'];

/** Orders in the folder, runtime.md section 20: by order number, original before `.dup`. */
export function listOrders(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => ORDER_FILE.test(f))
    .sort((a, b) => {
      const ma = ORDER_FILE.exec(a)!;
      const mb = ORDER_FILE.exec(b)!;
      return Number(ma[1]) - Number(mb[1]) || (ma[2] ? 1 : 0) - (mb[2] ? 1 : 0);
    });
}

export function orderIdOf(file: string): string {
  return file.replace(/(\.dup)?\.json$/, '');
}

function isOrderData(v: unknown): v is OrderData {
  const o = v as OrderData | null;
  return !!o && typeof o.id === 'string' && typeof o.email === 'string' && Array.isArray(o.items) && typeof o.total === 'number';
}

export async function runBot(def: BotDef): Promise<void> {
  if (process.argv.includes('--parts')) {
    process.stdout.write(`${JSON.stringify({ parts: def.use })}\n`);
    return;
  }
  const env = process.env;
  const lane = String(env.HAUNT_LANE ?? '1');
  const seed = env.HAUNT_SEED ?? '1';
  const provider = env.HAUNT_PROVIDER ?? 'http://127.0.0.1:7071';
  const ordersDir = env.HAUNT_ORDERS_DIR;
  if (!ordersDir) throw new Error('HAUNT_ORDERS_DIR is not set');
  const laneRoot = join(ordersDir, '..');
  const dirs = {
    orders: ordersDir, done: join(laneRoot, 'done'), failed: join(laneRoot, 'failed'),
    parked: join(laneRoot, 'parked'), quarantine: join(laneRoot, 'quarantine'),
  };
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
  const runDir = env.HAUNT_RUN_DIR ?? join(tmpdir(), 'haunt', 'standalone');
  const scratch = join(runDir, `lane-${lane}`);
  mkdirSync(scratch, { recursive: true });
  const attempt = Number(env.HAUNT_ATTEMPT ?? '1') || 1;
  const workScale = Number(env.HAUNT_WORKSCALE ?? '1') || 1;
  let speed = Number(env.HAUNT_SPEED ?? '1') || 1;

  // Virtual 1x clock: sleeps shorten and `now()` runs faster as speed rises, so every ms constant in the SDK scales.
  let anchorReal = Date.now();
  let anchorVirtual = anchorReal;
  const now = () => anchorVirtual + (Date.now() - anchorReal) * speed;
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms / speed)));
  const realMs = (ms: number) => Math.max(1, ms / speed);

  const use = def.use;
  const tier: TierDef = { ...tierById(def.tier), use };
  const hasPart = (p: Part) => use.includes(p);

  // ---- stdout channel, with event bookkeeping for the progress heartbeat and park reasons ----
  let cur: { order: string; stage: string; at: number } | null = null;
  let lastParkReason = 'breaker_open';
  const send = (m: Record<string, unknown>) => {
    if (m.type === 'progress') m = { ...m, type: 'stage_progress' };
    if (m.type === 'stage_start') cur = { order: String(m.order), stage: String(m.stage), at: now() };
    else if (m.type === 'stage_done' || m.type === 'order_done' || m.type === 'order_failed' || m.type === 'order_parked') cur = null;
    if (m.type === 'order_parked') lastParkReason = String((m.detail as { reason?: string } | undefined)?.reason ?? 'breaker_open');
    process.stdout.write(`${JSON.stringify(m)}\n`);
  };
  const heartbeat = setInterval(() => {
    if (!cur) return;
    const def_ = STAGES.find((s) => s.id === cur!.stage);
    const pct = Math.min(95, Math.floor(((now() - cur.at) / (def_?.max ?? 1000)) * 100));
    send({ type: 'stage_progress', order: cur.order, stage: cur.stage, detail: { pct, label: def_?.label ?? cur.stage } });
  }, Math.max(40, 300 / speed));
  heartbeat.unref();

  // ---- stdin channel ----
  const host = new ChaosHost({ parts: use, now, sleep, send, mode: 'child' });
  let stdinClosed = false;
  let onGo: (() => void) | null = null;
  let onProceed: (() => void) | null = null;
  let onShutdown: (() => void) | null = null;
  const rl = createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (m.k === 'speed' && typeof m.speed === 'number' && m.speed > 0) {
      anchorVirtual = now();
      anchorReal = Date.now();
      speed = m.speed;
    } else if (m.k === 'proceed') onProceed?.();
    else if (m.k === 'shutdown') onShutdown?.();
    else host.control(m);
    if (m.k === 'go') onGo?.();
  });
  rl.on('close', () => {
    stdinClosed = true;
    onShutdown?.();
  });
  const waitFor = (set: (f: () => void) => void, ms: number) =>
    new Promise<void>((res) => {
      const t = setTimeout(res, realMs(ms));
      set(() => {
        clearTimeout(t);
        res();
      });
    });

  // ---- provider transport ----
  const call = async (path: string, init: RequestInit, timeoutMs: number) => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), realMs(timeoutMs));
    try {
      const res = await fetch(`${provider}${path}`, { ...init, signal: ac.signal });
      const text = await res.text();
      let body: unknown = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch { /* non-JSON error page */ }
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => { headers[k] = v; });
      return { status: res.status, body, headers };
    } finally {
      clearTimeout(t);
    }
  };
  const transport: Transport = {
    async post(kind, body, o) {
      const path = PATHS[kind];
      if (!path) throw new Error(`unknown effect kind ${kind}`);
      const payload = kind === 'email' && body.template === undefined ? { ...body, template: 'confirmation' } : body;
      const headers: Record<string, string> = { 'content-type': 'application/json', 'x-haunt-phase': o.recovery ? 'recovery' : 'normal' };
      if (o.key !== null) headers['idempotency-key'] = o.key;
      return call(path, { method: 'POST', headers, body: JSON.stringify(payload) }, 1500);
    },
    async lookup(kind, key) {
      const q = `lane=${encodeURIComponent(lane)}&kind=${encodeURIComponent(kind)}&key=${encodeURIComponent(key)}`;
      const r = await call(`/lookup?${q}`, { method: 'GET', headers: { 'x-haunt-phase': 'recovery' } }, 1500);
      if (r.status !== 200) throw new Error(`lookup returned ${r.status}`);
      return r.body as { found: boolean; row?: Record<string, unknown> };
    },
  };

  const sdk = new Sdk({ tier: def.tier, lane, use, host, transport, journalPath: join(scratch, 'journal.jsonl') });
  host.bind(sdk);

  // ---- input handling ----
  let currentFile = '';
  const readOrder = async (): Promise<OrderData> => {
    let text: string;
    try {
      text = readFileSync(join(dirs.orders, currentFile), 'utf8');
    } catch (e) {
      throw new InputError('missing', `cannot read ${currentFile}: ${(e as NodeJS.ErrnoException).code ?? 'error'}`);
    }
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      throw new InputError('malformed', `${currentFile} is not valid JSON`);
    }
    if (!isOrderData(v)) throw new InputError('malformed', `${currentFile} is not an order`);
    return v;
  };

  // Tracking polls sit outside sdk.effect, so they get the same retry / backoff rules here (runtime.md section 7).
  const pollTracking = async (shipment: string): Promise<boolean> => {
    await sleep(300);
    const max = hasPart('breaker') ? 5 : hasPart('retry') ? 3 : 1;
    for (let n = 1; ; n++) {
      let failure: string;
      try {
        const r = await call(`/tracking/${encodeURIComponent(shipment)}?lane=${encodeURIComponent(lane)}`, { method: 'GET' }, 800);
        const b = r.body as { status?: string };
        if (r.status === 200 && b.status === 'delivered') { if (hasPart('breaker')) sdk.noteSuccess('tracking'); return true; }
        if (r.status === 200 && b.status === 'in_transit') { if (hasPart('breaker')) sdk.noteSuccess('tracking'); return false; }
        failure = r.status === 200 ? String(b.status ?? 'unexpected') : `status ${r.status}`;
      } catch (e) {
        failure = e instanceof Error ? e.message : String(e);
      }
      send({ type: 'stage_fail', order: curOrder, stage: 'tracking', detail: { attempt: n, reason: failure } });
      if (hasPart('breaker')) sdk.noteFailure('tracking');
      if (n >= max) {
        // An exhausted breaker bot with an offline queue parks the order and resumes it when the breaker closes.
        if (hasPart('breaker') && hasPart('offline_queue')) throw new ParkSignal('breaker_open');
        throw new Error(`tracking failed: ${failure}`);
      }
      const action = hasPart('breaker') ? 'backoff' : 'retry';
      send({ type: 'recover_start', order: curOrder, stage: 'tracking', detail: { action, attempt: n } });
      await host.hook('during_backoff', { order: curOrder, stage: 'tracking' });
      await sleep(hasPart('breaker') ? 500 * 2 ** (n - 1) : 500);
      send({ type: 'recover_done', order: curOrder, stage: 'tracking', detail: { action, attempt: n } });
    }
  };

  let curOrder = '';
  const pipeline = new Pipeline({
    sdk, tier, seed, lane, speed: 1 / workScale, attempt,
    readOrder: () => readOrder(),
    pollTracking,
    emit: send,
    async hook(point, ctx) {
      await host.hook(point, ctx);
      send({ k: 'at_point', point, ...ctx });
      await waitFor((f) => { onProceed = f; }, 2000);
      onProceed = null;
    },
  });

  // ---- start: ready, wait for `go`, then startup hook and hello ----
  send({ k: 'ready' });
  await waitFor((f) => { onGo = f; }, 2000);
  await sdk.start();

  const move = (file: string, to: keyof typeof dirs) => {
    const from = join(dirs.orders, file);
    if (!existsSync(from)) return; // renamed to .haunted by missing_file: the runner restores it where it belongs
    renameSync(from, join(dirs[to], file));
  };

  // Parked orders: id -> why. Files in parked/ from a previous process life resume on the breaker rule.
  const parked = new Map<string, string>();
  const breakersClear = () => SERVICES.every((s) => (sdk.breakerOpenUntil(s) ?? 0) <= now());
  const resumeParked = (): boolean => {
    if (!hasPart('offline_queue')) return false;
    let resumed = false;
    for (const f of readdirSync(dirs.parked).filter((x) => ORDER_FILE.test(x)).sort()) {
      const id = orderIdOf(f);
      const reason = parked.get(id) ?? 'breaker_open';
      const ready = reason === 'missing_file' ? true : breakersClear();
      if (!ready) continue;
      renameSync(join(dirs.parked, f), join(dirs.orders, f));
      parked.delete(id);
      send({ type: 'order_resumed', order: id });
      resumed = true;
    }
    return resumed;
  };
  const parkedPending = () => hasPart('offline_queue') && (parked.size > 0 || readdirSync(dirs.parked).some((x) => ORDER_FILE.test(x)));

  let halted = false;
  for (;;) {
    const files = listOrders(dirs.orders);
    const file = files[0];
    if (!file) {
      if (resumeParked()) continue;
      if (parkedPending()) {
        await sleep(1000);
        continue;
      }
      break;
    }
    currentFile = file;
    curOrder = orderIdOf(file);
    parked.delete(curOrder); // restored straight into orders/ (missing_file): it runs again, so it is no longer waiting
    let result;
    try {
      result = await pipeline.run(curOrder);
    } catch (e) {
      if (e instanceof LaneHalted) {
        send({ type: 'lane_halted', detail: { reason: e.message } });
        halted = true;
        break;
      }
      throw e;
    }
    if (result === 'done' || result === 'skipped') move(file, 'done');
    else if (result === 'failed') move(file, 'failed');
    else if (result === 'quarantined') move(file, 'quarantine');
    else {
      parked.set(curOrder, lastParkReason);
      move(file, 'parked');
    }
    // Brief yield so a missing_file restore into parked/ is seen before the lane reports idle.
    await new Promise<void>((r) => setImmediate(r));
  }

  if (!halted) send({ k: 'idle' });
  sdk.close();
  if (!stdinClosed) await new Promise<void>((res) => { onShutdown = res; });
  process.exit(0);
}
