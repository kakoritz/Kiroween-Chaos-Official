import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { ApiError, createApi, HttpApi, InPageApi, resolveHttpBase, SseParser, type ArenaEvent, type ConnectionStatus, type HauntInPage } from '../src/api';
import { apiBaseFromQuery, demoFromQuery, modeBadge } from '../src/mode';

describe('SseParser', () => {
  it('parses events split across chunks and ignores comments', () => {
    const p = new SseParser();
    expect(p.push(': ping\n\ndata: {"a"')).toEqual([]);
    expect(p.push(':1}\n\ndata: x\ndata: y\n\n')).toEqual(['{"a":1}', 'x\ny']);
  });
  it('handles CRLF and a split CRLF', () => {
    const p = new SseParser();
    expect(p.push('data: 1\r')).toEqual([]);
    expect(p.push('\n\r\ndata: 2\r\n\r\n')).toEqual(['1', '2']);
  });
});

interface Fake {
  url: string;
  hits: string[];
  close(): Promise<void>;
}

/** Tiny contract-shaped server. `onEvents` decides how /api/events answers. */
async function fakeServer(
  onEvents: (req: http.IncomingMessage, res: http.ServerResponse, n: number) => void,
): Promise<Fake> {
  const hits: string[] = [];
  let eventsCalls = 0;
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/api/events') return onEvents(req, res, ++eventsCalls);
    if (url.pathname === '/api/health') {
      res.setHeader('Content-Type', 'application/json');
      return void res.end(JSON.stringify({ ok: true, mode: 'mock', contractVersion: 1 }));
    }
    if (url.pathname === '/api/chaos') {
      res.statusCode = 409;
      res.setHeader('Content-Type', 'application/json');
      return void res.end(JSON.stringify({ error: { code: 'no_wave', message: 'no wave running' } }));
    }
    if (url.pathname === '/api/demo/start') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => { hits.push('BODY ' + body); res.setHeader('Content-Type', 'application/json'); res.end('{}'); });
      return;
    }
    if (url.pathname.endsWith('/postmortem')) {
      res.setHeader('Content-Type', 'text/markdown');
      return void res.end('# Postmortem');
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    hits,
    close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

const sse = (res: http.ServerResponse) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  return (ev: object) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
};
const hello = (seq: number, mode = 'mock', contractVersion = 1) => ({ type: 'hello', contractVersion, mode, seq, app: 'orders', ts: 1 });
const until = async (cond: () => boolean, ms = 4000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 10));
  }
};

let servers: Fake[] = [];
let offs: Array<() => void> = [];
afterEach(async () => {
  offs.forEach((o) => o());
  offs = [];
  await Promise.all(servers.map((s) => s.close()));
  servers = [];
});
const start = async (h: Parameters<typeof fakeServer>[0]) => { const s = await fakeServer(h); servers.push(s); return s; };

describe('HttpApi', () => {
  it('maps contract errors to ApiError and posts JSON bodies', async () => {
    const s = await start((_q, res) => res.end());
    const api = new HttpApi({ baseUrl: s.url });
    await expect(api.chaos({ lane: 1 })).rejects.toMatchObject({ name: 'ApiError', code: 'no_wave', status: 409 });
    await api.startDemo('hero');
    expect(s.hits).toContain('BODY {"script":"hero"}');
    expect(await api.getPostmortem(1)).toBe('# Postmortem');
  });

  it('reports unreachable servers as ApiError', async () => {
    const api = new HttpApi({ baseUrl: 'http://127.0.0.1:1' });
    await expect(api.getState()).rejects.toBeInstanceOf(ApiError);
    await expect(api.getState()).rejects.toMatchObject({ code: 'unreachable' });
  });

  it('streams events, reports status, and reconnects with the last seq', async () => {
    const s = await start((req, res, n) => {
      const send = sse(res);
      if (n === 1) {
        send(hello(10));
        send({ type: 'wave_start', seq: 11, ts: 2, wave: 1, detail: {} });
        setTimeout(() => res.destroy(), 30); // drop mid-stream
      } else {
        send({ type: 'future_event', seq: 12, ts: 3, whatever: true });
        res.write(': ping\n\n');
      }
      void req;
    });
    const got: ArenaEvent[] = [];
    const statuses: ConnectionStatus[] = [];
    const api = new HttpApi({ baseUrl: s.url, reconnectMinMs: 10, reconnectMaxMs: 20 });
    offs.push(api.subscribe({ onEvent: (e) => got.push(e), onStatus: (x) => statuses.push(x) }));
    await until(() => got.some((e) => e.type === 'future_event'));
    expect(got.map((e) => e.seq)).toEqual([10, 11, 12]);
    expect(s.hits.filter((h) => h.includes('/api/events'))[1]).toContain('since=11');
    expect(statuses).toContain('live');
    expect(statuses).toContain('reconnecting');
  });

  it('on 410 calls onGone and resubscribes without since', async () => {
    const s = await start((req, res, n) => {
      if (n === 1) { res.statusCode = 410; res.setHeader('Content-Type', 'application/json'); return void res.end('{"error":{"code":"gone","message":"old"}}'); }
      sse(res)(hello(99));
      void req;
    });
    let gone = 0;
    const got: ArenaEvent[] = [];
    const api = new HttpApi({ baseUrl: s.url, reconnectMinMs: 10 });
    offs.push(api.subscribe({ onEvent: (e) => got.push(e), onGone: () => gone++ }, { since: 5 }));
    await until(() => got.length === 1);
    expect(gone).toBe(1);
    const calls = s.hits.filter((h) => h.includes('/api/events'));
    expect(calls[0]).toContain('since=5');
    expect(calls[1]).not.toContain('since');
  });

  it('stops on a contract version mismatch without reconnecting', async () => {
    const s = await start((_q, res) => { sse(res)(hello(1, 'live', 2)); });
    const statuses: ConnectionStatus[] = [];
    const api = new HttpApi({ baseUrl: s.url, reconnectMinMs: 10 });
    offs.push(api.subscribe({ onEvent: () => {}, onStatus: (x) => statuses.push(x) }));
    await until(() => statuses.includes('version_mismatch'));
    await new Promise((r) => setTimeout(r, 80));
    expect(s.hits.filter((h) => h.includes('/api/events')).length).toBe(1);
  });

  it('unsubscribe closes the stream and emits closed once', async () => {
    const s = await start((_q, res) => { sse(res)(hello(1)); });
    const statuses: ConnectionStatus[] = [];
    const got: ArenaEvent[] = [];
    const api = new HttpApi({ baseUrl: s.url });
    const off = api.subscribe({ onEvent: (e) => got.push(e), onStatus: (x) => statuses.push(x) });
    await until(() => got.length === 1);
    off(); off();
    expect(statuses.filter((x) => x === 'closed').length).toBe(1);
  });
});

describe('same client for mock, live and browser', () => {
  it('delivers identical event handling for all three hello modes', async () => {
    const seen: string[] = [];
    for (const mode of ['mock', 'live', 'browser']) {
      const s = await start((_q, res) => { sse(res)(hello(1, mode)); });
      const api = createApi({ baseUrl: s.url });
      const off = api.subscribe({ onEvent: (e) => { if (e.type === 'hello') seen.push(String(e.mode)); } });
      await until(() => seen.length === ['mock', 'live', 'browser'].indexOf(mode) + 1);
      off();
    }
    expect(seen).toEqual(['mock', 'live', 'browser']);
  });

  it('inpage transport mirrors window.__haunt and normalises errors', async () => {
    let cb: ((e: ArenaEvent) => void) | undefined;
    let unsubbed = false;
    const fake = {
      getState: async () => ({ mode: 'browser' }),
      startDemo: async (s: string) => ({ s }),
      chaos: async () => { throw { code: 'lane_not_active', message: 'idle lane' }; },
      subscribe: (fn: (e: ArenaEvent) => void) => { cb = fn; return () => { unsubbed = true; }; },
    } as unknown as HauntInPage;
    const api = createApi({ inpage: fake });
    expect(api).toBeInstanceOf(InPageApi);
    expect(await api.getState()).toMatchObject({ mode: 'browser' });
    await expect(api.chaos({})).rejects.toMatchObject({ code: 'lane_not_active' });
    const statuses: ConnectionStatus[] = [];
    const got: ArenaEvent[] = [];
    const off = api.subscribe({ onEvent: (e) => got.push(e), onStatus: (x) => statuses.push(x) });
    cb!(hello(1, 'browser') as ArenaEvent);
    expect(statuses).toEqual(['connecting', 'live']);
    expect(got).toHaveLength(1);
    off();
    expect(unsubbed).toBe(true);
    expect(statuses.at(-1)).toBe('closed');
  });

  it('createApi requires inpage object for inpage transport', () => {
    expect(() => createApi({ transport: 'inpage' })).toThrow();
    expect(createApi({})).toBeInstanceOf(HttpApi);
  });
});

describe('resolveHttpBase', () => {
  it('prefers ?api, then same origin, then the default server', async () => {
    const json = (mode: unknown) => new Response(JSON.stringify({ mode }), { status: 200 });
    const calls: string[] = [];
    const f = (async (u: string) => {
      calls.push(u);
      if (u.startsWith('http://127.0.0.1:7070')) return json('mock');
      return new Response('<html></html>', { status: 200 }); // SPA fallback is not a server
    }) as unknown as typeof fetch;
    expect(await resolveHttpBase('', f)).toBe('http://127.0.0.1:7070');
    expect(calls).toEqual(['/api/health', 'http://127.0.0.1:7070/api/health']);
    expect(await resolveHttpBase('http://127.0.0.1:9999', (async () => json('live')) as unknown as typeof fetch)).toBe('http://127.0.0.1:9999');
    expect(await resolveHttpBase('', (async () => json('live')) as unknown as typeof fetch)).toBe('');
  });
});

describe('mode helpers', () => {
  it('badge pairs an icon with text and a tone per mode', () => {
    expect(modeBadge('mock', 'live')).toMatchObject({ label: 'MOCK', tone: 'mock' });
    expect(modeBadge('live', 'live')).toMatchObject({ label: 'LIVE', tone: 'live' });
    expect(modeBadge('browser', 'live')).toMatchObject({ label: 'BROWSER', tone: 'browser' });
    expect(modeBadge(null, 'connecting').label).toBe('Connecting');
    expect(modeBadge('live', 'reconnecting').label).toBe('Reconnecting');
    expect(modeBadge('live', 'version_mismatch').tone).toBe('warn');
    for (const m of ['mock', 'live', 'browser']) expect(modeBadge(m, 'live').icon).not.toBe('');
  });
  it('accepts only safe query values', () => {
    expect(demoFromQuery('?demo=hero')).toBe('hero');
    expect(demoFromQuery('?demo=../x')).toBeNull();
    expect(demoFromQuery('')).toBeNull();
    expect(apiBaseFromQuery('?api=http://127.0.0.1:7070/x')).toBe('http://127.0.0.1:7070');
    expect(apiBaseFromQuery('?api=http://evil.example')).toBe('');
    expect(apiBaseFromQuery('?api=javascript:alert(1)')).toBe('');
  });
});
