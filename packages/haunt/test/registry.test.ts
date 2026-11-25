// App registry. Spec: .kiro/specs/modular-engine (M1, R3).
import { afterEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { APPS, vocabOf, GENERIC_VOCAB } from '../src/shared/catalog';
import { getApp, isRegisteredApp, listApps, registerApp, unregisterApp, validateAppDef, onRegistryChange } from '../src/shared/registry';
import { registerAppFromDir } from '../src/config/register-dir';
import { APPS as LIVE_APPS, APP_STAGES, isAppId } from '../../core/src/live/catalog';

const COFFEE = resolve(__dirname, 'fixtures/apps/coffee');
afterEach(() => { unregisterApp('coffee'); unregisterApp('tiny'); });

describe('app registry', () => {
  // covers: modular-engine/R3.1
  it('lists the three built-in apps', () => {
    expect(listApps().map((a) => a.id)).toEqual(['orders', 'inbox', 'stream']);
    expect(isAppId('stream')).toBe(true);
    expect(isAppId('coffee')).toBe(false);
  });

  // covers: modular-engine/R3.2, R3.4
  it('registers an app from a folder and serves it in the app list and stage views', () => {
    const r = registerAppFromDir(COFFEE);
    expect(r.ok).toBe(true);
    expect(getApp('coffee')!.stages.map((s) => s.id)).toEqual(['read_request', 'pay', 'brew', 'ready']);
    expect(getApp('coffee')!.stages[1]!.effects[0]).toMatchObject({ kind: 'charge', key: 'charge:1' });
    expect(isAppId('coffee')).toBe(true);
    expect(LIVE_APPS.map((a) => a.id)).toContain('coffee');
    expect(LIVE_APPS.find((a) => a.id === 'coffee')!.label).toBe('Coffee Shop');
    expect(APP_STAGES.coffee!.map((s) => s.kind)).toEqual(['read', 'effect', 'read', 'effect']);
    expect(Object.keys(APP_STAGES)).toContain('coffee');
  });

  // covers: modular-engine/R3.1
  it('gives a registered app generic wording and its own id prefix', () => {
    registerAppFromDir(COFFEE);
    expect(vocabOf('coffee')).toMatchObject({ unit: GENERIC_VOCAB.unit, idPrefix: 'cof' });
    expect(vocabOf('nope').unit).toBe('order');
  });

  it('tells listeners when an app is added or removed', () => {
    let n = 0;
    const off = onRegistryChange(() => n++);
    registerAppFromDir(COFFEE);
    unregisterApp('coffee');
    off();
    expect(n).toBe(2);
  });

  it('never replaces or removes a built-in app', () => {
    expect(() => registerApp({ id: 'orders', label: 'X', stages: APPS.orders!.stages, orderPrefix: 'ord' })).toThrow(/built in/);
    expect(unregisterApp('orders')).toBe(false);
    expect(APPS.orders).toBeDefined();
  });

  // covers: modular-engine/R3.3
  it('fails a bad manifest with a message that names the file, the field and the fix', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'app-'));
    writeFileSync(resolve(dir, 'haunt.yaml'), 'name: tiny\nstart: x\nstages:\n  - { id: Bad-Id, label: B, role: input }\n  - { id: a, label: A, role: input }\n');
    const r = registerAppFromDir(dir);
    expect(r.ok).toBe(false);
    const text = !r.ok ? r.errors.join('\n') : '';
    expect(text).toContain('haunt.yaml');
    expect(text).toMatch(/stage "Bad-Id": use 2 to 32 lowercase/);
    expect(text).toMatch(/stage "a": use 2 to 32/);
    expect(isRegisteredApp('tiny')).toBe(false);
  });

  it('says so when the folder has no haunt.yaml', () => {
    const r = registerAppFromDir(mkdtempSync(resolve(tmpdir(), 'app-')));
    expect(!r.ok && r.errors[0]).toMatch(/needs a haunt.yaml/);
  });

  // covers: modular-engine/R1.1
  it('checks stage count, input-or-effect, and unique effect keys', () => {
    const st = (id: string, role: 'input' | 'work' | 'effect' = 'work', key?: string) => ({ id, label: id, icon: 'x', workAnimation: 'x', role, min: 1, max: 2, effects: key ? [{ kind: 'k', key, service: 'k' }] : [], verb: id });
    const base = { id: 'tiny', label: 'T', orderPrefix: 'tn' };
    expect(validateAppDef({ ...base, stages: [] })).toContain('stages: need at least one stage');
    expect(validateAppDef({ ...base, stages: [st('ab'), st('cd')] })).toContain('stages: need at least one input or effect stage');
    expect(validateAppDef({ ...base, stages: [st('ab', 'effect', 'k1'), st('cd', 'effect', 'k1')] }).join()).toMatch(/effect key "k1" is used twice/);
    expect(validateAppDef({ ...base, stages: Array.from({ length: 25 }, (_, i) => st(`s${String(i).padStart(2, '0')}`, 'input')) }).join()).toMatch(/at most 24/);
    expect(validateAppDef({ ...base, stages: [st('ab', 'input')] })).toEqual([]);
  });
});
