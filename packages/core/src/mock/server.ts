// Mock server (H0.3): the whole REST surface of contract/PROTOCOL.md plus SSE, driven by fixtures and a small chaos
// simulator. It is not an engine. Event sequences come from the lane planner fixtures; outcomes from the outcome table.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { APPS, CONTRACT_VERSION, CREATURES, PARTS, TIERS, TIER_ORDER, type AppId, type HauntEvent } from '@haunt/shared';
import { findRepoRoot } from '../../../haunt/src/contract/validate';
import { FIXTURES } from '../sim/fixtures';
import { Hub, BUFFER_MAX } from './hub';
import { OutcomeTable } from './outcomes';
import { ChaosSim, DEMO_SCRIPTS, MockError, Player, fixtureFor, scaledWave } from './play';
import { hardening, laneLog, laneOrders, ledger, postmortem, stageDetail, waveCompare, waveReport, wavesList } from './queries';

export { DEMO_SCRIPTS };
export const SPEEDS = [0.5, 1, 2, 4];
const HEARTBEAT_MS = 15_000;

export function loadOutcomeTable(root = findRepoRoot()): OutcomeTable {
  return new OutcomeTable(JSON.parse(readFileSync(resolve(root, 'packages', 'core', 'mock', 'outcomes.json'), 'utf8')));
}

export interface MockOptions {
  port?: number;
  host?: string;
  /** SSE heartbeat interval in ms (15 s by default). */
  heartbeatMs?: number;
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' };

const send = (res: ServerResponse, status: number, body: unknown, type = 'application/json'): void => {
  res.writeHead(status, { 'content-type': type, ...CORS });
  res.end(type === 'application/json' ? JSON.stringify(body) : String(body));
};

const fail = (res: ServerResponse, status: number, code: string, message = code): void => send(res, status, { error: { code, message } });

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((ok) => {
    let s = '';
    req.on('data', (c) => { s += c; });
    req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch { ok(undefined); } });
  });
}

const isObj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function createMockServer(opts: MockOptions = {}): { server: Server; listen: () => Promise<number>; close: () => Promise<void> } {
  const table = loadOutcomeTable();
  const hub = new Hub();
  const player = new Player(hub);
  const chaos = new ChaosSim(hub, player, table);
  const conns = new Set<ServerResponse>();
  const faults = { gone: false, slowMs: 0, version: false, unreachable: false };
  const advertised = (): number => (faults.version ? CONTRACT_VERSION + 1 : CONTRACT_VERSION);

  /** Start one wave: a fixture (demo) or a scaled plan, replayed with the hub's seq and clock. */
  function startWave(events: HauntEvent[], speed: number, script?: string): number {
    const n = ++hub.waveNo;
    player.play(events, n, { speed, script });
    return n;
  }

  function startDemo(script: string, speed: number): void {
    const name = fixtureFor(script);
    if (!name) throw new MockError(400, 'bad_request', `script must be one of ${[...DEMO_SCRIPTS, ...Object.keys(FIXTURES)].join(', ')}`);
    if (hub.running && !player.active) hub.emit({ type: 'wave_end', wave: hub.wave!.n, detail: { summary: {}, stopped: true } });
    const events = FIXTURES[name]();
    const app = events.find((e) => e.type === 'hello')?.app as AppId | undefined;
    if (app && app !== hub.app) { hub.app = app; hub.reset(); }
    startWave(events, speed, script);
  }

  function stopWave(): void {
    player.clear();
    if (hub.running) hub.emit({ type: 'wave_end', wave: hub.wave!.n, detail: { summary: summarize(), stopped: true } });
    hub.demoRunning = null;
  }

  function summarize(): Record<string, any> {
    const out: Record<string, any> = {};
    for (const l of hub.lanes.values()) out[l.lane] = { score: l.score, ...l.counts };
    return out;
  }

  function stateBody() {
    const w = hub.wave;
    const stages = APPS[hub.app].stages;
    return {
      contractVersion: advertised(), mode: 'mock', app: hub.app,
      wave: w ? { n: w.n, running: hub.running, seed: w.seed, speed: hub.speed, orders: w.orders, tiers: w.tiers, startedAt: w.startedAt } : null,
      chaos: hub.chaosMode,
      stages: stages.map((s) => ({ id: s.id, label: s.label, icon: s.icon, workAnimation: s.workAnimation, role: s.role })),
      lanes: [...hub.lanes.values()].sort((a, b) => a.lane - b.lane),
      boss: hub.boss,
      demo: { scripts: DEMO_SCRIPTS, running: hub.demoRunning },
      // Earlier mock fields, kept for clients written against the first slice.
      apps: Object.values(APPS).map((a) => ({ id: a.id, label: a.label, stages: a.stages.map((s) => ({ id: s.id, label: s.label, role: s.role })) })),
      tiers: TIER_ORDER.map((t) => ({ id: t, label: TIERS[t].label, parts: TIERS[t].parts })),
      parts: Object.values(PARTS),
      scripts: DEMO_SCRIPTS,
      speeds: SPEEDS,
      speed: hub.speed,
      script: hub.demoRunning,
      outcomeRows: table.rows.length,
    };
  }

  function sse(req: IncomingMessage, res: ServerResponse, url: URL): void {
    const q = url.searchParams;
    const sinceRaw = q.get('since');
    const since = sinceRaw === null ? undefined : Number(sinceRaw);
    if (since !== undefined && (!Number.isInteger(since) || since < 0)) return fail(res, 400, 'bad_request', 'since must be a non-negative integer');
    const oldest = hub.buffer.length ? hub.buffer[0].seq : hub.seq + 1;
    if (faults.gone || (since !== undefined && hub.seq >= BUFFER_MAX && since < oldest - 1)) {
      faults.gone = false;
      return fail(res, 410, 'gone', 'since is older than the event buffer');
    }
    const script = q.get('script');
    const speedQ = q.get('speed');
    const speed = speedQ === null ? hub.speed : Number(speedQ);
    if (!SPEEDS.includes(speed)) return fail(res, 400, 'bad_request', `speed must be one of ${SPEEDS.join(', ')}`);
    try {
      if (script) startDemo(script, speed);
    } catch (e) {
      if (e instanceof MockError) return fail(res, e.status, e.code, e.message);
      throw e;
    }
    const open = (): void => {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', ...CORS });
      conns.add(res);
      const write = (e: object): void => { res.write(`data: ${JSON.stringify(e)}\n\n`); };
      write({ type: 'hello', contractVersion: advertised(), mode: 'mock', seq: hub.seq, ts: Date.now(), app: hub.app });
      if (since !== undefined) for (const e of hub.buffer) if (e.seq > since) write(e);
      const sub = (e: HauntEvent): void => write(e);
      hub.subs.add(sub);
      const beat = setInterval(() => res.write(': ping\n\n'), opts.heartbeatMs ?? HEARTBEAT_MS);
      req.on('close', () => { clearInterval(beat); hub.subs.delete(sub); conns.delete(res); });
    };
    if (faults.slowMs > 0) { const ms = faults.slowMs; faults.slowMs = 0; setTimeout(open, ms); } else open();
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method ?? 'GET';
    if (method === 'OPTIONS') { res.writeHead(204, CORS); return void res.end(); }

    if (faults.unreachable && !path.startsWith('/_mock')) { req.socket.destroy(); return; }

    const body = method === 'POST' ? await readBody(req) : undefined;
    if (method === 'POST' && !isObj(body)) return fail(res, 400, 'bad_request', 'body must be a JSON object');

    if (method === 'GET') {
      if (path === '/api/health') return send(res, 200, { ok: true, mode: 'mock', contractVersion: advertised() });
      if (path === '/api/creatures') return send(res, 200, CREATURES);
      if (path === '/api/apps') return send(res, 200, Object.values(APPS).map((a) => ({ id: a.id, label: a.label, stages: a.stages.map((s) => ({ id: s.id, label: s.label, icon: s.icon, workAnimation: s.workAnimation, role: s.role })) })));
      if (path === '/api/state') return send(res, 200, stateBody());
      if (path === '/api/events') return sse(req, res, url);
      if (path === '/api/ledger') return send(res, 200, ledger(hub));
      if (path === '/api/waves') return send(res, 200, wavesList(hub));
      if (path === '/api/outcome') {
        const q = url.searchParams;
        const row = table.lookup((q.get('app') ?? 'orders') as any, (q.get('tier') ?? '') as any, q.get('fault') ?? '', q.get('stage') ?? '', q.get('point') ?? undefined);
        return row ? send(res, 200, row) : fail(res, 404, 'not_found', 'no outcome for that combination');
      }
      let m = path.match(/^\/api\/lane\/(\d+)\/stage\/([\w-]+)$/);
      if (m) {
        const lane = Number(m[1]);
        if (lane < 1 || lane > 5) return fail(res, 400, 'bad_lane', 'lane must be 1 to 5');
        if (!APPS[hub.app].stages.some((s) => s.id === m![2])) return fail(res, 400, 'bad_request', `unknown stage ${m[2]}`);
        return send(res, 200, stageDetail(hub, lane, m[2], url.searchParams.get('order') ?? undefined));
      }
      m = path.match(/^\/api\/lane\/(\d+)\/(log|orders)$/);
      if (m) {
        const lane = Number(m[1]);
        if (lane < 1 || lane > 5) return fail(res, 400, 'bad_lane', 'lane must be 1 to 5');
        if (m[2] === 'orders') return send(res, 200, laneOrders(hub, lane));
        const since = url.searchParams.get('since');
        return send(res, 200, laneLog(hub, lane, url.searchParams.get('order') ?? undefined, since === null ? undefined : Number(since)));
      }
      m = path.match(/^\/api\/waves\/(\d+)\/(report|postmortem|hardening)$/);
      if (m) {
        const w = hub.waves.find((x) => x.n === Number(m![1]));
        if (!w) return fail(res, 404, 'not_ready', 'no such wave');
        if (m[2] === 'report') return send(res, 200, waveReport(hub, w));
        if (w.endedAt === undefined) return fail(res, 404, 'not_ready', 'wave has not ended');
        return m[2] === 'postmortem' ? send(res, 200, postmortem(hub, w), 'text/markdown') : send(res, 200, hardening(hub, w));
      }
      m = path.match(/^\/api\/waves\/(\d+)\/compare\/(\d+)$/);
      if (m) {
        const a = hub.waves.find((x) => x.n === Number(m![1]));
        const b = hub.waves.find((x) => x.n === Number(m![2]));
        return a && b ? send(res, 200, waveCompare(hub, a, b)) : fail(res, 404, 'not_ready', 'no such wave');
      }
      return fail(res, 404, 'not_found');
    }

    if (method !== 'POST') return fail(res, 404, 'not_found');
    const b = body as Record<string, any>;

    if (path === '/api/wave/start') {
      if (hub.running) return fail(res, 409, 'wave_running', 'a wave is already running');
      const orders = b.orders ?? 12;
      const lanes = b.lanes ?? 5;
      const seed = b.seed ?? 7;
      const tiers = b.tiers ?? 'race';
      const speed = b.speed ?? hub.speed;
      const pace = b.pace ?? 'normal';
      const app = b.app ?? hub.app;
      if (!Number.isInteger(orders) || orders < 1 || orders > 100) return fail(res, 400, 'bad_request', 'orders must be an integer from 1 to 100');
      if (!Number.isInteger(lanes) || lanes < 1 || lanes > 5) return fail(res, 400, 'bad_request', 'lanes must be an integer from 1 to 5');
      if (!Number.isInteger(seed)) return fail(res, 400, 'bad_request', 'seed must be an integer');
      if (tiers !== 'race' && tiers !== 'allPhoenix') return fail(res, 400, 'bad_request', 'tiers must be race or allPhoenix');
      if (!SPEEDS.includes(speed)) return fail(res, 400, 'bad_request', `speed must be one of ${SPEEDS.join(', ')}`);
      if (pace !== 'normal' && pace !== 'show') return fail(res, 400, 'bad_request', 'pace must be normal or show');
      if (app !== 'orders' && app !== 'inbox') return fail(res, 400, 'bad_request', 'app must be orders or inbox');
      if (app !== hub.app) { hub.app = app; hub.reset(); }
      const wave = startWave(scaledWave({ orders, seed, tiers, lanes, pace, app }), speed);
      return send(res, 200, { wave });
    }
    if (path === '/api/wave/stop') { stopWave(); return send(res, 200, {}); }
    if (path === '/api/speed') {
      if (!SPEEDS.includes(b.speed)) return fail(res, 400, 'bad_request', `speed must be one of ${SPEEDS.join(', ')}`);
      hub.speed = b.speed;
      return send(res, 200, { speed: b.speed });
    }
    if (path === '/api/chaos') return send(res, 200, chaos.inject(b));
    if (path === '/api/chaos/mode') {
      if (!['off', 'manual', 'random'].includes(b.mode)) return fail(res, 400, 'bad_request', 'mode must be off, manual or random');
      if (b.frequency !== undefined && !(typeof b.frequency === 'number' && b.frequency >= 0 && b.frequency <= 1)) return fail(res, 400, 'bad_request', 'frequency must be 0 to 1');
      if (b.seed !== undefined && !Number.isInteger(b.seed)) return fail(res, 400, 'bad_request', 'seed must be an integer');
      hub.chaosMode = { mode: b.mode, frequency: b.frequency ?? hub.chaosMode.frequency, seed: b.seed ?? hub.chaosMode.seed };
      return send(res, 200, {});
    }
    if (path === '/api/demo/start') {
      if (hub.running && player.active) return fail(res, 409, 'wave_running', 'a wave is already running');
      const speed = b.speed === undefined ? hub.speed : Number(b.speed);
      if (typeof b.script !== 'string') return fail(res, 400, 'bad_request', 'script is required');
      if (!SPEEDS.includes(speed)) return fail(res, 400, 'bad_request', `speed must be one of ${SPEEDS.join(', ')}`);
      startDemo(b.script, speed);
      return send(res, 200, { ok: true, script: b.script, speed });
    }
    if (path === '/api/demo/stop') { stopWave(); return send(res, 200, {}); }
    if (path === '/api/app') {
      if (b.app !== 'orders' && b.app !== 'inbox') return fail(res, 400, 'bad_request', 'app must be orders or inbox');
      if (hub.running) return fail(res, 409, 'wave_running', 'a wave is running');
      hub.app = b.app;
      hub.reset();
      return send(res, 200, {});
    }
    if (path === '/_mock/reset') { player.clear(); hub.reset(); faults.gone = false; faults.slowMs = 0; faults.version = false; faults.unreachable = false; return send(res, 200, {}); }
    if (path === '/_mock/fault') {
      if (b.kind === 'drop_sse') { for (const c of conns) c.destroy(); conns.clear(); }
      else if (b.kind === 'gone') faults.gone = true;
      else if (b.kind === 'slow') faults.slowMs = 3000;
      else if (b.kind === 'version') faults.version = true;
      else if (b.kind === 'unreachable') faults.unreachable = true;
      else return fail(res, 400, 'bad_request', 'kind must be drop_sse, gone, slow, version or unreachable');
      return send(res, 200, {});
    }
    return fail(res, 404, 'not_found');
  }

  const server = createServer((req, res) => {
    route(req, res).catch((e) => {
      if (e instanceof MockError) return fail(res, e.status, e.code, e.message);
      if (!res.headersSent) fail(res, 500, 'internal', String(e?.message ?? e));
      else res.end();
    });
  });

  const host = opts.host ?? '127.0.0.1';
  return {
    server,
    listen: () => new Promise((ok) => server.listen(opts.port ?? 7070, host, () => ok((server.address() as any).port))),
    close: () => new Promise((ok) => { player.clear(); for (const c of conns) c.destroy(); server.closeAllConnections?.(); server.close(() => ok()); }),
  };
}
