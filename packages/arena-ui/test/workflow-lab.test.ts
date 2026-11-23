import { describe, expect, it } from 'vitest';
import { labRun } from '../../haunt/src/lab/engine';
import { labToYaml } from '../../haunt/src/lab/model';
import { blankStage, labFiles, matrixView, modelFromYaml, presetModel, setAllParts, setRole, worstFindings, PRESETS } from '../src/workflow-lab/model';

describe('workflow lab model (SH-U1)', () => {
  it('has the four presets from the spec plus the streaming and ticketing packs; Payments is the third', () => {
    expect(PRESETS.map((p) => p.label)).toEqual(['Orders', 'Inbox', 'Payments', 'Report generator', 'Streaming service (model-based pack)', 'Ticket desk (model-based pack)']);
    expect(PRESETS[2]!.id).toBe('payments');
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
});

describe('pack report views (PK-UI)', () => {
  it('shows pack title, creatures, review sub-scores, bosses, curses and R1..R8 suggestions for the ticket desk', async () => {
    const { labRun } = await import('../../haunt/src/lab/engine');
    const { packLines, reviewView, scenarioLines, suggestionViews, RULE_TEXT, cloneModel } = await import('../src/workflow-lab/model');
    const r = await labRun(cloneModel(presetModel('ticketing')));
    const lines = packLines(r).join('\n');
    expect(lines).toMatch(/Haunted Desk.*model-based/);
    expect(lines).toMatch(/Zombie horde/);
    const rv = reviewView(r)!;
    expect(rv.label).toBe('Requester CSAT');
    expect(rv.scores.map((s) => s.id)).toEqual(['first_response', 'resolution_time', 'reassignments', 'sla', 'ease']);
    expect(rv.scores.every((s) => s.glyphs.length === 5)).toBe(true);
    expect(scenarioLines(r).join('\n')).toMatch(/Boss Queue Lich/);
    expect(scenarioLines(r).join('\n')).toMatch(/Curse cursed tracker on assign/);
    const sv = suggestionViews(r);
    expect(sv.length).toBeGreaterThan(0);
    for (const s of sv) for (const rule of s.rules) expect(RULE_TEXT[rule.id]).toBe(rule.text);
    const idem = sv.find((s) => s.part === 'idempotency')!;
    expect(idem.rules.map((x) => x.id)).toContain('R1');
    expect(idem.domain).toMatch(/external ticket id/);
    expect(Object.keys(RULE_TEXT)).toEqual(['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8']);
  });
  it('plain presets have no review or scenarios, and the export still carries haunt.yaml', async () => {
    const { labRun } = await import('../../haunt/src/lab/engine');
    const { reviewView, scenarioLines } = await import('../src/workflow-lab/model');
    const r = await labRun(presetModel('payments'));
    expect(reviewView(r)).toBeNull();
    expect(scenarioLines(r)).toEqual([]);
    expect(labFiles(r)[0]!.text).toContain('name: payments-lab');
    expect(r.commands).toEqual(['npm run haunt -- init', 'npm run haunt -- validate', 'npm run haunt -- sweep']);
  });
});
