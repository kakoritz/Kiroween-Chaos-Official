import { afterEach, describe, expect, it, vi } from 'vitest';
import { startFaultProxy, type FaultProxy, type ProxyFault } from '../src/adapters/proxy';
import { buildMonkeyConfig, defaultConfig, parseMonkeyConfig, type MonkeyConfig } from '../src/monkey/config';
import { evaluatePlan, Monkey, type AuditEntry, type InjectionTarget, type Sample } from '../src/monkey/monkey';
import { startControlServer, requestStop } from '../src/monkey/control';
import { httpProbe, startDemoTarget } from '../src/monkey/demo';
import { monkeyCommand, renderDryRun } from '../src/monkey/cli';

const PROD = `
mode: prod-guarded
schedule: { startHourUtc: 0, endHourUtc: 24 }
allow:
  faults: [latency, error, dependency_down, drop, data_corruption]
  endpoints: [/api/]
blast: { maxPercent: 5, maxConcurrent: 2, maxDurationMs: 30000 }
deadManMs: 2000
hypothesis: { sli: success_rate, threshold: 0.9, window: 10, minSamples: 3, intervalMs: 100 }
plan:
  - { fault: latency, endpoint: /api/items, ms: 120 }
  - { fault: drop, endpoint: /api/items }
  - { fault: data_corruption, endpoint: /api/items }
  - { fault: error, endpoint: /admin/, status: 500 }
  - { fault: error, endpoint: /api/items, status: 500, percent: 50 }
  - { fault: dependency_down, endpoint: /api/pay }
  - { fault: error, endpoint: /api/items, percent: 2 }
`;
const LATENCY_ONLY = (ms: number): string => PROD.replace(/plan:[\s\S]*/, `plan:\n  - { fault: latency, endpoint: /api/items, ms: ${ms} }\n`);
const cfg = (text: string): MonkeyConfig => {
  const r = parseMonkeyConfig(text);
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.config;
};

/** A target that only records, so no sockets are needed. */
function fakeTarget(): InjectionTarget & { rules: ProxyFault[]; cleared: number } {
  const t = {
    rules: [] as ProxyFault[], cleared: 0,
    addFault(f: ProxyFault) { t.rules.push(f); return t.rules.length; },
    removeFault() {}, clearFaults() { t.rules.length = 0; t.cleared++; },
    stats: () => ({ forwarded: 0, injected: 0, byKind: { status: 0, drop: 0, latency: 0 } }),
  };
  return t;
}
const good = async (): Promise<Sample> => ({ ok: true, ms: 5 });

afterEach(() => { vi.useRealTimers(); });

describe('config', () => {
  it('prod-guarded requires a schedule window; defaults are small', () => {
    expect(buildMonkeyConfig({ mode: 'prod-guarded' }).ok).toBe(false);
    const d = defaultConfig('prod-guarded');
    expect(d.blast).toEqual({ maxPercent: 5, maxConcurrent: 1, maxDurationMs: 60000 });
    expect(d.allow.faults).toEqual(['latency', 'error', 'dependency_down']);
  });
  it('rejects bad values', () => {
    expect(parseMonkeyConfig('mode: chaos').ok).toBe(false);
    expect(parseMonkeyConfig('mode: observe\nhypothesis: { sli: success_rate, threshold: 95 }').ok).toBe(false);
    expect(parseMonkeyConfig('{"mode":"observe","allow":{"faults":["nuke"]}}').ok).toBe(false);
    expect(parseMonkeyConfig('{"mode":"observe"}').ok).toBe(true);
  });
});

describe('dry run (what would be injected)', () => {
  it('prod-guarded allows only latency, small error rate, one dependency down, and says why for the rest', () => {
    const items = evaluatePlan(cfg(PROD));
    const by = (i: number) => items[i]!;
    expect(by(0)).toMatchObject({ decision: 'inject', rule: { kind: 'latency', ms: 120, pathPrefix: '/api/items', header: 'x-haunt-synthetic', forMs: 30000 } });
    expect(by(1)).toMatchObject({ decision: 'refuse', rule: null });
    expect(by(1).reason).toMatch(/not allowed in prod-guarded/);
    expect(by(2).reason).toMatch(/never injected/);
    expect(by(3).reason).toMatch(/endpoint \/admin\/ is not on the allowlist/);
    expect(by(4).reason).toMatch(/percent 50 exceeds the cap 5/);
    expect(by(5)).toMatchObject({ decision: 'inject' });
    expect(by(6).reason).toMatch(/max concurrent/);
    expect(renderDryRun(cfg(PROD))).toMatch(/INJECT +latency on \/api\/items[\s\S]*rule \{"kind":"latency"/);
  });
  it('refuses a prod config whose blast radius is above the ceiling', async () => {
    const c = cfg(PROD.replace('maxPercent: 5', 'maxPercent: 40'));
    const t = fakeTarget();
    const r = await new Monkey({ config: c, target: t, probe: good }).start();
    expect(r.status).toBe('refused');
    expect(r.reason).toMatch(/ceiling/);
    expect(t.rules).toHaveLength(0);
  });
  it('refuses outside the schedule window', async () => {
    const c = cfg(PROD.replace('startHourUtc: 0, endHourUtc: 24', 'startHourUtc: 3, endHourUtc: 4'));
    const noon = Date.UTC(2026, 0, 1, 12, 0, 0);
    const t = fakeTarget();
    const r = await new Monkey({ config: c, target: t, probe: good, now: () => noon }).start();
    expect(r.status).toBe('refused');
    expect(r.reason).toMatch(/schedule window/);
    expect(t.rules).toHaveLength(0);
  });
});

describe('observe injects nothing', () => {
  it('measures only: no rule is added, no inject audit, even with a plan', async () => {
    vi.useFakeTimers();
    const c = cfg('mode: observe\nblast: { maxDurationMs: 2000 }\nhypothesis: { sli: success_rate, threshold: 0.9, minSamples: 2, intervalMs: 100 }\nplan: [ { fault: error, endpoint: /api/, status: 500 } ]');
    const t = fakeTarget();
    const audit: AuditEntry[] = [];
    const p = new Monkey({ config: c, target: t, probe: good, audit: (e) => audit.push(e) }).start();
    await vi.advanceTimersByTimeAsync(2500);
    const r = await p;
    expect(r.status).toBe('completed');
    expect(r.injections).toBe(0);
    expect(r.samples).toBeGreaterThan(5);
    expect(t.rules).toHaveLength(0);
    expect(audit.some((e) => e.event === 'inject')).toBe(false);
  });
  it('against a real proxy: stats show zero injected', async () => {
    const demo = await startDemoTarget();
    const proxy = await startFaultProxy({ upstream: demo.url });
    try {
      const c = cfg('mode: observe\nblast: { maxDurationMs: 600 }\nhypothesis: { sli: success_rate, threshold: 0.9, minSamples: 2, intervalMs: 50 }\nplan: [ { fault: error, endpoint: /api/ } ]');
      const r = await new Monkey({ config: c, target: proxy, probe: httpProbe(`${proxy.url}/api/items`) }).start();
      expect(r.status).toBe('completed');
      expect(proxy.stats().injected).toBe(0);
      expect(proxy.stats().forwarded).toBeGreaterThan(2);
    } finally { await proxy.close(); await demo.close(); }
  });
});

describe('prod-guarded refuses non-allowlisted faults', () => {
  it('never reaches the target for drop, corruption or an unlisted endpoint; audit says refused', async () => {
    vi.useFakeTimers();
    const c = cfg(PROD.replace('maxConcurrent: 2', 'maxConcurrent: 3').replace(/plan:[\s\S]*/, 'plan:\n  - { fault: drop, endpoint: /api/items }\n  - { fault: data_corruption, endpoint: /api/items }\n  - { fault: error, endpoint: /admin/ }\n  - { fault: latency, endpoint: /api/items, ms: 50 }\n'));
    const t = fakeTarget();
    const audit: AuditEntry[] = [];
    const m = new Monkey({ config: c, target: t, probe: good, audit: (e) => audit.push(e), who: 'tester' });
    const p = m.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(t.rules).toHaveLength(1);
    expect(t.rules[0]).toMatchObject({ kind: 'latency', header: 'x-haunt-synthetic' });
    expect(audit.filter((e) => e.event === 'refused')).toHaveLength(3);
    expect(audit.filter((e) => e.event === 'inject')).toHaveLength(1);
    expect(audit.every((e) => e.who === 'tester' && e.mode === 'prod-guarded' && e.ts)).toBe(true);
    m.stop('test');
    await p;
  });
});

describe('steady-state breach aborts with a reason', () => {
  it('stops and removes every rule when success_rate falls under the threshold', async () => {
    vi.useFakeTimers();
    const t = fakeTarget();
    const probe = async (): Promise<Sample> => (t.rules.length ? { ok: false, ms: 900 } : { ok: true, ms: 5 });
    const audit: AuditEntry[] = [];
    const p = new Monkey({ config: cfg(LATENCY_ONLY(50)), target: t, probe, audit: (e) => audit.push(e) }).start();
    await vi.advanceTimersByTimeAsync(1500);
    const r = await p;
    expect(r.status).toBe('aborted');
    expect(r.reason).toMatch(/steady state breached: success_rate .* < 0\.9/);
    expect(t.rules).toHaveLength(0);
    expect(audit.map((e) => e.event)).toEqual(expect.arrayContaining(['inject', 'breach', 'remove', 'end']));
    expect(audit.find((e) => e.event === 'breach')!.reason).toBe(r.reason);
  });
  it('a broken baseline refuses to inject at all, naming the SLI', async () => {
    vi.useFakeTimers();
    const c = cfg(PROD.replace('sli: success_rate, threshold: 0.9', 'sli: latency_p95_ms, threshold: 100'));
    const t = fakeTarget();
    const r = await new Monkey({ config: c, target: t, probe: async () => ({ ok: true, ms: 400 }) }).start();
    expect(r.status).toBe('refused');
    expect(r.reason).toMatch(/baseline not steady: steady state breached: latency_p95_ms 400 > 100/);
    expect(t.rules).toHaveLength(0);
  });
});

describe('kill switch and dead-man timer (PK-C5)', () => {
  it('stop() removes every rule synchronously', async () => {
    vi.useFakeTimers();
    const t = fakeTarget();
    const m = new Monkey({ config: cfg(LATENCY_ONLY(50)), target: t, probe: good });
    const p = m.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(t.rules).toHaveLength(1);
    m.stop('operator');
    expect(t.rules).toHaveLength(0);
    expect((await p).status).toBe('stopped');
    expect(m.active).toBe(false);
  });
  it('dead-man timer ends injection when the probe loop (the controller) stops answering', async () => {
    vi.useFakeTimers();
    const t = fakeTarget();
    let hang = false;
    const probe = (): Promise<Sample> => (hang ? new Promise<Sample>(() => {}) : Promise.resolve({ ok: true, ms: 5 }));
    const p = new Monkey({ config: cfg(LATENCY_ONLY(50)), target: t, probe }).start();
    await vi.advanceTimersByTimeAsync(50);
    expect(t.rules).toHaveLength(1);
    hang = true;
    await vi.advanceTimersByTimeAsync(1900);
    expect(t.rules).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(300);
    expect(t.rules).toHaveLength(0);
    expect((await p).status).toBe('dead_man');
  });
  it('a heartbeat keeps a run alive past the dead-man window', async () => {
    vi.useFakeTimers();
    const t = fakeTarget();
    let n = 0;
    const probe = (): Promise<Sample> => (n++ < 3 ? Promise.resolve({ ok: true, ms: 1 }) : new Promise<Sample>(() => {}));
    const m = new Monkey({ config: cfg(LATENCY_ONLY(50)), target: t, probe });
    void m.start();
    await vi.advanceTimersByTimeAsync(50);
    for (let i = 0; i < 4; i++) { await vi.advanceTimersByTimeAsync(1500); m.heartbeat(); }
    expect(t.rules).toHaveLength(1);
    m.stop('done');
  });
  it('HTTP /stop ends real injections well under 1 s and restores normal behaviour', async () => {
    const demo = await startDemoTarget();
    const proxy: FaultProxy = await startFaultProxy({ upstream: demo.url });
    const m = new Monkey({ config: cfg(LATENCY_ONLY(3000).replace('threshold: 0.9', 'threshold: 0')), target: proxy, probe: httpProbe(`${proxy.url}/health`) });
    const control = await startControlServer(m);
    try {
      const run = m.start();
      await vi.waitFor(() => expect(proxy.stats().forwarded).toBeGreaterThan(2), { timeout: 3000 });
      const slowReq = fetch(`${proxy.url}/api/items`, { headers: { 'x-haunt-synthetic': '1' } }).catch(() => null);
      await new Promise((r) => setTimeout(r, 100));
      const t0 = Date.now();
      const res = await requestStop(control.port);
      expect(res.ok).toBe(true);
      expect(Date.now() - t0).toBeLessThan(1000);
      expect((await run).status).toBe('stopped');
      const t1 = Date.now();
      const after = await fetch(`${proxy.url}/api/items`, { headers: { 'x-haunt-synthetic': '1' } });
      expect(after.status).toBe(200);
      expect(Date.now() - t1).toBeLessThan(500);
      await slowReq;
    } finally { await control.close(); await proxy.close(); await demo.close(); }
  });
});

describe('proxy additions: percent, header and injected tag', () => {
  it('only tagged requests match a header rule; injected responses carry the tag; percent is honoured', async () => {
    const demo = await startDemoTarget();
    const proxy = await startFaultProxy({ upstream: demo.url, random: () => 0.01 });
    const p2 = await startFaultProxy({ upstream: demo.url, random: () => 0.99 });
    try {
      proxy.addFault({ kind: 'status', status: 503, header: 'x-haunt-synthetic', percent: 5 });
      expect((await fetch(`${proxy.url}/api/items`)).status).toBe(200);
      const tagged = await fetch(`${proxy.url}/api/items`, { headers: { 'x-haunt-synthetic': '1' } });
      expect(tagged.status).toBe(503);
      expect(tagged.headers.get('x-haunt-injected')).toBe('status');
      p2.addFault({ kind: 'status', status: 503, percent: 5 });
      expect((await fetch(`${p2.url}/x`)).status).toBe(200);
    } finally { await proxy.close(); await p2.close(); await demo.close(); }
  });
});

describe('CLI wrapper', () => {
  it('--dry-run prints the plan and injects nothing; prod-guarded without a file is refused', async () => {
    const lines: string[] = [];
    expect(await monkeyCommand(['--mode', 'staging', '--dry-run'], (s) => lines.push(s))).toBe(0);
    expect(lines.join('\n')).toMatch(/dry run[\s\S]*INJECT +latency on \/api\//);
    const l2: string[] = [];
    expect(await monkeyCommand(['--mode', 'prod-guarded'], (s) => l2.push(s))).toBe(2);
    expect(l2.join('\n')).toMatch(/needs --config/);
  });
});
