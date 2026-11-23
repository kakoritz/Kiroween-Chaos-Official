import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { HauntEvent } from '@haunt/shared';
import { validateEvents } from '../src/contract/validate';

// Rules the live orders stream used to break: R34/R2 after a journal replay, R-breaker across a restart, R59 across waves.
function build(fn: (e: (type: string, detail?: any, extra?: any) => void) => void): HauntEvent[] {
  const out: HauntEvent[] = [];
  let seq = 0;
  let ts = 1000;
  fn((type, detail = {}, extra = {}) => {
    seq++;
    ts += 10;
    const lane = type === 'hello' || type === 'reset' || type === 'wave_start' || type === 'wave_end' ? undefined : 1;
    const ev: any = { seq, ts, type, ...(type === 'hello' ? {} : { wave: 1 }), ...(lane ? { lane } : {}), ...extra };
    if (type === 'hello') Object.assign(ev, { contractVersion: 1, mode: 'mock', app: 'orders' });
    else ev.detail = detail;
    out.push(ev);
  });
  return out;
}
const head = (e: (t: string, d?: any, x?: any) => void): void => {
  e('hello');
  e('wave_start', { orders: 1, seed: 7, tiers: 'race', lanes: 1, speed: 1, app: 'orders', pace: 'show' });
  e('lane_ready', { tier: 'rookie', label: 'Rookie', parts: [] });
};
const rules = (evs: HauntEvent[], ...r: string[]) => validateEvents(evs, { requireWaveEnd: false }).filter((v) => r.includes(v.rule));

describe('orders emitters vs the validator', () => {
  it('a journal replay after stage_fail may restart the failed stage (R2, R34)', () => {
    const evs = build((e) => {
      head(e);
      e('order_start', { index: 1, total: 1, grabMs: 0 }, { order: 'ord-0001' });
      e('stage_start', { attempt: 1 }, { order: 'ord-0001', stage: 'account' });
      e('stage_fail', { attempt: 3, status: null, error: 'failed', retryable: true }, { order: 'ord-0001', stage: 'account' });
      e('recover_start', { action: 'replay', depth: 1 }, { order: 'ord-0001', stage: 'account' });
      e('recover_done', { action: 'replay', depth: 1, ms: 3 }, { order: 'ord-0001', stage: 'account' });
      e('stage_start', { attempt: 2 }, { order: 'ord-0001', stage: 'account' });
    });
    expect(rules(evs, 'R2', 'R34')).toEqual([]);
  });

  it('a stage_start straight after a plain stage_fail is still R34', () => {
    const evs = build((e) => {
      head(e);
      e('order_start', { index: 1, total: 1, grabMs: 0 }, { order: 'ord-0001' });
      e('stage_start', { attempt: 1 }, { order: 'ord-0001', stage: 'account' });
      e('stage_fail', { attempt: 1, status: null, error: 'failed', retryable: true }, { order: 'ord-0001', stage: 'account' });
      e('stage_start', { attempt: 2 }, { order: 'ord-0001', stage: 'account' });
    });
    expect(rules(evs, 'R34').length).toBe(1);
  });

  it('a restarted process starts with closed breakers (R-breaker)', () => {
    const evs = build((e) => {
      head(e);
      e('breaker', { service: 'charge', state: 'open' });
      e('process_dead', { reason: 'crash', restartInMs: 10 });
      e('process_up', { attempt: 2 });
      e('breaker', { service: 'charge', state: 'open' });
    });
    expect(rules(evs, 'R-breaker')).toEqual([]);
  });
});

describe('fallen lanes (R59)', () => {
  it('a reset after a tournament forgets who fell', () => {
    const src = readFileSync(new URL('../src/contract/validate.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/case 'reset':\s*lanes = new Map\(\); waveOpen = false; boss = null; fallenLanes\.clear\(\);/);
  });
});
