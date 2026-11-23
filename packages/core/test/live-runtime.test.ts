import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LiveServer, buildLedger, createLiveRuntime, makeBotCommand, DemoPlayer, LaneSpawner, loadDemo, readHardening, validateDemo } from '../src/live';
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

  it('hero presses wait for payment on their own lane, once each', () => {
    const engine = new RunnerEngine();
    const events: HauntEvent[] = [];
    engine.startWave(1, settings, (e) => events.push(e));
    const p = new DemoPlayer(engine, (e) => events.push(e), loadDemo('hero'));
    const payment = (lane: string, order = 'ord-0001', attempt = 1) => ({ type: 'stage_start', lane, order, stage: 'payment', detail: { attempt } });
    p.step(20000);
    expect(events).toHaveLength(0);
    p.observe(payment('1', 'ord-0001', 2));
    p.observe(payment('1', 'ord-0002'));
    p.step(21000);
    expect(events).toHaveLength(0);
    p.observe(payment('1'));
    p.step(21500);
    expect(events).toHaveLength(0);
    p.step(21700);
    expect(events.map((e) => e.lane)).toEqual(['1']);
    p.observe(payment('5'));
    p.observe(payment('1'));
    p.step(22600);
    p.step(30000);
    expect(events.filter((e) => e.type === 'chaos').map((e) => e.lane)).toEqual(['1', '5']);
    expect(p.finished).toBe(true);
  });

  it('afterPrevMs chains from the previous press and forEachOrder fires once per order', () => {
    const engine = new RunnerEngine();
    const events: HauntEvent[] = [];
    engine.startWave(1, settings, (e) => events.push(e));
    const base = loadDemo('hero');
    const press = { fault: 'crash', creature: 'reaper', point: 'after_effect_before_journal' };
    const script = {
      ...base,
      presses: [
        { ...press, lane: 2, when: { lane: 2, event: 'stage_start', stage: 'payment' }, forEachOrder: true },
        { ...press, lane: 3, afterPrevMs: 1000, when: undefined },
      ],
    };
    const p = new DemoPlayer(engine, (e) => events.push(e), validateDemo(script));
    const ev = (order: string) => ({ type: 'stage_start', lane: '2', order, stage: 'payment', detail: { attempt: 1 } });
    p.observe(ev('ord-0001'));
    p.observe(ev('ord-0001'));
    p.step(100);
    expect(events.filter((e) => e.type === 'chaos').map((e) => e.lane)).toEqual(['2']);
    p.step(1200);
    expect(events.filter((e) => e.type === 'chaos').map((e) => e.lane)).toEqual(['2', '3']);
  });

  it('a forEachOrder press never finishes the script, so a night keeps attacking every order (campaign night 1)', () => {
    const engine = new RunnerEngine();
    const events: HauntEvent[] = [];
    engine.startWave(1, settings, (e) => events.push(e));
    const press = { fault: 'crash', creature: 'reaper', point: 'after_effect_before_journal', lane: 2 };
    const script = validateDemo({ ...loadDemo('hero'), presses: [{ ...press, when: { lane: 2, event: 'stage_start', stage: 'payment' }, forEachOrder: true }] });
    const p = new DemoPlayer(engine, (e) => events.push(e), script);
    p.step(50);
    expect(p.finished).toBe(false);
    p.observe({ type: 'stage_start', lane: '2', order: 'ord-0001', stage: 'payment', detail: { attempt: 1 } });
    p.step(100);
    expect(p.finished).toBe(false);
    expect(events.filter((e) => e.type === 'chaos')).toHaveLength(1);
  });

  it('timed presses (atMs) still fire in order, once each', () => {
    const engine = new RunnerEngine();
    const events: HauntEvent[] = [];
    engine.startWave(1, settings, (e) => events.push(e));
    const p = new DemoPlayer(engine, (e) => events.push(e), loadDemo('loop'));
    p.step(9000);
    expect(events).toHaveLength(0);
    p.step(9650);
    expect(events.map((e) => e.lane)).toEqual(['1']);
    p.step(9800);
    p.step(9800);
    expect(events.filter((e) => e.type === 'chaos').map((e) => e.lane)).toEqual(['1', '2']);
  });

  it('speed divides script time', () => {
    const engine = new RunnerEngine();
    const events: HauntEvent[] = [];
    engine.startWave(1, settings, (e) => events.push(e));
    const p = new DemoPlayer(engine, (e) => events.push(e), loadDemo('loop'), 4);
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
    expect(out.lanes[0].byKind.account_create).toEqual({ rows: 1, repeats: 0 });
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

describe('bot command wiring', () => {
  const fakeBot = [
    "const rl = require('node:readline').createInterface({ input: process.stdin });",
    "process.stdout.write(JSON.stringify({ k: 'ready' }) + '\\n');",
    "rl.on('line', (l) => { if (JSON.parse(l).k === 'go') { require('node:fs').appendFileSync(require('node:path').join(process.env.HAUNT_RUN_DIR, 'ran-' + process.env.HAUNT_TIER + '-' + process.env.HAUNT_LANE), process.env.HAUNT_ORDERS_DIR); process.exit(0); } });",
  ].join('\n');

  it('spawns one real process per lane and ends the wave when all lanes exit', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haunt-bots-'));
    dirs.push(root);
    const botsDir = join(root, 'dist', 'bots');
    mkdirSync(botsDir, { recursive: true });
    for (const t of ['rookie', 'phoenix']) writeFileSync(join(botsDir, `${t}.js`), fakeBot);
    const runDir = join(root, '.haunt');
    mkdirSync(runDir, { recursive: true });
    const rt = createLiveRuntime({ clock: false, botCommand: makeBotCommand({ root, runDir, providerUrl: 'http://127.0.0.1:1' }) });
    srv = new LiveServer({ engine: rt.live });
    const { url } = await srv.listen(0);
    const r = await fetch(`${url}/api/wave/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lanes: 2, orders: 2 }) });
    expect(r.status).toBe(200);
    await rt.spawner!.done;
    const waves = (await (await fetch(`${url}/api/waves`)).json()) as any;
    const list = Array.isArray(waves) ? waves : waves.waves;
    expect(list.at(-1).endedAt).toBeTypeOf('number');
    const again = await fetch(`${url}/api/wave/stop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(again.status).toBe(409);
    expect(existsSync(join(runDir, 'wave-1', 'ran-rookie-1'))).toBe(true);
    expect(existsSync(join(runDir, 'wave-1', 'ran-phoenix-2'))).toBe(true);
  });

  it('isolates waves, resets once per wave and runs the hardened bundle from wave 2', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haunt-loop-'));
    dirs.push(root);
    const botsDir = join(root, 'dist', 'bots');
    mkdirSync(botsDir, { recursive: true });
    for (const t of ['rookie', 'phoenix', 'rookie.hardened']) writeFileSync(join(botsDir, `${t}.js`), fakeBot);
    const runDir = join(root, '.haunt');
    const resets: number[] = [];
    const bundles: string[] = [];
    const cmd = makeBotCommand({
      root, runDir, providerUrl: 'http://127.0.0.1:1',
      onWave: (w) => resets.push(w),
      bundleFor: (lane, wave, tier) => (lane === '1' && tier === 'rookie' && wave >= 2 ? 'rookie.hardened' : undefined),
    });
    const rt = createLiveRuntime({ clock: false, botCommand: (l, w, s) => { const c = cmd(l, w, s); if (c) bundles.push(`${w}:${c.args[0]!.split(/[\\/]/).pop()}`); return c; } });
    srv = new LiveServer({ engine: rt.live });
    const { url } = await srv.listen(0);
    for (let w = 1; w <= 2; w++) {
      const r = await fetch(`${url}/api/wave/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lanes: 2, orders: 2 }) });
      expect(r.status).toBe(200);
      await rt.spawner!.done;
    }
    const body = (await (await fetch(`${url}/api/waves`)).json()) as any;
    const list = (Array.isArray(body) ? body : body.waves) as any[];
    expect(list.map((w) => w.n)).toEqual([1, 2]);
    expect(list.every((w) => typeof w.endedAt === 'number')).toBe(true);
    expect(resets).toEqual([1, 2]);
    expect(bundles).toEqual(['1:rookie.js', '1:phoenix.js', '2:rookie.hardened.js', '2:phoenix.js']);
    for (const w of [1, 2]) {
      expect(existsSync(join(runDir, `wave-${w}`, 'ran-rookie-1'))).toBe(true);
      expect(existsSync(join(runDir, `wave-${w}`, 'ran-phoenix-2'))).toBe(true);
    }
  });

  it('leaves lanes unspawned and the wave running when no bot is built', async () => {
    const root = mkdtempSync(join(tmpdir(), 'haunt-nobots-'));
    dirs.push(root);
    const rt = createLiveRuntime({ clock: false, botCommand: makeBotCommand({ root, runDir: join(root, '.haunt'), providerUrl: 'http://127.0.0.1:1' }) });
    srv = new LiveServer({ engine: rt.live });
    const { url } = await srv.listen(0);
    await fetch(`${url}/api/wave/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lanes: 1, orders: 1 }) });
    await rt.spawner!.done;
    const stop = await fetch(`${url}/api/wave/stop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(stop.status).toBe(200);
  });
});

describe('makeBotCommand wave reset', () => {
  it('clears a stale wave folder on the first spawn of a wave, not on a restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'haunt-reset-'));
    dirs.push(root);
    const botsDir = join(root, 'bots');
    mkdirSync(botsDir, { recursive: true });
    for (const t of ['rookie', 'retrier', 'journaler', 'reconciler', 'phoenix']) writeFileSync(join(botsDir, `${t}.js`), '');
    const runDir = join(root, 'run');
    const stale = join(runDir, 'wave-2', 'lane-1', 'journal.jsonl');
    mkdirSync(join(runDir, 'wave-2', 'lane-1'), { recursive: true });
    writeFileSync(stale, '{"stale":true}\n');
    const cmd = makeBotCommand({ root, runDir, providerUrl: 'http://127.0.0.1:1', botsDir });
    const s = { ...settings, lanes: 1 };
    const first = cmd('1', 2, s);
    expect(first?.env?.HAUNT_ATTEMPT).toBe('1');
    expect(existsSync(stale)).toBe(false);
    writeFileSync(stale, '{"live":true}\n');
    const restart = cmd('1', 2, s);
    expect(restart?.env?.HAUNT_ATTEMPT).toBe('2');
    expect(existsSync(stale)).toBe(true);
    expect(cmd('1', 3, s)?.env?.HAUNT_ATTEMPT).toBe('1');
  });
});

describe('buildLedger kind names', () => {
  it('maps the desk ledger kinds to the effect-event names so the inbox columns agree with live counts', () => {
    const row = (kind: string, order: string, index = 1) => ({ lane: '1', kind, order, index, key: null }) as never;
    const out = buildLedger(['1'], () => [row('account', 'o1'), row('ticket', 'o1'), row('reply', 'o1'), row('reply', 'o1'), row('notify', 'o1')]) as { lanes: { byKind: Record<string, { rows: number; repeats: number }> }[] };
    expect(Object.keys(out.lanes[0]!.byKind).sort()).toEqual(['account_create', 'email', 'notify', 'ticket']);
    expect(out.lanes[0]!.byKind.email).toEqual({ rows: 2, repeats: 1 });
  });
});
