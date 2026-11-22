// Local control port for the monkey (PK-C5): GET or POST /stop ends every injection, GET /status, GET or POST /heartbeat.
// Binds 127.0.0.1 only. Node only.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Monkey } from './monkey';

export interface ControlServer { port: number; url: string; close(): Promise<void> }

export async function startControlServer(monkey: Monkey, port = 0): Promise<ControlServer> {
  const server = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    const send = (code: number, body: unknown): void => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    req.resume();
    if (path === '/stop') {
      const t0 = Date.now();
      const r = monkey.stop('kill switch: http /stop');
      return send(200, { stopped: true, restoredInMs: Date.now() - t0, status: r?.status ?? 'idle' });
    }
    if (path === '/heartbeat') { monkey.heartbeat(); return send(200, { ok: true, active: monkey.active }); }
    if (path === '/status') return send(200, { active: monkey.active });
    send(404, { error: 'not_found', routes: ['/stop', '/status', '/heartbeat'] });
  });
  await new Promise<void>((ok, bad) => { server.once('error', bad); server.listen(port, '127.0.0.1', () => ok()); });
  const p = (server.address() as AddressInfo).port;
  return { port: p, url: `http://127.0.0.1:${p}`, close: () => new Promise<void>((ok) => { server.closeAllConnections(); server.close(() => ok()); }) };
}

/** `haunt stop`: asks a running monkey to end all injections. Resolves with the elapsed milliseconds. */
export async function requestStop(port: number, host = '127.0.0.1'): Promise<{ ok: boolean; ms: number; body?: unknown }> {
  const t0 = Date.now();
  try {
    const r = await fetch(`http://${host}:${port}/stop`, { method: 'POST', signal: AbortSignal.timeout(1000) });
    return { ok: r.ok, ms: Date.now() - t0, body: await r.json() };
  } catch {
    return { ok: false, ms: Date.now() - t0 };
  }
}
