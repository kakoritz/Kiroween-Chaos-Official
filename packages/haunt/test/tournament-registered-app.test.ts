// A tournament on an app registered from a haunt.yaml uses that app's own stages everywhere (found by tools/probe-app.mjs).
import { afterEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { FAULTS, nextApplicableStage } from '../src/chaos/catalog';
import { registerAppFromDir } from '../src/config/register-dir';
import { unregisterApp } from '../src/shared/registry';
import { roundPlan } from '../src/tournament/rounds';
import { stageOfCall } from '../src/tournament/curses';
import { fallbackStage } from '../src/tournament/fallback-stage';
import { laneCases } from '../src/tournament/signature';

const COFFEE = resolve(__dirname, 'fixtures/apps/coffee');
const OWN = ['read_request', 'pay', 'brew', 'ready'];
afterEach(() => { unregisterApp('coffee'); });

describe('tournament on a registered app', () => {
  it('the storm lands only on the app\'s own effect stages, with faults that fit them', () => {
    registerAppFromDir(COFFEE);
    for (const round of [1, 2, 3]) {
      const plan = roundPlan('s', round, { intensity: 7, orders: 12 } as never, 'coffee');
      expect(plan.length).toBeGreaterThan(5);
      for (const p of plan) {
        expect(['pay', 'ready'], `${p.fault} at ${p.stage}`).toContain(p.stage);
        if (!p.fuzz) expect(FAULTS.find((f) => f.id === p.fault)!.applies ?? []).toContain('effect');
      }
    }
  });

  it('a curse on a service the app does not use is placed on its first effect stage, never on an Orders stage', () => {
    registerAppFromDir(COFFEE);
    expect(stageOfCall('charge', undefined, 'coffee')).toBe('pay');
    expect(stageOfCall('notify', 1, 'coffee')).toBe('ready');
    for (const svc of ['account', 'tracking', 'handoff', 'dispatch', 'ticket']) expect(OWN, svc).toContain(stageOfCall(svc, undefined, 'coffee'));
  });

  it('a deferred fault walks the app\'s own stages', () => {
    registerAppFromDir(COFFEE);
    const http500 = FAULTS.find((f) => f.id === 'http_500')!;
    expect(nextApplicableStage(http500, 'read_request', 'coffee')).toEqual({ stage: 'pay', nextOrder: false });
    expect(nextApplicableStage(http500, 'brew', 'coffee')).toEqual({ stage: 'ready', nextOrder: false });
    expect(nextApplicableStage(http500, 'ready', 'coffee')).toEqual({ stage: 'ready', nextOrder: false });
    expect(nextApplicableStage(http500, null, 'coffee').stage).toBe('pay');
  });

  it('the Casebook blames a stage of the app when the stream does not say where, and Orders keep payment', () => {
    registerAppFromDir(COFFEE);
    const ws = (app: string) => ({ type: 'wave_start', detail: { app } });
    expect(fallbackStage([ws('coffee')])).toBe('pay');
    expect(fallbackStage([ws('orders')])).toBe('payment');
    expect(fallbackStage([ws('stream')])).toBe('payment');
    expect(fallbackStage([])).toBe('payment');
    const evs = [ws('coffee'), { type: 'order_start', lane: 1, order: 'cof-0001' }, { type: 'chaos', lane: 1, detail: { fault: 'http_500', creature: 'imp' } }, { type: 'order_failed', lane: 1, order: 'cof-0001', detail: { stage: 'pay', error: 'x' } }] as never;
    const cases = laneCases(evs, 1, 1);
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) expect(OWN).toContain(c.stage);
  });
});

import { RunnerEngine } from '../src/runner/engine';

describe('the engine on a registered app', () => {
  it('a fault pressed while the lane is at a stage it does not fit is deferred to the app\'s own next stage', () => {
    registerAppFromDir(COFFEE);
    const events: { type: string; detail?: Record<string, unknown> }[] = [];
    // http_429 does not fit a work stage: pressed at `brew` it waits for the next effect stage, which is `ready` (not an Orders stage).
    const engine = new RunnerEngine({ laneInfo: () => ({ state: 'working', stage: 'brew' }), post: async () => {} });
    engine.startWave(1, { orders: 3, seed: 7, tiers: 'race', lanes: 2, speed: 1, pace: 'normal', app: 'coffee' } as never, (e) => events.push(e as never));
    engine.chaos({ lane: 1, fault: 'http_429' });
    const d = events.find((e) => e.type === 'chaos')!.detail!;
    expect(d.deferred).toBe(true);
    expect(d.deferredTo).toBe('ready');
  });
});
