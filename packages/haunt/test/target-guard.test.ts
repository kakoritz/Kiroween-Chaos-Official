// H9.2: non-local targets are refused unless --i-own-this is passed.
import { describe, expect, it } from 'vitest';
import { assertLocalTarget, isLocalHost, NonLocalTargetError, startFaultProxy } from '../src/adapters';
import { monkeyCommand } from '../src/monkey/cli';

describe('isLocalHost', () => {
  it('accepts loopback names and addresses', () => {
    for (const h of ['localhost', 'LOCALHOST', 'app.localhost', '127.0.0.1', '127.9.9.9', '::1', '[::1]', '::ffff:127.0.0.1']) expect(isLocalHost(h), h).toBe(true);
  });
  it('rejects everything else, including lookalikes', () => {
    for (const h of ['example.com', '10.0.0.5', '192.168.1.2', '0.0.0.0', '128.0.0.1', 'localhost.evil.test', '127.0.0.1.evil.test', '2001:db8::1']) expect(isLocalHost(h), h).toBe(false);
  });
});

describe('assertLocalTarget', () => {
  it('passes local urls and refuses remote ones without the flag', () => {
    expect(assertLocalTarget('http://127.0.0.1:7071').port).toBe('7071');
    expect(() => assertLocalTarget('https://shop.example.com/api')).toThrow(NonLocalTargetError);
    expect(() => assertLocalTarget('https://shop.example.com/api')).toThrow(/--i-own-this/);
  });
  it('lets a remote url through with iOwnThis', () => {
    expect(assertLocalTarget('https://shop.example.com/api', true).hostname).toBe('shop.example.com');
  });
});

describe('startFaultProxy guard', () => {
  it('refuses a non-local upstream by default and allows it with iOwnThis', async () => {
    await expect(startFaultProxy({ upstream: 'http://203.0.113.9:80' })).rejects.toBeInstanceOf(NonLocalTargetError);
    const p = await startFaultProxy({ upstream: 'http://203.0.113.9:80', iOwnThis: true });
    expect(p.url).toMatch(/^http:\/\/127\.0\.0\.1:/);
    await p.close();
  });
});

describe('haunt monkey CLI guard', () => {
  it('exits 2 with a clear message for a remote --upstream and no flag', async () => {
    const lines: string[] = [];
    const code = await monkeyCommand(['--mode', 'observe', '--upstream', 'http://203.0.113.9:80'], (s) => lines.push(s));
    expect(code).toBe(2);
    expect(lines.join('\n')).toContain('--i-own-this');
  });
});
