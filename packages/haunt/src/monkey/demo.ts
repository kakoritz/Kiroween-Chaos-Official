// Built-in demo target, synthetic probe and file audit sink for the monkey CLI. Node only. Local 127.0.0.1 only.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AuditEntry, Probe } from './monkey';

export interface DemoTarget { url: string; port: number; hits(): number; close(): Promise<void> }

/** A tiny service: GET /api/items and GET /health. */
export async function startDemoTarget(port = 0): Promise<DemoTarget> {
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits++;
    req.resume();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify((req.url ?? '').startsWith('/api/') ? { items: [1, 2, 3] } : { ok: true }));
  });
  await new Promise<void>((ok, bad) => { server.once('error', bad); server.listen(port, '127.0.0.1', () => ok()); });
  const p = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${p}`, port: p, hits: () => hits, close: () => new Promise<void>((ok) => { server.closeAllConnections(); server.close(() => ok()); }) };
}

/** Synthetic request through the proxy, tagged with the synthetic header. A non-2xx or a timeout is a failure. */
export function httpProbe(url: string, header = 'x-haunt-synthetic', timeoutMs = 2000): Probe {
  return async () => {
    const t0 = Date.now();
    try {
      const r = await fetch(url, { headers: { [header]: '1' }, signal: AbortSignal.timeout(timeoutMs) });
      await r.arrayBuffer();
      return { ok: r.ok, ms: Date.now() - t0 };
    } catch {
      return { ok: false, ms: Date.now() - t0 };
    }
  };
}

/** Appends one JSON object per line. */
export function jsonlAudit(file: string): (e: AuditEntry) => void {
  mkdirSync(dirname(file), { recursive: true });
  return (e) => appendFileSync(file, JSON.stringify(e) + '\n');
}
