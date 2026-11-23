import { describe, expect, it } from 'vitest';
import { LAB_PRESETS, labRun, labToConfig, labToYaml, labFaultsKnown, installLab, validateLabModel, type LabModel } from '../src/lab';
import { validateHauntConfig } from '../src/config/haunt-config';
import { parseYaml } from '../src/config/yaml';

const ALL = { retry: true, journal: true, idempotency: true, breaker: true, offline_queue: true };
const keyed = (m: LabModel): LabModel => ({ ...m, stages: m.stages.map((s) => ({ ...s, effects: s.effects?.map((e) => ({ ...e, keyed: true })) })) });

describe('workflow lab engine', () => {
  it('uses only faults that exist in the catalog', () => expect(labFaultsKnown()).toBe(true));

  it('grades an unprotected orders bot low and names the parts to add', async () => {
    const r = await labRun(LAB_PRESETS.orders!);
    expect(['D', 'F']).toContain(r.grade);
    expect(r.modelBased).toBe(true);
    expect(r.label).toMatch(/Model-based/);
    const parts = r.suggestions.map((s) => s.part);
    expect(parts).toEqual(expect.arrayContaining(['idempotency', 'journal', 'retry', 'offline_queue']));
    expect(r.suggestions.find((s) => s.part === 'idempotency')!.rules).toContain('R1');
    expect(r.suggestions.find((s) => s.part === 'offline_queue')!.rules).toEqual(expect.arrayContaining(['R4']));
    expect(r.gradeWithSuggestions).toBe('A');
  });

  it('grades the fully protected, keyed bot A with no suggestions', async () => {
    const r = await labRun({ ...keyed(LAB_PRESETS.orders!), parts: ALL });
    expect(r.grade).toBe('A');
    expect(r.suggestions).toEqual([]);
    expect(r.findings).toEqual([]);
  });

  it('asks for a key when idempotency is on but an effect has none', async () => {
    const r = await labRun({ ...LAB_PRESETS.orders!, parts: ALL });
    const s = r.suggestions.find((x) => x.part === 'idempotency');
    expect(s?.alreadyOn).toBe(true);
    expect(s?.how).toMatch(/payment\.charge/);
  });

  it('a retry without a key repeats the charge on timeout (R1)', async () => {
    const r = await labRun({ ...LAB_PRESETS.payments!, parts: { retry: true } });
    const cell = r.cells.find((c) => c.stage === 'charge' && c.creature === 'zombie')!;
    expect(cell.outcome).toBe('repeat');
    expect(cell.repeatedKinds).toContain('charge');
    expect(['C', 'D', 'F']).toContain(r.grade);
  });

  it('is deterministic and fast', async () => {
    const a = await labRun(LAB_PRESETS.inbox!);
    const b = await labRun(LAB_PRESETS.inbox!);
    expect({ ...a, elapsedMs: 0 }).toEqual({ ...b, elapsedMs: 0 });
    expect(a.elapsedMs).toBeLessThan(10000);
  });

  it('every preset sweeps and improves when the suggestions are applied', async () => {
    for (const m of Object.values(LAB_PRESETS)) {
      const r = await labRun(m);
      expect(r.gradeWithSuggestions <= r.grade).toBe(true);
      expect(r.matrix.totals.pending).toBe(0);
    }
  });

  it('rejects a bad model', async () => {
    expect(validateLabModel({ name: 'x', stages: [] })).not.toEqual([]);
    await expect(labRun({ name: 'x y', stages: [{ id: 'a', role: 'work' }] })).rejects.toThrow(/invalid lab model/);
    expect(validateLabModel({ name: 'x', stages: [{ id: 'a', role: 'work', effects: [{ kind: 'k', keyed: true }] }] })[0]).toMatch(/only on role/);
  });
});

describe('lab haunt.yaml export', () => {
  it('round-trips through the real parser and validator for every preset', () => {
    for (const m of Object.values(LAB_PRESETS)) {
      const res = validateHauntConfig(parseYaml(labToYaml(m)));
      expect(res.ok, JSON.stringify(res)).toBe(true);
      if (res.ok) expect(res.config.stages.map((s) => s.id)).toEqual(labToConfig(m).stages.map((s) => s.id));
    }
  });

  it('returns the yaml and the three real commands in the report', async () => {
    const r = await labRun(LAB_PRESETS.report!);
    expect(r.yaml).toContain('stages:');
    expect(r.commands).toEqual(['npm run haunt -- init', 'npm run haunt -- validate', 'npm run haunt -- sweep']);
  });
});

describe('lab in-page entry', () => {
  it('installs window.__hauntLab.labRun', async () => {
    const w: { __hauntLab?: { labRun: typeof labRun } } = {};
    installLab(w);
    expect((await w.__hauntLab!.labRun(LAB_PRESETS.inbox!)).name).toBe('inbox-lab');
  });
});
