// covers: bot helper library (third build list item 7). The helpers run as real code against a provider that fails on purpose.
import { createServer, type Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { findPython } from '../../core/src/live/inbox-command';

const root = resolve(__dirname, '../../..');
let srv: Server | undefined;
afterEach(() => new Promise<void>((r) => (srv ? srv.close(() => r()) : r())));

/** A provider that answers `plan` statuses in order, then 201; records the idempotency key of every call. */
async function provider(plan: number[]): Promise<{ url: string; keys: (string | undefined)[] }> {
  const keys: (string | undefined)[] = [];
  srv = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      keys.push(req.headers['idempotency-key'] as string | undefined);
      const status = plan.shift() ?? 201;
      res.writeHead(status, { 'content-type': 'application/json', ...(status === 429 ? { 'retry-after': '0' } : {}) });
      res.end(JSON.stringify({ id: 'x' }));
    });
  });
  await new Promise<void>((r) => srv!.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(srv!.address() as { port: number }).port}`, keys };
}

describe('node helpers', () => {
  it('retries 500 and 429 with the same key, then returns the answer', async () => {
    const lib = await import(join(root, 'templates/bot-lib/haunt-bot-lib.mjs'));
    const p = await provider([500, 429, 201]);
    const key = lib.idempotencyKey('ord-0001', 'pay');
    expect(key).toBe('ord-0001:pay:0');
    expect(await lib.hardenedCall(p.url, '/charges', { a: 1 }, { key, baseMs: 5 })).toEqual({ id: 'x' });
    expect(p.keys).toEqual([key, key, key]);
  });
  it('a 400 fails at once, and gives up after the tries', async () => {
    const lib = await import(join(root, 'templates/bot-lib/haunt-bot-lib.mjs'));
    const p = await provider([400]);
    await expect(lib.hardenedCall(p.url, '/charges', {}, { key: 'k', baseMs: 5 })).rejects.toThrow(/400/);
    expect(p.keys).toHaveLength(1);
    await new Promise<void>((r) => srv!.close(() => r()));
    const q = await provider([500, 500, 500, 500, 500]);
    await expect(lib.hardenedCall(q.url, '/charges', {}, { key: 'k', baseMs: 5, tries: 3 })).rejects.toThrow(/500/);
    expect(q.keys).toHaveLength(3);
  });
  it('a timeout is retried', async () => {
    const lib = await import(join(root, 'templates/bot-lib/haunt-bot-lib.mjs'));
    let n = 0;
    srv = createServer((req, res) => { req.resume(); req.on('end', () => { if (++n === 1) return; res.writeHead(201, { 'content-type': 'application/json' }); res.end('{"id":"y"}'); }); });
    await new Promise<void>((r) => srv!.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
    expect(await lib.hardenedCall(url, '/x', {}, { key: 'k', timeoutMs: 150, baseMs: 5 })).toEqual({ id: 'y' });
    expect(n).toBe(2);
  });
  it('the journal remembers across restarts', async () => {
    const lib = await import(join(root, 'templates/bot-lib/haunt-bot-lib.mjs'));
    const dir = join(mkdtempSync(join(tmpdir(), 'hj-')), 'j');
    const a = lib.journal(dir);
    expect(a.has('ord-1:pay:0')).toBe(false);
    a.mark('ord-1:pay:0');
    expect(lib.journal(dir).has('ord-1:pay:0')).toBe(true);
    expect(lib.journal(dir).has('ord-1:pay:1')).toBe(false);
  });
});

const py = findPython();
describe.skipIf(!py)('python helpers', () => {
  it('retries with the same key and the journal remembers (a real python process)', async () => {
    const p = await provider([500, 201]);
    const dir = join(mkdtempSync(join(tmpdir(), 'hpj-')), 'j');
    const code = [
      'import sys', `sys.path.insert(0, ${JSON.stringify(join(root, 'templates/bot-lib'))})`,
      'from haunt_bot_lib import idempotency_key, hardened_call, Journal',
      'k = idempotency_key("ord-0001", "pay")',
      `r = hardened_call(${JSON.stringify(p.url)}, "/charges", {"a": 1}, key=k, base=0.01)`,
      `j = Journal(${JSON.stringify(dir)})`, 'before = j.has(k)', 'j.mark(k)',
      `print(r["id"], k, before, Journal(${JSON.stringify(dir)}).has(k))`,
    ].join('\n');
    const out = await new Promise<string>((res, rej) => { execFile(py!, ['-c', code], (e, so) => (e ? rej(e) : res(so))); });
    expect(out.trim()).toBe('x ord-0001:pay:0 False True');
    expect(p.keys).toEqual(['ord-0001:pay:0', 'ord-0001:pay:0']);
  });
});
