// Proxy adapter (H3.7): a fault-injecting HTTP reverse proxy for any language. The process under test talks to the
// proxy; the proxy forwards to the real dependency unless a fault rule matches. Binds 127.0.0.1 only.
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export type ProxyFaultKind = 'status' | 'drop' | 'latency';

export interface ProxyFault {
  kind: ProxyFaultKind;
  /** `status`: the HTTP status to answer with (404, 429, 500, 503 ...). */
  status?: number;
  /** `latency`: delay in ms before forwarding. */
  ms?: number;
  /** Only requests with this method / path prefix. Omitted means any. */
  method?: string;
  pathPrefix?: string;
  /** Fire at most this many times, then the rule expires. Omitted means unlimited. */
  count?: number;
  /** Expire this many ms after being added. */
  forMs?: number;
}

export interface ProxyStats {
  forwarded: number;
  injected: number;
  byKind: Record<ProxyFaultKind, number>;
}

interface Rule extends ProxyFault {
  id: number;
  fired: number;
  expiresAt?: number;
}

export interface FaultProxy {
  readonly url: string;
  readonly port: number;
  /** Returns the rule id. */
  addFault(fault: ProxyFault): number;
  removeFault(id: number): void;
  clearFaults(): void;
  stats(): ProxyStats;
  close(): Promise<void>;
}

export interface FaultProxyOptions {
  /** Base URL of the real dependency, e.g. http://127.0.0.1:7071 . */
  upstream: string;
  port?: number;
  now?: () => number;
}

export async function startFaultProxy(opts: FaultProxyOptions): Promise<FaultProxy> {
  const upstream = new URL(opts.upstream);
  const now = opts.now ?? Date.now;
  const rules: Rule[] = [];
  let nextId = 1;
  const stats: ProxyStats = { forwarded: 0, injected: 0, byKind: { status: 0, drop: 0, latency: 0 } };

  const matches = (r: Rule, req: http.IncomingMessage): boolean => {
    if (r.expiresAt !== undefined && now() >= r.expiresAt) return false;
    if (r.count !== undefined && r.fired >= r.count) return false;
    if (r.method && r.method.toUpperCase() !== (req.method ?? 'GET').toUpperCase()) return false;
    if (r.pathPrefix && !(req.url ?? '/').startsWith(r.pathPrefix)) return false;
    return true;
  };

  const forward = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    stats.forwarded++;
    const out = http.request(
      {
        host: upstream.hostname,
        port: upstream.port || 80,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, host: upstream.host },
      },
      (back) => {
        res.writeHead(back.statusCode ?? 502, back.headers);
        back.pipe(res);
      },
    );
    out.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'upstream_unreachable' }));
    });
    req.pipe(out);
  };

  const server = http.createServer((req, res) => {
    const rule = rules.find((r) => matches(r, req));
    if (!rule) return forward(req, res);
    rule.fired++;
    stats.injected++;
    stats.byKind[rule.kind]++;
    if (rule.kind === 'drop') {
      req.resume();
      req.socket.destroy();
      return;
    }
    if (rule.kind === 'status') {
      req.resume();
      res.writeHead(rule.status ?? 500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'haunt_injected', status: rule.status ?? 500 }));
      return;
    }
    setTimeout(() => forward(req, res), rule.ms ?? 0);
  });

  await new Promise<void>((res, rej) => {
    server.once('error', rej);
    server.listen(opts.port ?? 0, '127.0.0.1', () => res());
  });
  const port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    addFault(f) {
      const id = nextId++;
      rules.push({ ...f, id, fired: 0, expiresAt: f.forMs !== undefined ? now() + f.forMs : undefined });
      return id;
    },
    removeFault(id) {
      const i = rules.findIndex((r) => r.id === id);
      if (i >= 0) rules.splice(i, 1);
    },
    clearFaults() {
      rules.length = 0;
    },
    stats: () => ({ ...stats, byKind: { ...stats.byKind } }),
    close: () =>
      new Promise<void>((res) => {
        server.closeAllConnections();
        server.close(() => res());
      }),
  };
}
