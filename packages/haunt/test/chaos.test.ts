import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ArmedList, BotProcess, ChaosDirector, ChaosHost, FAULTS, MAX_DEPTH, innerPoints, restartDelay, serveRendezvous,
  type Killed, type LaneInfo,
} from '../src/chaos';
import { ProcessKilled, Sdk, type Part, type Transport } from '../src/sdk';

const WORKING: LaneInfo = { state: 'working', stage: 'payment' };
const RECOVERING: LaneInfo = { state: 'recovering', stage: 'payment' };

function director(parts: Part[] = ['retry', 'journal']): ChaosDirector {
  const d = new ChaosDirector();
  d.addLane('L1', parts);
  return d;
}

describe('catalog', () => {
  it('every fault applies to at least one stage and ids are unique', () => {
    expect(new Set(FAULTS.map((f) => f.id)).size).toBe(FAULTS.length);
    for (const f of FAULTS) expect(f.stages.length).toBeGreaterThan(0);
  });

  it('restart delay doubles per nested crash and caps at 8000 ms', () => {
    expect([0, 1, 2, 3, 4].map((n) => restartDelay(1000, n))).toEqual([1000, 2000, 4000, 8000, 8000]);
    expect(restartDelay(5000, 1)).toBe(8000);
  });
});

describe('director: arming', () => {
  it('arms an outer crash at the next crash point and emits the chaos detail at the press', () => {
    const d = director();
    const r = d.arm('L1', { fault: 'crash', point: 'after_effect_before_journal' }, WORKING);
    expect(r).toMatchObject({ ok: true, detail: { fault: 'crash', scope: 'outer', depth: 1, injectedAt: 'after_effect', point: 'after_effect_before_journal' } });
    expect(d.onAtPoint('L1', 'before_effect')).toBeNull();
    expect(d.onAtPoint('L1', 'after_effect_before_journal')).toMatchObject({ fault: 'crash', restartMs: 1000, nested: 0 });
  });

  it('default point is the next crash point reached', () => {
    const d = director();
    d.arm('L1', { fault: 'crash' }, WORKING);
    expect(d.onAtPoint('L1', 'during_replay')).toBeNull();
    expect(d.onAtPoint('L1', 'before_effect')).not.toBeNull();
  });

  it('restart delays differ by fault: crash 1000, out_of_memory 2500, power_outage 5000', () => {
    for (const [fault, ms] of [['crash', 1000], ['out_of_memory', 2500], ['power_outage', 5000]] as const) {
      const d = director();
      d.arm('L1', { fault }, WORKING);
      expect(d.onAtPoint('L1', 'mid_stage')?.restartMs).toBe(ms);
    }
  });

  it('rejects unknown faults and a point on a non-process fault', () => {
    const d = director();
    expect(d.arm('L1', { fault: 'nope' }, WORKING)).toMatchObject({ ok: false, status: 400 });
    expect(d.arm('L1', { fault: 'http_500', point: 'mid_stage' }, WORKING)).toMatchObject({ ok: false, status: 400, error: 'bad_point' });
  });

  it('provider fault that applies now is returned for the runner to post', () => {
    const d = director();
    const r = d.arm('L1', { fault: 'http_429' }, WORKING);
    expect(r).toMatchObject({ ok: true, arm: null, provider: { fault: 'http_429', count: 3 } });
  });
});

describe('director: deferral', () => {
  it('defers a fault that does not apply to the stage, never drops it', () => {
    const d = director();
    const r = d.arm('L1', { fault: 'http_404' }, { state: 'working', stage: 'tracking' });
    expect(r).toMatchObject({ ok: true, provider: null, detail: { deferred: true, deferredTo: 'account' } });
    expect(d.onStageStart('L1', 'intake')).toEqual([]);
    expect(d.onStageStart('L1', 'account')).toMatchObject([{ fault: 'http_404', count: 2 }]);
    expect(d.onStageStart('L1', 'account')).toEqual([]);
  });

  it('file faults wait for intake', () => {
    const d = director();
    const r = d.arm('L1', { fault: 'malformed_payload' }, WORKING);
    expect(r).toMatchObject({ ok: true, detail: { deferred: true, deferredTo: 'intake' } });
    expect(d.onStageStart('L1', 'intake')).toHaveLength(1);
  });

  it('hazard_event waits for tracking', () => {
    const d = director();
    const r = d.arm('L1', { fault: 'hazard_event' }, { state: 'working', stage: 'dispatch' });
    expect(r).toMatchObject({ ok: true, detail: { deferredTo: 'tracking' } });
  });

  it('inner provider fault is queued for the next recovery call, not deferred', () => {
    const d = director();
    const r = d.arm('L1', { fault: 'http_500' }, { state: 'recovering', stage: 'intake' });
    expect(r).toMatchObject({ ok: true, detail: { scope: 'inner', injectedAt: 'recovery' }, provider: { count: 1, nextCaller: 'recovery' } });
  });
});

describe('director: nesting', () => {
  it('defaults to inner scope while recovering, outer otherwise, explicit scope wins', () => {
    const d = director();
    expect(d.arm('L1', { fault: 'crash' }, RECOVERING)).toMatchObject({ detail: { scope: 'inner', depth: 1, injectedAt: 'recovery' } });
    expect(d.arm('L1', { fault: 'crash', scope: 'outer' }, RECOVERING)).toMatchObject({ detail: { scope: 'outer', depth: 2 } });
  });

  it('a dead lane takes the arm as inner, delivered in the next go', () => {
    const d = director();
    d.arm('L1', { fault: 'crash' }, { state: 'dead', stage: 'payment' });
    expect(d.pendingArms('L1')).toEqual([{ fault: 'crash', scope: 'inner' }]);
  });

  it('A8: crash then an inner crash. The second kill is in recovery and the restart delay doubles', () => {
    const d = director(['retry', 'journal']);
    d.arm('L1', { fault: 'crash', point: 'after_effect_before_journal' }, WORKING);
    expect(d.onAtPoint('L1', 'after_effect_before_journal')).toMatchObject({ nested: 0, restartMs: 1000 });
    d.arm('L1', { fault: 'crash' }, { state: 'dead', stage: 'payment' });
    d.processUp('L1');
    expect(d.depth('L1')).toBe(1); // the first crash left the stack, the inner one is pending
    expect(d.onAtPoint('L1', 'startup')).toBeNull(); // Journaler has recovery code: startup is not its recovery hook
    expect(d.onAtPoint('L1', 'during_replay')).toMatchObject({ nested: 1, restartMs: 2000 });
  });

  it('A8 for a bot with no recovery code: the inner crash fires at startup', () => {
    for (const parts of [[], ['retry']] as Part[][]) {
      const d = director(parts);
      d.arm('L1', { fault: 'crash', point: 'after_effect_before_journal' }, WORKING);
      d.onAtPoint('L1', 'after_effect_before_journal');
      d.arm('L1', { fault: 'crash' }, { state: 'dead', stage: 'payment' });
      d.processUp('L1');
      expect(d.onAtPoint('L1', 'startup')).toMatchObject({ nested: 1, restartMs: 2000 });
    }
  });

  it('the stack is capped at depth 5: the sixth press is 409 depth_limit', () => {
    const d = director();
    for (let i = 1; i <= MAX_DEPTH; i++) expect(d.arm('L1', { fault: 'crash', scope: 'outer' }, WORKING)).toMatchObject({ ok: true, detail: { depth: i } });
    expect(d.arm('L1', { fault: 'crash' }, WORKING)).toEqual({ ok: false, status: 409, error: 'depth_limit' });
  });

  it('depth resets when the stage completes, and delay streak resets with it', () => {
    const d = director();
    d.arm('L1', { fault: 'crash' }, WORKING);
    d.onAtPoint('L1', 'mid_stage');
    d.stageComplete('L1');
    expect(d.depth('L1')).toBe(0);
    d.arm('L1', { fault: 'crash' }, WORKING);
    expect(d.onAtPoint('L1', 'mid_stage')?.restartMs).toBe(1000);
  });

  it('restart delay caps at 8000 ms through a deep nest', () => {
    const d = director();
    const delays: number[] = [];
    for (let i = 0; i < 5; i++) {
      d.arm('L1', { fault: 'crash', point: 'mid_stage' }, WORKING);
      delays.push(d.onAtPoint('L1', 'mid_stage')!.restartMs);
      d.processUp('L1');
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 8000]);
  });

  it('orderEnd returns faults that never fired and empties the stack', () => {
    const d = director();
    d.arm('L1', { fault: 'crash', point: 'after_journal' }, WORKING);
    d.arm('L1', { fault: 'power_outage', point: 'mid_stage' }, WORKING);
    d.onAtPoint('L1', 'mid_stage');
    expect(d.orderEnd('L1')).toEqual(['crash']);
    expect(d.depth('L1')).toBe(0);
  });
});

describe('director: bosses', () => {
  const lanes = { L1: { state: 'working', stage: 'payment' }, L2: { state: 'working', stage: 'handoff' }, L3: { state: 'idle', stage: null } } as const;

  it('boss_power_outage crashes at the hero point on effect stages, else mid_stage', () => {
    const arms = director().bossArms('boss_power_outage', lanes);
    expect(arms.map((a) => [a.lane, a.req.fault, a.req.point])).toEqual([
      ['L1', 'power_outage', 'after_effect_before_journal'],
      ['L2', 'power_outage', 'mid_stage'],
      ['L3', 'power_outage', 'mid_stage'],
    ]);
  });

  it('boss_internet_outage lasts 12000 ms on every lane', () => {
    const d = director();
    const arms = d.bossArms('boss_internet_outage', { L1: WORKING });
    const r = d.arm('L1', arms[0]!.req, WORKING);
    expect(r).toMatchObject({ ok: true, provider: { fault: 'internet_outage', forMs: 12000 } });
  });

  it('boss_hazard_storm presses hazard_event and http_429 on every lane', () => {
    const arms = director().bossArms('boss_hazard_storm', { L1: WORKING, L2: WORKING });
    expect(arms.map((a) => a.req.fault)).toEqual(['hazard_event', 'http_429', 'hazard_event', 'http_429']);
  });
});

describe('bot-side hooks', () => {
  it('innerPoints: recovery hooks for journal or idempotency bots, startup for the rest', () => {
    expect(innerPoints([])).toContain('startup');
    expect(innerPoints(['retry'])).toContain('startup');
    expect(innerPoints(['retry', 'journal'])).toEqual(['during_replay', 'during_reconcile', 'during_backoff']);
  });

  it('ArmedList never fires when nothing is armed and consumes an arm once', () => {
    const a = new ArmedList(innerPoints(['journal']));
    expect(a.take('before_effect')).toBeNull();
    a.add({ fault: 'crash', point: 'after_journal' });
    expect(a.take('before_effect')).toBeNull();
    expect(a.take('after_journal')).not.toBeNull();
    expect(a.take('after_journal')).toBeNull();
  });

  it('in-process host throws ProcessKilled at the armed hook and sends nothing else', async () => {
    const sent: Record<string, unknown>[] = [];
    const host = new ChaosHost({ parts: [], mode: 'throw', send: (m) => sent.push(m), now: () => 0, sleep: async () => {} });
    host.control({ k: 'go', arms: [{ fault: 'crash', point: 'before_effect' }] });
    await host.hook('startup', {});
    await expect(host.hook('before_effect', { order: 'O1' })).rejects.toBeInstanceOf(ProcessKilled);
    await host.hook('before_effect', { order: 'O1' });
  });

  it('disk_full on a bot with no journal is reported as absorbed', () => {
    const sent: Record<string, unknown>[] = [];
    const host = new ChaosHost({ parts: [], mode: 'throw', send: (m) => sent.push(m), now: () => 0, sleep: async () => {} });
    const t: Transport = { post: async () => ({ status: 200, body: {}, headers: {} }), lookup: async () => ({ found: false }) };
    host.bind(new Sdk({ tier: 't', lane: 'L1', use: [], host, transport: t }));
    host.control({ k: 'arm', fault: 'disk_full' });
    expect(sent).toEqual([{ k: 'absorbed', reason: 'no journal' }]);
  });
});

describe('real SIGKILL of a child process', () => {
  const work = mkdtempSync(join(tmpdir(), 'haunt-chaos-'));
  const botJs = join(work, 'chaos-bot.mjs');

  beforeAll(async () => {
    await build({
      entryPoints: [fileURLToPath(new URL('./fixtures/chaos-bot.ts', import.meta.url))],
      bundle: true, platform: 'node', format: 'esm', outfile: botJs, logLevel: 'silent',
    });
  });
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  const marks = (dir: string) => (existsSync(join(dir, 'marks.log')) ? readFileSync(join(dir, 'marks.log'), 'utf8').trim().split('\n').map((l) => l.split(' ')[1]!) : []);

  async function start(d: ChaosDirector, dir: string, parts: Part[]) {
    const proc = new BotProcess(process.execPath, [botJs], { HAUNT_DIR: dir, HAUNT_PARTS: parts.join(',') });
    const killed = new Promise<Killed>((res) => serveRendezvous(proc, d, 'L1', res));
    await proc.waitFor('ready');
    proc.send({ k: 'go', arms: d.pendingArms('L1') });
    return { proc, killed };
  }

  it('kills the real process at after_effect_before_journal, then the restart replays and finishes', async () => {
    const dir = mkdtempSync(join(work, 'run-'));
    const parts: Part[] = ['retry', 'journal'];
    const d = director(parts);
    d.arm('L1', { fault: 'crash', point: 'after_effect_before_journal' }, WORKING);

    const first = await start(d, dir, parts);
    const k = await first.killed;
    expect(k.fired).toMatchObject({ fault: 'crash', point: 'after_effect_before_journal', restartMs: 1000 });
    expect(k.exit.signal === 'SIGKILL' || (k.exit.code !== 0 && k.exit.code !== null)).toBe(true);
    // The effect ran (provider call made) but the process never got past the hook.
    expect(marks(dir)).toEqual(['started', 'call']);

    d.processUp('L1');
    const second = await start(d, dir, parts);
    const exit = await second.proc.exited;
    expect(exit.code).toBe(0);
    expect(marks(dir)).toEqual(['started', 'call', 'started', 'call', 'effect_returned', 'done']);
  }, 30000);

  it('nested: an inner crash kills the restarted process during reconcile, with a doubled delay', async () => {
    const dir = mkdtempSync(join(work, 'run-'));
    const parts: Part[] = ['retry', 'journal', 'idempotency'];
    const d = director(parts);
    d.arm('L1', { fault: 'crash', point: 'after_effect_before_journal' }, WORKING);
    const first = await start(d, dir, parts);
    expect((await first.killed).fired.restartMs).toBe(1000);

    // Pressed while the lane is dead: queued, delivered in the next `go`.
    d.arm('L1', { fault: 'crash' }, { state: 'dead', stage: 'payment' });
    d.processUp('L1');
    const second = await start(d, dir, parts);
    const k2 = await second.killed;
    expect(k2.fired).toMatchObject({ point: 'during_reconcile', nested: 1, restartMs: 2000 });
    expect(marks(dir)).toEqual(['started', 'call', 'started']);

    d.processUp('L1');
    const third = await start(d, dir, parts);
    expect((await third.proc.exited).code).toBe(0);
    expect(marks(dir).at(-1)).toBe('done');
  }, 30000);

  it('a Rookie with an inner crash dies at startup before doing any work', async () => {
    const dir = mkdtempSync(join(work, 'run-'));
    const d = director([]);
    d.arm('L1', { fault: 'crash' }, { state: 'dead', stage: null });
    const p = await start(d, dir, []);
    const k = await p.killed;
    expect(k.fired.point).toBe('startup');
    expect(marks(dir)).toEqual([]);
  }, 30000);

  it('with nothing armed the bot never blocks and completes', async () => {
    const dir = mkdtempSync(join(work, 'run-'));
    const d = director(['retry']);
    const p = await start(d, dir, ['retry']);
    expect((await p.proc.exited).code).toBe(0);
    expect(marks(dir)).toEqual(['started', 'call', 'effect_returned', 'done']);
  }, 30000);
});
