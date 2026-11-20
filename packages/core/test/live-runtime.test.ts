import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LiveServer, buildLedger, createLiveRuntime, DemoPlayer, LaneSpawner, loadDemo, readHardening } from '../src/live';
import { RunnerEngine } from '../../haunt/src/runner/engine';
import type { HauntEvent } from '../../haunt/src/score/score';
import type { LedgerRow } from '../src/provider';

let srv: LiveServer | undefined;
const dirs: string[] = [];
afterEach(async () => {
  await srv?.close(); srv = undefined;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const settings = { orders: 5, seed: 7, tiers: 'race' as const, lanes: 5, speed: 1, pace: 'show' as const, app: 'orders' };
const row = (id: string, lane: string, kind: LedgerRow['kind'], key: string): LedgerRow => ({ id, lane, kind, order: 'o1', key, amount: 1, index: null, ts: 1 });

describe('demo playback', () => {
  it('loop script loads', () => {
    expect(loadDemo('loop').lanes).toBe(2);
  });

  it('hero presses fire at their times, once each', () => {
    const engine = new RunnerEngine();
    const events: HauntEvent[] = [];
    engine.startWave(1, settings, (e) => events.push(e));
    const p = new DemoPlayer(engine, (e) => events.push(e), loadDemo('hero'));
    p.step(9000);
    expect(events).toHaveLength(0);
    p.step(9650);
    expect(events.map((e) => e.lane)).toEqual(['1']);
    p.step(9800);
    p.step(20000);
    expect(events.filter((e) => e.type === 'chaos').map((e) => e.lane)).toEqual(['1', '5']);
    expect(p.finished).toBe(true);
  });

  it('speed divides script time', () => {
    const engine = new RunnerEngine();
    const events: HauntEvent[] = [];
    engine.startWave(1, settings, (e) => events.push(e));
    const p = new DemoPlayer(engine, (e) => events.push(e), loadDemo('hero'), 4);
    p.step(2500);
    expect(events.filter((e) => e.type === 'chaos')).toHaveLength(2);
  });

  it('full plays the boss warning, start and end', () => {
    const engine = new RunnerEngine();
    const events: HauntEvent[] = [];
    engine.startWave(1, settings, (e) => events.push(e));
    const p = new DemoPlayer(engine, (e) => events.push(e), loadDemo('full'));
    p.step(105000);
    p.step(113000);
    p.step(140000);
    expect(events.map((e) => e.type).filter((t) => t.startsWith('boss_'))).toEqual(['boss_warning', 'boss_start', 'boss_end']);
  });
});

describe('lane spawner', () => {
  it('runs one loop per lane that has a command and aborts them on stop', async () => {
    const engine = new RunnerEngine();
    const started: string[] = [];
    const signals: AbortSignal[] = [];
    const sp = new LaneSpawner({
      engine,
      botCommand: (lane) => (lane === '3' ? undefined : { command: 'node', args: [lane] }),
      run: async (o) => {
        started.push(o.lane); signals.push(o.signal!);
        await new Promise<void>((r) => o.signal!.addEventListener('abort', () => r()));
        return { starts: 1, kills: [], exit: { code: null, signal: null }, clean: false };
      },
    });
    sp.start(1, settings, ['1', '2', '3']);
    expect(started).toEqual(['1', '2']);
    sp.stop();
    await sp.done;
    expect(signals.every((s) => s.aborted)).toBe(true);
  });
});

describe('ledger and hardening payloads', () => {
  it('builds per lane byKind with repeat counts', () => {
    const rows = [row('a', '1', 'charge', 'k1'), row('b', '1', 'charge', 'k1'), row('c', '1', 'account', 'k2')];
    const out = buildLedger(['1', '2'], (l) => rows.filter((r) => r.lane === l)) as { lanes: any[] };
    expect(out.lanes[0].byKind.charge).toEqual({ rows: 2, repeats: 1 });
    expect(out.lanes[0].byKind.account).toEqual({ rows: 1, repeats: 0 });
    expect(out.lanes[1]).toEqual({ lane: 2, byKind: {}, rows: [] });
  });

  it('reads the newest hardening spec folder, or nothing', () => {
    const d = mkdtempSync(join(tmpdir(), 'haunt-hard-'));
    dirs.push(d);
    expect(readHardening(d)).toBeUndefined();
    mkdirSync(join(d, 'hardening-run1'));
    writeFileSync(join(d, 'hardening-run1', 'requirements.md'), '# Harden the Rookie\n\nbody');
    const h = readHardening(d)!;
    expect(h.spec).toBe('hardening-run1');
    expect(h.title).toBe('Harden the Rookie');
    expect(h.files[0]!.path).toBe('.kiro/specs/hardening-run1/requirements.md');
    expect(readHardening(d, 'nope')).toBeUndefined();
  });
});

describe('runtime behind the live server', () => {
  async function boot(hardening?: () => any) {
    const rt = createLiveRuntime({ clock: false });
    srv = new LiveServer({ engine: rt.live, ledger: rt.ledger, hardening, staticDir: '/nonexistent' });
    const { url } = await srv.listen(0);
    const call = async (p: string, b?: unknown) => {
      const r = await fetch(url + p, b === undefined ? {} : { method: 'POST', body: JSON.stringify(b) });
      return { status: r.status, body: await r.json().catch(() => null) as any };
    };
    return { call, rt };
  }

  it('demo start launches the script wave and stop ends it', async () => {
    const { call } = await boot();
    expect((await call('/api/demo/start', { script: 'hero' })).status).toBe(200);
    const st = (await call('/api/state')).body;
    expect(st.demo.running).toBe('hero');
    expect(st.wave.running).toBe(true);
    expect(st.lanes).toHaveLength(5);
    expect((await call('/api/demo/start', { script: 'hero' })).status).toBe(409);
    expect((await call('/api/wave/stop', {})).status).toBe(200);
    expect((await call('/api/state')).body.demo.running).toBe(null);
  });

  it('serves the ledger for the current lanes', async () => {
    const { call } = await boot();
    await call('/api/wave/start', { lanes: 2, orders: 2 });
    const l = (await call('/api/ledger')).body;
    expect(l.lanes.map((x: any) => x.lane)).toEqual([1, 2]);
  });

  it('hardening is 404 until the wave ended and a spec exists', async () => {
    const spec = { spec: 'hardening-run1', title: 't', files: [] };
    let have = false;
    const { call } = await boot(() => (have ? spec : undefined));
    await call('/api/wave/start', { lanes: 1, orders: 1 });
    expect((await call('/api/waves/1/hardening')).status).toBe(404);
    await call('/api/wave/stop', {});
    expect((await call('/api/waves/1/hardening')).body.error.code).toBe('not_ready');
    have = true;
    const r = await call('/api/waves/1/hardening');
    expect(r.status).toBe(200);
    expect(r.body.spec).toBe('hardening-run1');
    expect((await call('/api/waves/9/hardening')).status).toBe(404);
  });
});
