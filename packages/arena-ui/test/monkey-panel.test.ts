import { describe, expect, it } from 'vitest';
import { MODES, auditLine, killNote, meterView, parseMonkey, parsePreview, railsView, statusLine, statusWord } from '../src/monkey/model';
import { MonkeyUnavailable, monkeyClient } from '../src/monkey/client';

const raw = (over: Record<string, unknown> = {}): unknown => ({
  demoOnly: true, mode: 'staging', running: true, status: 'running', reason: '', injections: 2, lastStopMs: null,
  guard: { lines: ['Allowed faults: latency, error.', 'Endpoints: /api/.'] },
  steady: { sli: 'success_rate', threshold: 0.8, value: 0.9, held: true, samples: 12, recent: [1, 1, 0, 1] },
  audit: [{ ts: '2026-11-22T10:00:01.000Z', who: 'arena-panel', mode: 'staging', event: 'inject', fault: 'latency', endpoint: '/api/', result: 'applied' }],
  ...over,
});

describe('monkey panel model (PK-U3)', () => {
  it('offers the three modes in order', () => expect([...MODES]).toEqual(['observe', 'staging', 'prod-guarded']));

  it('parses the server answer and survives garbage', () => {
    const v = parseMonkey(raw())!;
    expect(v).toMatchObject({ mode: 'staging', running: true, injections: 2, demoOnly: true });
    expect(v.guardLines).toHaveLength(2);
    expect(v.steady.recent).toEqual([1, 1, 0, 1]);
    expect(parseMonkey(null)).toBeNull();
    expect(parseMonkey([])).toBeNull();
    const odd = parseMonkey({ mode: 'weird', steady: 'x', audit: ['no', { event: 3 }], guard: 7 })!;
    expect(odd.mode).toBe('observe');
    expect(odd.audit).toHaveLength(1);
    expect(odd.guardLines).toEqual([]);
  });

  it('draws the steady-state meter against its threshold: ok, breached, empty', () => {
    expect(meterView(parseMonkey(raw())!)).toMatchObject({ tone: 'ok', fill: 90, marker: 80, text: '90% (needs 80%)' });
    const bad = meterView(parseMonkey(raw({ steady: { sli: 'success_rate', threshold: 0.8, value: 0.5, held: false, samples: 9, recent: [] } }))!);
    expect(bad.tone).toBe('bad');
    const none = meterView(parseMonkey(raw({ steady: { sli: 'success_rate', threshold: 0.95, value: null, held: null, samples: 0, recent: [] } }))!);
    expect(none).toMatchObject({ tone: 'idle', fill: 0, text: 'No samples yet' });
    const lat = meterView(parseMonkey(raw({ steady: { sli: 'latency_p95_ms', threshold: 500, value: 250, held: true, samples: 8, recent: [] } }))!);
    expect(lat.label).toBe('p95 latency');
    expect(lat.fill).toBeLessThan(lat.marker);
  });

  it('words the status and the kill switch note plainly', () => {
    expect(statusWord(parseMonkey(raw({ status: 'aborted' }))!)).toMatch(/steady state breached/);
    expect(statusWord(parseMonkey(raw({ status: 'stopped', running: false }))!)).toMatch(/kill switch/);
    expect(killNote(parseMonkey(raw())!)).toMatch(/Ends every injection/);
    expect(killNote(parseMonkey(raw({ running: false, status: 'stopped', lastStopMs: 3 }))!)).toMatch(/3 ms/);
    expect(killNote(parseMonkey(raw({ running: false, status: 'idle' }))!)).toBe('Nothing is being injected.');
  });

  it('formats an audit line with time, event, fault, endpoint and reason', () => {
    const [a] = parseMonkey(raw())!.audit;
    expect(auditLine(a!)).toBe('10:00:01  INJECT latency /api/  applied');
  });
});

describe('monkey panel: status, rails, selected mode', () => {
  it('does not repeat the kill switch reason in the status line', () => {
    const v = parseMonkey(raw({ running: false, status: 'stopped', reason: 'kill switch: arena panel' }))!;
    expect(statusLine(v)).toBe('STOPPED: kill switch (arena panel)');
    expect(statusLine(parseMonkey(raw({ running: false, status: 'stopped', reason: 'kill switch' }))!)).toBe('STOPPED: kill switch');
    expect(statusLine(parseMonkey(raw({ running: false, status: 'aborted', reason: 'success_rate 40% below 80%' }))!)).toBe('ABORTED: steady state breached: success_rate 40% below 80%');
    expect(statusLine(parseMonkey(raw({ running: false, status: 'idle', reason: '' }))!)).toBe('Idle');
  });
  it('shows the picked mode rails: server lines when it matches, the preview otherwise, loading before it arrives', () => {
    const idle = parseMonkey(raw({ running: false, status: 'idle', mode: 'observe', guard: { lines: ['Observe: nothing is injected.'] } }))!;
    expect(railsView(idle, 'observe', null)).toMatchObject({ title: 'Guard rails (Observe)', lines: ['Observe: nothing is injected.'], pending: false });
    expect(railsView(idle, 'staging', null)).toMatchObject({ title: 'Guard rails (Staging)', lines: [], pending: true });
    const pv = parsePreview({ mode: 'staging', lines: ['Allowed faults: latency.'] });
    expect(railsView(idle, 'staging', pv)).toMatchObject({ title: 'Guard rails (Staging, preview)', lines: ['Allowed faults: latency.'], pending: false });
    expect(railsView(idle, 'prod-guarded', pv).pending).toBe(true);
    expect(railsView(parseMonkey(raw())!, 'observe', pv).title).toBe('Guard rails (Staging, running)');
    expect(parsePreview({ mode: 'x', lines: [] })).toBeNull();
  });
});

describe('monkey client', () => {
  const ok = (body: unknown, status = 200): typeof fetch => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it('talks to the three routes', async () => {
    const calls: string[] = [];
    const f = (async (u: string, i?: RequestInit) => { calls.push(`${i?.method} ${u} ${i?.body ?? ''}`); return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
    const c = monkeyClient('http://127.0.0.1:7070', f);
    await c.getState(); await c.start('staging'); await c.stop(); await c.preview('prod-guarded');
    expect(calls).toEqual([
      'GET http://127.0.0.1:7070/api/monkey?audit=12 ',
      'POST http://127.0.0.1:7070/api/monkey/start {"mode":"staging"}',
      'POST http://127.0.0.1:7070/api/monkey/stop {}',
      'GET http://127.0.0.1:7070/api/monkey/preview?mode=prod-guarded ',
    ]);
  });
  it('says so when there is no server or no route (mock, hosted)', async () => {
    await expect(monkeyClient(null).getState()).rejects.toBeInstanceOf(MonkeyUnavailable);
    await expect(monkeyClient('http://x', ok({}, 404)).getState()).rejects.toBeInstanceOf(MonkeyUnavailable);
    await expect(monkeyClient('http://x', (async () => { throw new Error('down'); }) as unknown as typeof fetch).stop()).rejects.toBeInstanceOf(MonkeyUnavailable);
  });
  it('turns a server error into its message', async () => {
    await expect(monkeyClient('http://x', ok({ error: { message: 'a monkey run is active' } }, 409)).start('observe')).rejects.toThrow('a monkey run is active');
  });
});
