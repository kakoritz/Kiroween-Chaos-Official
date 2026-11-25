// Block library and `use:` composition. Spec: .kiro/specs/modular-engine (M5, R4).
import { describe, expect, it } from 'vitest';
import { BLOCKS, PROVIDER_KINDS, blockById } from '../src/blocks/library';
import { parseHauntConfig } from '../src/config/haunt-config';
import { appFromConfig, validateAppDef } from '../src/shared/registry';

const yaml = (stages: string) => `name: shop\nstart: x\ntruth: http://127.0.0.1:7071\nstages:\n${stages}`;

describe('block library', () => {
  // covers: modular-engine/R4.1
  it('has 16 or more blocks over all four roles, each valid', () => {
    expect(BLOCKS.length).toBeGreaterThanOrEqual(16);
    expect(new Set(BLOCKS.map((b) => b.role))).toEqual(new Set(['input', 'work', 'effect', 'poll', 'final']));
    const ids = new Set<string>();
    for (const b of BLOCKS) {
      expect(ids.has(b.id), `duplicate ${b.id}`).toBe(false);
      ids.add(b.id);
      expect(b.id).toMatch(/^[a-z][a-z0-9_]{1,31}$/);
      expect(b.duration[0]).toBeLessThanOrEqual(b.duration[1]);
      if (b.effects.length) expect(b.role).toBe('effect');
      if (b.role === 'effect') expect(b.effects.length, b.id).toBeGreaterThan(0);
      for (const e of b.effects) expect(PROVIDER_KINDS, `${b.id} kind ${e.kind}`).toContain(e.kind);
    }
  });

  it('effect keys are unique across the library defaults per kind and block', () => {
    const keys = BLOCKS.flatMap((b) => b.effects.map((e) => e.key));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('use: composition in haunt.yaml', () => {
  // covers: modular-engine/R4.2
  it('takes label, role, effects and duration from the block and lets the stage override them', () => {
    const r = parseHauntConfig(yaml('  - { use: read_request }\n  - { use: charge, id: pay }\n  - { use: transform, label: Brew, duration: [100, 200] }\n  - { use: notify, id: ready }\n'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [a, b, c, d] = r.config.stages;
    expect(a).toMatchObject({ id: 'read_request', role: 'input', block: 'read_request' });
    expect(b).toMatchObject({ id: 'pay', label: 'Take payment', role: 'effect', block: 'charge' });
    expect(b!.effects[0]).toMatchObject({ kind: 'charge', key: 'charge:1', idempotent: 'required' });
    expect(c).toMatchObject({ id: 'transform', label: 'Brew', duration: [100, 200] });
    expect(d!.effects[0]!.kind).toBe('notify');
  });

  // covers: modular-engine/R4.2
  it('a block used twice gets its own id and effect key', () => {
    const r = parseHauntConfig(yaml('  - { use: read_request }\n  - { use: charge }\n  - { use: charge }\n  - { use: charge, id: tip, key: "tip:1" }\n'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.stages.map((s) => s.id)).toEqual(['read_request', 'charge', 'charge_2', 'tip']);
    expect(r.config.stages.slice(1).map((s) => s.effects[0]!.key)).toEqual(['charge:1', 'charge:1:2', 'tip:1']);
    expect(validateAppDef(appFromConfig(r.config))).toEqual([]);
  });

  // covers: modular-engine/R4.3
  it('inline stages and block stages mix in one app', () => {
    const r = parseHauntConfig(yaml('  - { use: read_request }\n  - { id: brew, label: Brew, role: work }\n  - { use: confirm }\n'));
    expect(r.ok).toBe(true);
  });

  it('an unknown block names the field and points at the list', () => {
    const r = parseHauntConfig(yaml('  - { use: teleport }\n'));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.join()).toMatch(/stages\[0\]\.use: unknown block "teleport" \(see docs\/BLOCKS.md/);
  });

  it('blockById finds a block', () => { expect(blockById('charge')?.role).toBe('effect'); expect(blockById('nope')).toBeUndefined(); });
});

import { LAB_PRESETS, configToLab, labToYaml, validateLabModel } from '../src/lab/model';

describe('the Lab and the manifest are two views of one thing', () => {
  // covers: modular-engine/R4.5
  it('every preset exports to a manifest that loads, and loads back into the same Lab model', () => {
    for (const [id, model] of Object.entries(LAB_PRESETS)) {
      const r = parseHauntConfig(labToYaml(model));
      expect(r.ok, `${id}: ${!r.ok ? r.errors.join() : ''}`).toBe(true);
      if (!r.ok) continue;
      const back = configToLab(r.config);
      expect(validateLabModel(back), id).toEqual([]);
      expect(back.stages.map((s) => [s.id, s.role])).toEqual(model.stages.map((s) => [s.id, s.role]));
      expect(back.stages.map((s) => (s.effects ?? []).map((e) => [e.kind, e.keyed]))).toEqual(model.stages.map((s) => (s.role === 'effect' ? s.effects ?? [] : []).map((e) => [e.kind, e.keyed])));
    }
  });

  // covers: modular-engine/R4.5
  it('a flow made of blocks opens in the Lab', () => {
    const r = parseHauntConfig(yaml('  - { use: read_request }\n  - { use: charge }\n  - { use: confirm }\n'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(validateLabModel(configToLab(r.config))).toEqual([]);
  });
});

import { BLOCKS as ALL_BLOCKS } from '../src/blocks/library';
import { aloneId, blockAsApp, blockAsConfig } from '../src/blocks/alone';
import { registerApp, unregisterApp } from '../src/shared/registry';
import { FAULTS, faultFacesStage } from '../src/chaos/catalog';

describe('block-alone mode', () => {
  // covers: modular-engine/R4.6
  it('every block runs alone as a one-stage app that takes the faults of its role', () => {
    for (const b of ALL_BLOCKS) {
      const app = blockAsApp(b.id)!;
      expect(app.stages.map((s) => s.id)).toEqual([b.id]);
      expect(validateAppDef(app, { alone: true }), b.id).toEqual([]);
      registerApp(app, undefined, { alone: true });
      const faults = FAULTS.filter((f) => faultFacesStage(f, b.id, app.id)).map((f) => f.id);
      expect(faults, `${b.id} (${b.role})`).toEqual(expect.arrayContaining(['crash', 'disk_full']));
      if (b.role === 'effect') expect(faults).toEqual(expect.arrayContaining(['http_500', 'timeout']));
      if (b.role === 'input') expect(faults).toContain('missing_file');
      unregisterApp(app.id);
    }
  });
  it('knows its ids and refuses an unknown block', () => {
    expect(aloneId('read_request')).toBe('block-read-request');
    expect(blockAsConfig('teleport')).toBeNull();
  });
});
