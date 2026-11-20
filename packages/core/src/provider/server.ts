// HTTP wrapper around the in-process provider. Binds to loopback only.
import { createServer, type Server } from 'node:http';
import { Provider, type ProviderOptions } from './provider';

export const PROVIDER_HOST = '127.0.0.1';
export const PROVIDER_PORT = 7071;

export function createProviderServer(provider: Provider): Server {
  return createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      void (async () => {
        const url = new URL(req.url ?? '/', `http://${PROVIDER_HOST}`);
        let body: Record<string, unknown> | undefined;
        const raw = Buffer.concat(chunks).toString('utf8');
        if (raw) {
          try { body = JSON.parse(raw) as Record<string, unknown>; } catch {
            res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"bad json"}');
            return;
          }
        }
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v;
        const out = await provider.handle({
          method: req.method === 'POST' ? 'POST' : 'GET',
          path: url.pathname,
          query: Object.fromEntries(url.searchParams),
          headers,
          body,
        });
        if (out.drop) { req.socket.destroy(); return; }
        res.writeHead(out.status, { 'content-type': 'application/json', ...out.headers });
        res.end(JSON.stringify(out.body));
      })();
    });
  });
}

export async function startProvider(
  opts: ProviderOptions & { port?: number } = {},
): Promise<{ provider: Provider; server: Server; url: string; close(): Promise<void> }> {
  const provider = new Provider(opts);
  const server = createProviderServer(provider);
  await new Promise<void>((r) => server.listen(opts.port ?? PROVIDER_PORT, PROVIDER_HOST, r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : PROVIDER_PORT;
  return {
    provider,
    server,
    url: `http://${PROVIDER_HOST}:${port}`,
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}
