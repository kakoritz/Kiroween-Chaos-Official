import { describe, expect, it } from 'vitest';
import type { HauntEvent } from '@haunt/shared';
import { matchesOneOf, validateEvents } from '../src/contract/validate';

/** Tiny stream builder: every event gets increasing seq and ts. */
function stream(build: (e: (type: string, lane: number | undefined, detail?: any, extra?: any) => void) => void): HauntEvent[] {
  const out: HauntEvent[] = [];
  let seq = 0;
  let ts = 1000;
  build((type, lane, detail, extra = {}) => {
    seq++;
    ts += extra.dt ?? 10;
    const ev: any = { seq, ts, type, ...(type === 'hello' || type === 'reset' ? {} : { wave: extra.wave ?? 1 }), ...(lane ? { lane } : {}), ...extra };
    delete ev.dt;
    if (type === 'hello') Object.assign(ev, { contractVersion: 1, mode: 'mock', app: 'orders' });
    else ev.detail = detail ?? {};
    out.push(ev);
  });
  return out;
}

const start = (e: any): void => {
  e('hello', undefined);
  e('wave_start', undefined, { orders: 1, seed: 7, tiers: 'race', lanes: 1, speed: 1, app: 'orders', pace: 'show' });
  e('lane_ready', 1, { tier: 'rookie', label: 'Rookie', parts: [] });
};
const end = (e: any): void => e('wave_end', undefined, { summary: { 1: { score: 0, completed: 0, failed: 0, parked: 0, quarantined: 0, repeats: 0 } } });
const ord = { order: 'ord-0001' };
const stage = (e: any, s: string, attempt = 1): void => {
  e('stage_start', 1, { attempt }, { ...ord, stage: s });
  e('stage_progress', 1, { pct: 50, label: 'x' }, { ...ord, stage: s });
  e('stage_done', 1, { ms: 100, skipped: false }, { ...ord, stage: s });
};
const rules = (events: HauntEvent[], o = {}): string[] => validateEvents(events, o).map((v) => v.rule);

describe('validateEvents', () => {
  it('accepts a minimal clean wave', () => {
    const ev = stream((e) => {
      start(e);
      e('order_start', 1, { index: 1, total: 1 }, ord);
      for (const s of ['account', 'create', 'submit', 'payment', 'confirmation', 'receive', 'process', 'updates', 'ship', 'transit', 'handoff']) stage(e, s);
      e('order_done', 1, { clean: true, ms: 1, repeats: 0 }, ord);
      e('score', 1, { delta: 100, total: 100, reason: 'order clean' });
      end(e);
    });
    expect(validateEvents(ev)).toEqual([]);
  });

  it('still accepts a recorded run with the legacy stage ids (V1_2 section 1, rule 48)', () => {
    const ev = stream((e) => {
      start(e);
      e('order_start', 1, { index: 1, total: 1 }, ord);
      for (const s of ['intake', 'account', 'payment', 'confirmation', 'dispatch', 'updates', 'tracking', 'handoff']) stage(e, s);
      e('order_done', 1, { clean: true, ms: 1, repeats: 0 }, ord);
      e('score', 1, { delta: 100, total: 100, reason: 'order clean' });
      end(e);
    });
    expect(validateEvents(ev)).toEqual([]);
  });

  it('checks stage ids against the hello stage list when the server sends one', () => {
    const ev = stream((e) => {
      start(e);
      e('order_start', 1, { index: 1, total: 1 }, ord);
      for (const s of ['login', 'pay']) stage(e, s);
      e('order_done', 1, { clean: true, ms: 1, repeats: 0 }, ord);
      e('score', 1, { delta: 100, total: 100, reason: 'order clean' });
      end(e);
    });
    (ev[0] as any).stages = [{ id: 'login', label: 'Login', kind: 'effect' }, { id: 'pay', label: 'Pay', kind: 'effect' }];
    expect(rules(ev)).not.toContain('R19');
  });

  it('rejects a lane on a global event and a missing wave (rule 16)', () => {
    const ev = stream((e) => { start(e); end(e); });
    (ev[1] as any).lane = 1;
    delete (ev[2] as any).wave;
    expect(rules(ev)).toContain('schema');
  });

  it('rejects skipping a stage and a bad attempt number', () => {
    const ev = stream((e) => {
      start(e);
      e('order_start', 1, { index: 1, total: 1 }, ord);
      stage(e, 'account');
      e('stage_start', 1, { attempt: 5 }, { ...ord, stage: 'payment' });
      e('stage_done', 1, { ms: 1, skipped: false }, { ...ord, stage: 'payment' });
      end(e);
    });
    const r = rules(ev);
    expect(r).toContain('R2');
    expect(r).toContain('R29');
  });

  it('requires repeat to follow its effect (rule 8) and score arithmetic (rule 9)', () => {
    const ev = stream((e) => {
      start(e);
      e('order_start', 1, { index: 1, total: 1 }, ord);
      e('repeat', 1, { kind: 'charge', key: 'ord-0001:charge', count: 2 }, ord);
      e('score', 1, { delta: -150, total: -100, reason: 'duplicate charge' });
      end(e);
    });
    const r = rules(ev);
    expect(r).toContain('R8');
    expect(r).toContain('R9');
  });

  it('requires a closer for every chaos (rules 7, 20)', () => {
    const ev = stream((e) => {
      start(e);
      e('chaos', 1, { creature: 'reaper', fault: 'crash', scope: 'outer', depth: 1, injectedAt: 'before', source: 'demo' });
      end(e);
    });
    expect(rules(ev)).toContain('R7');
  });

  it('checks recovery pairs are closed last in, first out (rules 13, 30)', () => {
    const ev = stream((e) => {
      start(e);
      e('process_dead', 1, { reason: 'crash', restartInMs: 1000 });
      e('process_up', 1, { attempt: 2 }, { dt: 1000 });
      e('recover_start', 1, { action: 'replay', depth: 0 });
      e('recover_start', 1, { action: 'reconcile', depth: 0 });
      e('recover_done', 1, { action: 'replay', ms: 5, depth: 0 });
      end(e);
    });
    expect(rules(ev)).toContain('R13');
  });

  it('checks the restart delay (rule 6)', () => {
    const ev = stream((e) => {
      start(e);
      e('process_dead', 1, { reason: 'crash', restartInMs: 5000 });
      e('process_up', 1, { attempt: 2 }, { dt: 100 });
      end(e);
    });
    expect(rules(ev)).toContain('R6');
  });

  it('does not allow a new stage_start after stage_fail (rule 34)', () => {
    const ev = stream((e) => {
      start(e);
      e('order_start', 1, { index: 1, total: 1 }, ord);
      stage(e, 'account');
      e('stage_start', 1, { attempt: 1 }, { ...ord, stage: 'account' });
      e('stage_fail', 1, { error: 'x', retryable: true, attempt: 1 }, { ...ord, stage: 'account' });
      e('recover_start', 1, { action: 'retry', depth: 0 });
      e('recover_done', 1, { action: 'retry', ms: 500, depth: 0 });
      e('stage_start', 1, { attempt: 2 }, { ...ord, stage: 'account' });
      end(e);
    });
    expect(rules(ev)).toContain('R34');
  });

  it('accepts an in-stage retry that continues the same stage', () => {
    const ev = stream((e) => {
      start(e);
      e('order_start', 1, { index: 1, total: 1 }, ord);
      stage(e, 'account');
      e('stage_start', 1, { attempt: 1 }, { ...ord, stage: 'create' });
      e('stage_fail', 1, { error: 'x', retryable: true, attempt: 1 }, { ...ord, stage: 'create' });
      e('recover_start', 1, { action: 'retry', depth: 0 });
      e('recover_done', 1, { action: 'retry', ms: 500, depth: 0 });
      e('stage_done', 1, { ms: 700, skipped: false }, { ...ord, stage: 'create' });
      end(e);
    });
    // The order is left in flight at wave_end (R4); nothing else is wrong.
    expect(rules(ev)).toEqual(['R4']);
  });

  it('every event type has a schema definition that matches exactly one branch', () => {
    const samples: any[] = [
      { seq: 1, ts: 1, type: 'hello', contractVersion: 1, mode: 'mock', app: 'orders' },
      { seq: 2, ts: 1, type: 'reset', detail: {} },
      { seq: 3, ts: 1, type: 'wave_end', wave: 1, detail: { summary: {} } },
      { seq: 4, ts: 1, type: 'lane_ready', wave: 1, lane: 2, detail: { tier: 'retrier', label: 'Retrier', parts: ['retry'] } },
      { seq: 5, ts: 1, type: 'order_abandoned', wave: 1, lane: 2, order: 'ord-0003', detail: {} },
      { seq: 6, ts: 1, type: 'fix_applied', wave: 1, detail: { spec: 's', files: [{ path: 'a', add: 1, del: 0 }], recorded: true } },
    ];
    for (const s of samples) expect(matchesOneOf(s), s.type).toBe(true);
    expect(matchesOneOf({ seq: 1, ts: 1, type: 'wave_end', wave: 1, lane: 1, detail: { summary: {} } })).toBe(false);
  });
});
