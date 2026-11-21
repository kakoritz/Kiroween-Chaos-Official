import http from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProcessAdapter, parseCommandLine, startFaultProxy, type FaultProxy } from '../src/adapters';

let upstream: http.Server | undefined;
let proxy: FaultProxy | undefined;
let adapter: ProcessAdapter | undefined;
const dirs: string[] = [];

afterEach(async () => {
  await proxy?.close();
  await new Promise<void>((r) => (upstream ? upstream.close(() => r()) : r()));
  if (adapter?.running) await adapter.kill();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  proxy = undefined;
  upstream = undefined;
  adapter = undefined;
});

async function startUpstream(): Promise<{ url: string; hits: () => number }> {
  let hits = 0;
  upstream = http.createServer((req, res) => {
    hits++;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, path: req.url }));
  });
  await new Promise<void>((r) => upstream!.listen(0, '127.0.0.1', () => r()));
  const port = (upstream.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, hits: () => hits };
}

describe('Proxy adapter', () => {
  it('forwards when no fault matches', async () => {
    const up = await startUpstream();
    proxy = await startFaultProxy({ upstream: up.url });
    const r = await fetch(`${proxy.url}/charges`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, path: '/charges' });
    expect(proxy.stats().forwarded).toBe(1);
  });

  it('injects a status fault for a limited count, without reaching upstream', async () => {
    const up = await startUpstream();
    proxy = await startFaultProxy({ upstream: up.url });
    proxy.addFault({ kind: 'status', status: 429, count: 2, pathPrefix: '/charges' });
    expect((await fetch(`${proxy.url}/charges`)).status).toBe(429);
    expect((await fetch(`${proxy.url}/charges`)).status).toBe(429);
    expect((await fetch(`${proxy.url}/charges`)).status).toBe(200);
    expect((await fetch(`${proxy.url}/other`)).status).toBe(200);
    expect(up.hits()).toBe(2);
    expect(proxy.stats().byKind.status).toBe(2);
  });

  it('drops the connection', async () => {
    const up = await startUpstream();
    proxy = await startFaultProxy({ upstream: up.url });
    proxy.addFault({ kind: 'drop', count: 1 });
    await expect(fetch(`${proxy.url}/x`)).rejects.toThrow();
    expect((await fetch(`${proxy.url}/x`)).status).toBe(200);
  });

  it('adds latency then forwards, and honours method filter and clearFaults', async () => {
    const up = await startUpstream();
    proxy = await startFaultProxy({ upstream: up.url });
    proxy.addFault({ kind: 'latency', ms: 600, method: 'POST' });
    // The lower bound is load-safe (a timer never fires early). The "not delayed" side is asserted by ordering, not by a
    // wall-clock ceiling: a GET started after the delayed POST must finish first, however slow the machine is.
    const t0 = Date.now();
    let postDone = false;
    const post = fetch(`${proxy.url}/x`, { method: 'POST' }).then((r) => {
      postDone = true;
      return r;
    });
    const get = await fetch(`${proxy.url}/x`);
    expect(get.status).toBe(200);
    expect(postDone).toBe(false);
    expect((await post).status).toBe(200);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(500);
    proxy.clearFaults();
    proxy.addFault({ kind: 'status', status: 500, forMs: 0 });
    expect((await fetch(`${proxy.url}/x`)).status).toBe(200); // expired at once
  });

  it('answers 502 when upstream is down', async () => {
    proxy = await startFaultProxy({ upstream: 'http://127.0.0.1:9' });
    expect((await fetch(`${proxy.url}/x`)).status).toBe(502);
  });
});

describe('Process adapter', () => {
  it('parses quoted command lines without a shell', () => {
    expect(parseCommandLine(`node -e "console.log('a b')" --x 'y z'`)).toEqual(['node', '-e', "console.log('a b')", '--x', 'y z']);
    expect(() => parseCommandLine('node "oops')).toThrow();
    expect(() => parseCommandLine('   ')).toThrow();
  });

  it('starts, SIGKILLs and restarts a real process', async () => {
    adapter = new ProcessAdapter({ start: `"${process.execPath}" -e "console.log('up'); setInterval(()=>{},1000)"` });
    adapter.start();
    expect(adapter.running).toBe(true);
    const exit = await adapter.kill();
    expect(adapter.running).toBe(false);
    expect(exit.code === null || exit.code !== 0).toBe(true);
    await adapter.restart(10);
    expect(adapter.running).toBe(true);
    expect(adapter.startCount).toBe(2);
    // Wait for the child's output instead of sleeping: node start-up time depends entirely on machine load.
    const a = adapter;
    await vi.waitFor(() => expect(a.output().filter((l) => l === 'up').length).toBeGreaterThanOrEqual(1), { timeout: 20000, interval: 25 });
  }, 30000);

  it('feeds and removes input files, contained in the input folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'haunt-in-'));
    dirs.push(dir);
    adapter = new ProcessAdapter({ start: 'node -v', inputDir: join(dir, 'inputs') });
    const p = adapter.feedInput('../../order-1.json', '{"id":1}');
    expect(p).toBe(join(dir, 'inputs', 'order-1.json'));
    expect(readFileSync(p, 'utf8')).toBe('{"id":1}');
    adapter.removeInput('order-1.json');
    expect(existsSync(p)).toBe(false);
    adapter.removeInput('order-1.json');
  });
});
