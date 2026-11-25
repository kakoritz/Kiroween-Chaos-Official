// Contract v1.3: any app declares its own stage ids and order prefix. Spec: .kiro/specs/modular-engine (M3, R1.1 to R1.4).
import { afterEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { schemaErrors, validateEvents } from '../src/contract/validate';
import { registerAppFromDir } from '../src/config/register-dir';
import { unregisterApp } from '../src/shared/registry';
import { laneTiers } from '../src/shared/catalog';
import { assembleWave, assignSeq, BASE_TS, planWave } from '../../core/src/sim/wave';

const COFFEE = resolve(__dirname, 'fixtures/apps/coffee');
afterEach(() => { unregisterApp('coffee'); });

const env = { seq: 1, ts: 1 };
describe('contract v1.3 schema', () => {
  // covers: modular-engine/R1.3
  it('accepts new stage ids and order prefixes, still rejects malformed ones', () => {
    expect(schemaErrors({ ...env, type: 'stage_start', wave: 1, lane: 1, order: 'cof-0001', stage: 'read_request', detail: { attempt: 1 } })).toEqual([]);
    expect(schemaErrors({ ...env, type: 'stage_start', wave: 1, lane: 1, order: 'cof-0001', stage: 'Bad-Id', detail: { attempt: 1 } }).length).toBeGreaterThan(0);
    expect(schemaErrors({ ...env, type: 'stage_start', wave: 1, lane: 1, order: 'COF-1', stage: 'brew', detail: { attempt: 1 } }).length).toBeGreaterThan(0);
  });

  // covers: modular-engine/R1.2
  it('hello may declare the app, its stages and their roles', () => {
    const hello = { ...env, type: 'hello', contractVersion: 1, contractMinor: 3, mode: 'live', app: 'coffee', stages: [{ id: 'read_request', label: 'Read request', role: 'input' }, { id: 'pay', label: 'Pay', role: 'effect', effects: [{ kind: 'charge', key: 'charge:1' }] }] };
    expect(schemaErrors(hello)).toEqual([]);
    expect(schemaErrors({ ...hello, stages: [] }).length).toBeGreaterThan(0);
    expect(schemaErrors({ ...hello, app: 'Coffee Shop' }).length).toBeGreaterThan(0);
  });
});

describe('contract v1.3 validator', () => {
  // covers: modular-engine/R1.2, R5.2
  it('a wave of a registered app passes with zero violations, also when the validator does not know the app', () => {
    registerAppFromDir(COFFEE);
    const spec = { app: 'coffee', tiers: laneTiers(5, 'race'), tiersMode: 'race' as const, orders: 3, seed: 7, pace: 1 as const };
    const wave = assignSeq(assembleWave(planWave(spec), BASE_TS));
    const events = wave.some((e) => e.type === 'hello' && (e as { stages?: unknown }).stages) ? wave : [{ ...env, type: 'hello', contractVersion: 1, mode: 'mock', app: 'coffee', stages: [{ id: 'read_request', label: 'Read request', role: 'input' }, { id: 'pay', label: 'Pay', role: 'effect' }, { id: 'brew', label: 'Brew', role: 'work' }, { id: 'ready', label: 'Tell customer', role: 'effect' }] } as never, ...wave.filter((e) => e.type !== 'hello')];
    expect(validateEvents(events as never)).toEqual([]);
    const ids = new Set(wave.filter((e) => e.stage).map((e) => e.stage));
    expect([...ids].sort()).toEqual(['brew', 'pay', 'read_request', 'ready']);
    expect(wave.find((e) => e.order)!.order).toMatch(/^cof-\d{4}$/);
    unregisterApp('coffee');
    expect(validateEvents(events as never)).toEqual([]);
  });
});
