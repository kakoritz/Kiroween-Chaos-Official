// PK-U3 backend: /api/monkey on the live server drives the built-in demo target (modes, guard rails, steady state, audit tail, kill switch).
import { afterEach, describe, expect, it } from 'vitest';
import { LiveServer } from '../src/live';

let srv: LiveServer | undefined;
afterEach(async () => { await srv?.close(); srv = undefined; });

async function boot() {
  srv = new LiveServer({ staticDir: '/nonexistent' });
  const { url } = await srv.listen(0);
  const get = async (p: string) => { const r = await fetch(url + p); return { status: r.status, body: await r.json() as any }; };
  const post = async (p: string, b?: unknown) => { const r = await fetch(url + p, { method: 'POST', body: b === undefined ? undefined : JSON.stringify(b) }); return { status: r.status, body: await r.json() as any }; };
  return { get, post };
}
const until = async (f: () => Promise<boolean>, ms = 6000): Promise<void> => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await f()) return; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error('timed out');
};

describe('monkey routes', () => {
  it('idle state describes the guard rails and says demo only', async () => {
    const { get } = await boot();
    const s = (await get('/api/monkey')).body;
    expect(s).toMatchObject({ demoOnly: true, running: false, status: 'idle', mode: 'observe', injections: 0 });
    expect(s.modes).toEqual(['observe', 'staging', 'prod-guarded']);
    expect(s.guard.lines.join(' ')).toMatch(/demo target only/);
    expect(s.steady).toMatchObject({ sli: 'success_rate', value: null, held: null });
  });

  it('previews a mode: prod-guarded shows its ceilings and a tagged-traffic plan', async () => {
    const { get } = await boot();
    const g = (await get('/api/monkey/preview?mode=prod-guarded')).body;
    expect(g.ceiling).toEqual({ maxPercent: 10, maxConcurrent: 3, maxDurationMs: 900000 });
    expect(g.allowFaults).toEqual(['latency', 'error', 'dependency_down']);
    expect(g.plan[0]).toMatchObject({ fault: 'latency', decision: 'inject' });
    expect(g.plan[0].rule.header).toBe('x-haunt-synthetic');
    expect((await get('/api/monkey/preview?mode=chaos')).status).toBe(400);
  });

  it('rejects a bad mode and a second start while running (409)', async () => {
    const { post } = await boot();
    expect((await post('/api/monkey/start', { mode: 'wild' })).status).toBe(400);
    expect((await post('/api/monkey/start', { mode: 'observe' })).body.running).toBe(true);
    const again = await post('/api/monkey/start', { mode: 'staging' });
    expect([again.status, again.body.error.code]).toEqual([409, 'monkey_running']);
  });

  it('observe injects nothing, measures the steady state and the kill switch ends it', async () => {
    const { get, post } = await boot();
    await post('/api/monkey/start', { mode: 'observe' });
    await until(async () => (await get('/api/monkey')).body.steady.samples >= 6);
    const s = (await get('/api/monkey')).body;
    expect(s).toMatchObject({ running: true, mode: 'observe', injections: 0 });
    expect(s.steady).toMatchObject({ held: true });
    expect(s.steady.value).toBe(1);
    expect(s.audit.some((a: any) => a.event === 'inject')).toBe(false);
    const stopped = await post('/api/monkey/stop');
    expect(stopped.body).toMatchObject({ running: false, status: 'stopped' });
    expect(stopped.body.lastStopMs).toBeLessThan(1000);
    expect(stopped.body.audit.map((a: any) => a.event)).toEqual(expect.arrayContaining(['start', 'stop', 'end']));
  });

  it('staging injects, shows the injection in the audit tail and the kill switch restores the target in under a second', async () => {
    const { get, post } = await boot();
    const started = await post('/api/monkey/start', { mode: 'staging' });
    expect(started.status).toBe(200);
    await until(async () => (await get('/api/monkey')).body.injections > 0);
    const s = (await get('/api/monkey?audit=50')).body;
    expect(s.audit.some((a: any) => a.event === 'inject' && a.fault === 'latency')).toBe(true);
    const t0 = Date.now();
    const stopped = (await post('/api/monkey/stop')).body;
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(stopped.running).toBe(false);
    expect(stopped.audit.some((a: any) => a.event === 'remove')).toBe(true);
  });

  it('prod-guarded runs only the allowed plan on synthetic traffic and stops on the kill switch', async () => {
    const { get, post } = await boot();
    await post('/api/monkey/start', { mode: 'prod-guarded' });
    await until(async () => (await get('/api/monkey')).body.steady.samples >= 6);
    const s = (await get('/api/monkey')).body;
    expect(s.mode).toBe('prod-guarded');
    expect(s.guard.ceiling).not.toBeNull();
    // latency 120 ms on tagged probes shows in the plan the host actually runs
    expect(s.audit.find((a: any) => a.event === 'inject')?.fault).toBe('latency');
    expect((await post('/api/monkey/stop')).body.status).toBe('stopped');
  });

  it('stop while idle is harmless', async () => {
    const { post } = await boot();
    const r = await post('/api/monkey/stop');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ running: false, status: 'idle' });
  });
});
