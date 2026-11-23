import { describe, expect, it } from 'vitest';
import { LaneTravel, travelAt } from '../src/runner/travel';
import { createLiveRuntime } from '../../core/src/live';

describe('travel constants', () => {
  it('scale with pace and speed', () => {
    expect(travelAt('normal', 1).walkMs).toBe(400);
    expect(travelAt('slow', 1)).toMatchObject({ walkMs: 1200, grabMs: 1500, ceremonyMs: 4800, returnMs: 5400, cancelMs: 2700 });
    expect(travelAt('slow', 4).walkMs).toBe(300);
  });
});

describe('LaneTravel process_up (rule 6)', () => {
  it('holds process_up until restartInMs after the recorded process_dead', async () => {
    let clock = 0;
    const t = new LaneTravel(() => travelAt('normal', 4), 'handoff', () => clock, async (ms) => { clock += ms; });
    const go = async (ev: Record<string, any>) => { await t.wait(ev); const e = t.annotate(ev); return { e, at: clock }; };
    const dead = await go({ type: 'process_dead', detail: { reason: 'crash', restartInMs: 1000 } });
    clock += 3; // the bot's own sleep already ran while the queue was backed up
    const up = await go({ type: 'process_up', detail: { attempt: 2 } });
    expect(up.at - dead.at).toBeGreaterThanOrEqual(1000);
    clock += 50;
    const again = await go({ type: 'process_up', detail: { attempt: 3 } });
    expect(again.at - up.at).toBe(50);
  });
});

describe('LaneTravel (P13)', () => {
  const run = (pace: string, speed: number) => {
    let clock = 0;
    const t = new LaneTravel(() => travelAt(pace, speed), 'handoff', () => clock, async (ms) => { clock += ms; });
    const log: { type: string; at: number; d: Record<string, any> }[] = [];
    const send = async (ev: Record<string, any>) => {
      await t.wait(ev);
      const e = t.annotate(ev);
      log.push({ type: e.type, at: clock, d: e.detail ?? {} });
      clock += 10; // the bot's own work
    };
    return { t, log, send, at: () => clock };
  };

  for (const [pace, speed] of [['slow', 1], ['slow', 4], ['normal', 1]] as const) {
    it(`holds every gap at pace ${pace}, speed ${speed}`, async () => {
      const r = run(pace, speed);
      const tt = travelAt(pace, speed);
      await r.send({ type: 'order_start', order: 'o1' });
      await r.send({ type: 'stage_start', order: 'o1', stage: 'a' });
      await r.send({ type: 'stage_done', order: 'o1', stage: 'a' });
      await r.send({ type: 'stage_start', order: 'o1', stage: 'handoff' });
      await r.send({ type: 'stage_done', order: 'o1', stage: 'handoff' });
      await r.send({ type: 'order_done', order: 'o1' });
      await r.send({ type: 'order_start', order: 'o2' });
      const by = (type: string, i = 0) => r.log.filter((e) => e.type === type)[i]!;
      expect(by('stage_start', 0).at - by('order_start', 0).at).toBeGreaterThanOrEqual(tt.grabMs - 5);
      expect(by('stage_start', 1).at - by('stage_done', 0).at).toBeGreaterThanOrEqual(tt.walkMs - 5);
      expect(by('order_start', 1).at - by('order_done').at).toBeGreaterThanOrEqual(tt.ceremonyMs + tt.returnMs - 5);
      expect(by('stage_done', 0).d.walkMs).toBe(tt.walkMs);
      expect(by('stage_done', 1).d.walkMs).toBeUndefined();
      expect(by('order_done').d).toMatchObject({ ceremonyMs: tt.ceremonyMs, returnMs: tt.returnMs });
    });
  }

  it('cancelled orders wait cancelMs + returnMs', async () => {
    const r = run('slow', 1);
    const tt = travelAt('slow', 1);
    await r.send({ type: 'order_start', order: 'o1' });
    await r.send({ type: 'order_failed', order: 'o1' });
    await r.send({ type: 'order_start', order: 'o2' });
    expect(r.log[2]!.at - r.log[1]!.at).toBeGreaterThanOrEqual(tt.cancelMs + tt.returnMs - 5);
  });

  it('exempts skipped replay pairs and restarts', async () => {
    const r = run('slow', 1);
    await r.send({ type: 'stage_done', order: 'o1', stage: 'a', detail: { skipped: true } });
    await r.send({ type: 'stage_start', order: 'o1', stage: 'b' });
    expect(r.log[1]!.at - r.log[0]!.at).toBe(10);
    expect(r.log[0]!.d.walkMs).toBeUndefined();
    await r.send({ type: 'stage_done', order: 'o1', stage: 'b' });
    await r.send({ type: 'process_dead' });
    await r.send({ type: 'stage_start', order: 'o1', stage: 'c' });
    expect(r.log[4]!.at - r.log[3]!.at).toBe(10);
  });
});

describe('live runtime enforces travel', () => {
  it('delays the next stage_start behind a stage_done', async () => {
    let clock = 0;
    const rt = createLiveRuntime({ clock: false, botCommand: () => ({ command: 'x', args: [] }), now: () => clock, sleep: async (ms) => { clock += ms; },
      run: async (o) => {
        for (const ev of [
          { type: 'order_start', order: 'ord-0001' }, { type: 'stage_start', order: 'ord-0001', stage: 'intake' },
          { type: 'stage_done', order: 'ord-0001', stage: 'intake' }, { type: 'stage_start', order: 'ord-0001', stage: 'verify' },
        ]) o.onEvent?.(ev);
        return { restarts: 0 } as never;
      } });
    const got: { type: string; at: number; detail: any }[] = [];
    rt.live.startWave!(1, { orders: 1, seed: 1, tiers: 'allPhoenix', lanes: 1, speed: 1, pace: 'normal', app: 'orders' }, (e) => got.push({ type: e.type, at: clock, detail: (e as any).detail }), () => {});
    await new Promise((r) => setTimeout(r, 50));
    const types = got.map((g) => g.type);
    expect(types).toContain('stage_done');
    const done = got.find((g) => g.type === 'stage_done')!;
    expect(done.detail.walkMs).toBe(400);
    const starts = got.filter((g) => g.type === 'stage_start');
    expect(starts[1]!.at - done.at).toBeGreaterThanOrEqual(400);
  });
});

describe('live runtime enforces travel on replayed stages', () => {
  it('the stage_start made from a skipped stage_done still waits for the grab gap', async () => {
    let clock = 0;
    const rt = createLiveRuntime({ clock: false, botCommand: () => ({ command: 'x', args: [] }), now: () => clock, sleep: async (ms) => { clock += ms; },
      run: async (o) => {
        for (const ev of [
          { type: 'order_start', order: 'ord-0001' }, { type: 'stage_done', order: 'ord-0001', stage: 'account', detail: { skipped: true } },
        ]) o.onEvent?.(ev);
        return { restarts: 0 } as never;
      } });
    const got: { type: string; at: number; detail: any }[] = [];
    rt.live.startWave!(1, { orders: 1, seed: 1, tiers: 'allPhoenix', lanes: 1, speed: 1, pace: 'slow', app: 'orders' }, (e) => got.push({ type: e.type, at: clock, detail: (e as any).detail }), () => {});
    await new Promise((r) => setTimeout(r, 50));
    const start = got.find((g) => g.type === 'order_start')!;
    const stage = got.find((g) => g.type === 'stage_start')!;
    expect(stage.at - start.at).toBeGreaterThanOrEqual(1500);
  });
});
