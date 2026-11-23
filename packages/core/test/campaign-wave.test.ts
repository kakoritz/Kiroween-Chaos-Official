// CP-C2: POST /api/wave/start {campaign}, lane_ready for the Crew, HAUNT_PARTS for the bot, and the night plan.
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LiveServer, makeBotCommand, validateDemo, createLiveRuntime, type LiveEngine, type WaveSettings } from '../src/live';
import { loadCampaign } from '../../haunt/src/campaign/load';
import { campaignWaveConfig, planScripts, parseCampaignRequest } from '../../haunt/src/campaign/wave-config';
import { tiersForLanes } from '../../haunt/src/runner/lanes';

let srv: LiveServer | undefined;
const dirs: string[] = [];
afterEach(async () => {
  await srv?.close(); srv = undefined;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function boot(engine?: LiveEngine) {
  srv = new LiveServer({ engine, staticDir: '/nonexistent' });
  const { url } = await srv.listen(0);
  const post = async (p: string, b?: unknown) => {
    const r = await fetch(url + p, { method: 'POST', body: b === undefined ? undefined : JSON.stringify(b) });
    return { status: r.status, body: await r.json() as any };
  };
  return { post };
}

const { nights } = loadCampaign();
const night = (id: number) => nights.find((n) => n.id === id)!;

describe('POST /api/wave/start {campaign}', () => {
  it('runs lane 1 as the Crew with the chosen parts and lanes 2 to 5 as the rivals', async () => {
    const seen: WaveSettings[] = [];
    const { post } = await boot({ startWave: (_n, s) => { seen.push(s); } });
    const r = await post('/api/wave/start', { campaign: { night: 1, parts: ['idempotency', 'journal'] }, orders: 99, seed: 5, lanes: 2 });
    expect(r.status).toBe(200);
    const ready = srv!.log.events.filter((e) => e.type === 'lane_ready').map((e) => ({ lane: e.lane, ...(e.detail as object) }));
    expect(ready).toEqual([
      { lane: '1', tier: 'crew', label: 'Your Crew', parts: ['journal', 'idempotency'] },
      { lane: '2', tier: 'retrier', label: 'Retrier', parts: ['retry'] },
      { lane: '3', tier: 'journaler', label: 'Journaler', parts: ['retry', 'journal'] },
      { lane: '4', tier: 'reconciler', label: 'Reconciler', parts: ['retry', 'journal', 'idempotency'] },
      { lane: '5', tier: 'phoenix', label: 'Phoenix', parts: ['retry', 'journal', 'idempotency', 'breaker', 'offline_queue'] },
    ]);
    // The night fixes orders, seed, pace and lanes; the request cannot override them.
    expect(seen[0]).toMatchObject({ orders: night(1).orders, seed: night(1).seed, pace: 'slow', lanes: 5, tiers: 'race', campaign: { night: 1, parts: ['journal', 'idempotency'] } });
    const start = srv!.log.events.find((e) => e.type === 'wave_start')!;
    expect(start.detail).toMatchObject({ orders: night(1).orders, seed: night(1).seed, pace: 'slow', lanes: 5, campaign: { night: 1 } });
  });

  it('a Crew with no parts is a bare lane 1', async () => {
    const { post } = await boot();
    await post('/api/wave/start', { campaign: { night: 2 } });
    const lane1 = srv!.log.events.find((e) => e.type === 'lane_ready' && e.lane === '1')!;
    expect(lane1.detail).toEqual({ tier: 'crew', label: 'Your Crew', parts: [] });
  });

  it('rejects a bad night or part without starting a wave', async () => {
    const { post } = await boot();
    for (const campaign of [{ night: 0, parts: [] }, { night: 8 }, { night: 1, parts: ['nope'] }, { night: 1, parts: 'journal' }, 'x', []]) {
      const r = await post('/api/wave/start', { campaign });
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('bad_request');
    }
    expect(srv!.waves.active).toBe(false);
  });

  it('a request without campaign is unchanged', async () => {
    const { post } = await boot();
    await post('/api/wave/start', { orders: 3, lanes: 2 });
    expect(srv!.log.events.filter((e) => e.type === 'lane_ready').map((e) => (e.detail as any).tier)).toEqual(['rookie', 'phoenix']);
  });
});

describe('campaign wave config', () => {
  it('tiersForLanes puts the Crew on lane 1', () => {
    const t = tiersForLanes(5, 'race', { parts: ['retry'] });
    expect(t.map((x) => x.id)).toEqual(['crew', 'retrier', 'journaler', 'reconciler', 'phoenix']);
    expect(t[0]!.use).toEqual(['retry']);
    expect(t[0]!.label).toBe('Your Crew');
  });

  it('puts parts in the canonical order and applies the night values', () => {
    const cfg = campaignWaveConfig(night(3), ['offline_queue', 'retry']);
    expect(cfg).toMatchObject({ night: 3, orders: 4, seed: 103, pace: 'slow', lanes: 5, tiers: 'race', app: 'orders', crew: { parts: ['retry', 'offline_queue'] } });
    expect(campaignWaveConfig(night(6), []).app).toBe('inbox');
  });

  it('turns every plan into valid demo scripts, one boss window per script', () => {
    for (const n of nights) {
      const scripts = planScripts(n);
      expect(scripts.length).toBe(Math.max(1, n.plan.filter((p) => 'boss' in p).length));
      expect(scripts.flatMap((s) => s.presses).length).toBe(n.plan.filter((p) => !('boss' in p)).length);
    }
    // Nights whose faults the engine catalog knows load through the demo validator unchanged.
    for (const id of [1, 2, 3, 5]) for (const s of planScripts(night(id))) expect(() => validateDemo(s)).not.toThrow();
  });

  it('parses requests', () => {
    expect(parseCampaignRequest({ night: 2, parts: ['breaker', 'retry', 'retry'] }, nights)).toEqual({ night: 2, parts: ['retry', 'breaker'] });
    expect(() => parseCampaignRequest({ night: 1.5 }, nights)).toThrow('bad campaign night');
  });
});

describe('Crew bot command', () => {
  it('lane 1 runs crew.js with HAUNT_PARTS, rivals run their tier bundles', () => {
    const root = mkdtempSync(join(tmpdir(), 'haunt-crew-'));
    dirs.push(root);
    const botsDir = join(root, 'bots');
    mkdirSync(botsDir);
    for (const t of ['crew', 'retrier', 'journaler', 'reconciler', 'phoenix']) writeFileSync(join(botsDir, `${t}.js`), '');
    const cmd = makeBotCommand({ root, runDir: join(root, 'run'), providerUrl: 'http://127.0.0.1:1', botsDir });
    const settings = { orders: 4, seed: 101, tiers: 'race' as const, lanes: 5, speed: 1, pace: 'slow' as const, app: 'orders', campaign: { night: 1, parts: ['journal', 'idempotency'] as const } };
    const lane1 = cmd!('1', 1, settings as never)!;
    expect(lane1.args[0]).toMatch(/crew\.js$/);
    expect(lane1.env).toMatchObject({ HAUNT_TIER: 'crew', HAUNT_LANE: '1', HAUNT_PARTS: 'journal,idempotency', HAUNT_SEED: '101' });
    const lane5 = cmd!('5', 1, settings as never)!;
    expect(lane5.args[0]).toMatch(/phoenix\.js$/);
    expect(lane5.env).not.toHaveProperty('HAUNT_PARTS');
    expect(existsSync(botsDir)).toBe(true);
  });
});

describe('night plan in the live runtime', () => {
  it('presses the night plan on lane 1 when a campaign wave starts', () => {
    const rt = createLiveRuntime({ clock: false });
    const events: any[] = [];
    const settings = { orders: 4, seed: 101, tiers: 'race' as const, lanes: 5, speed: 1, pace: 'slow' as const, app: 'orders', campaign: { night: 1, parts: [] as never[] } };
    rt.live.startWave!(1, settings as never, (e) => events.push(e));
    // The first plan entry waits for a payment stage_start on lane 1; no press has fired before it.
    expect(events.filter((e) => e.type === 'chaos')).toHaveLength(0);
    rt.live.stopWave!();
  });
});
