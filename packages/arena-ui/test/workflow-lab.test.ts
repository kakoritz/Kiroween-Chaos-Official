import { describe, expect, it } from 'vitest';
import { labRun } from '../../haunt/src/lab/engine';
import { labToYaml } from '../../haunt/src/lab/model';
import { COMMANDS } from '../src/workflow-lab/panel';
import { blankStage, labFiles, matrixView, modelFromYaml, presetModel, setAllParts, setRole, worstFindings, PRESETS } from '../src/workflow-lab/model';

describe('workflow lab model (SH-U1)', () => {
  it('has the four presets from the spec plus the streaming pack', () => {
    expect(PRESETS.map((p) => p.label)).toEqual(['Orders', 'Inbox', 'Payments', 'Report generator', 'Streaming service (model-based pack)']);
    for (const p of PRESETS) expect(presetModel(p.id).stages.length).toBeGreaterThan(0);
  });
  it('preset copies do not share state', () => {
    const a = presetModel('orders'); a.stages[0]!.id = 'changed';
    expect(presetModel('orders').stages[0]!.id).toBe('account');
  });
  it('round trips pasted haunt.yaml', () => {
    const m = presetModel('payments');
    const r = modelFromYaml(labToYaml(m));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.model.stages.map((s) => [s.id, s.role])).toEqual(m.stages.map((s) => [s.id, s.role]));
  });
  it('reports yaml errors', () => {
    expect(modelFromYaml('name: x\nstages: nope').ok).toBe(false);
  });
  it('adds blank stages with a free id and drops effects on role change', () => {
    const m = presetModel('inbox');
    expect(m.stages.some((s) => s.id === blankStage(m).id)).toBe(false);
    expect(setRole(m.stages[2]!, 'work').effects).toBeUndefined();
    expect(setRole(m.stages[1]!, 'effect').effects?.length).toBe(1);
  });
  it('runs a preset with no protections and with all of them', async () => {
    const none = await labRun(setAllParts(presetModel('orders'), false));
    const all = await labRun(setAllParts({ ...presetModel('orders'), stages: presetModel('orders').stages.map((s) => ({ ...s, effects: s.effects?.map((e) => ({ ...e, keyed: true })) })) }, true));
    expect(none.grade).not.toBe('A');
    expect(all.reliability).toBeGreaterThan(none.reliability);
    expect(worstFindings(none).length).toBeGreaterThan(0);
    expect(none.suggestions.length).toBeGreaterThan(0);
    expect(none.label).toMatch(/Model-based/);
  });
  it('builds the matrix view and the export files', async () => {
    const r = await labRun(presetModel('inbox'));
    const mv = matrixView(r);
    expect(mv.stages).toEqual(presetModel('inbox').stages.map((s) => s.id));
    expect(mv.cell('fetch', 'no_such_fault')).toBe('na');
    const files = labFiles(r);
    expect(files.map((f) => f.name)).toEqual(['haunt.yaml', 'haunt-badge.svg', 'haunt-scorecard.svg', 'haunt-scorecard.html']);
    expect(files[0]!.text).toContain('name: inbox-lab');
    expect(files[1]!.text).toContain('<svg');
    expect(labFiles(r)).toEqual(files);
  });
});

describe('streaming pack preset (PK-UI)', () => {
  it('keeps pack labels through clone and shows them in the report lines', async () => {
    const { labRun } = await import('../../haunt/src/lab/engine');
    const { packLines, cloneModel } = await import('../src/workflow-lab/model');
    const m = presetModel('streaming');
    expect(cloneModel(m).pack?.id).toBe('streaming');
    const lines = packLines(await labRun(cloneModel(m)));
    expect(lines[0]).toMatch(/Haunted Stream.*model-based/);
    expect(lines.join('\n')).toMatch(/CDN Kraken/);
    expect(lines.join('\n')).toMatch(/Viewer rating/);
  });
  it('shows commands that exist in this repo (no bare haunt, no npx haunt)', () => {
    expect(COMMANDS.length).toBeGreaterThan(0);
    for (const c of COMMANDS) expect(c).toMatch(/^npm run haunt -- (init|validate|sweep)$/);
  });
});
