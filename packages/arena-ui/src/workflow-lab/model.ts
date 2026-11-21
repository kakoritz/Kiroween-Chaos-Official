// SH-U1: pure model for the Workflow Lab page. No DOM and no network, so it is unit tested.
// The engine (SH-C3) is model-based: results come from rules over declared protections, not from real code.
import { parseHauntConfig } from '../../../haunt/src/config/haunt-config';
import type { LabReport } from '../../../haunt/src/lab/engine';
import { LAB_PARTS, LAB_PRESETS, ROLES, validateLabModel, type LabModel, type LabPart, type LabStage } from '../../../haunt/src/lab/model';
import { shareFiles } from '../share/share-model';

export { LAB_PARTS, ROLES };
export type { LabModel, LabPart, LabReport, LabStage };

export const PRESETS: readonly { id: string; label: string }[] = [
  { id: 'orders', label: 'Orders' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'payments', label: 'Payments' },
  { id: 'report', label: 'Report generator' },
];

export const PART_LABEL: Record<LabPart, string> = {
  retry: 'Retry', journal: 'Journal', idempotency: 'Idempotency keys', breaker: 'Circuit breaker', offline_queue: 'Offline queue',
};

export const HONEST_LABEL = 'Model-based what-if. Results come from rules over the protections you declare, not from running your real code.';

export function cloneModel(m: LabModel): LabModel {
  return {
    name: m.name,
    stages: m.stages.map((s) => ({ ...s, ...(s.effects ? { effects: s.effects.map((e) => ({ ...e })) } : {}) })),
    parts: { ...(m.parts ?? {}) },
    ...(m.seed !== undefined ? { seed: m.seed } : {}),
  };
}

export function presetModel(id: string): LabModel {
  const p = LAB_PRESETS[id] ?? LAB_PRESETS.orders!;
  return cloneModel(p);
}

/** A new blank stage with an id that is not taken yet. */
export function blankStage(m: LabModel): LabStage {
  let n = m.stages.length + 1;
  const ids = new Set(m.stages.map((s) => s.id));
  while (ids.has(`step${n}`)) n++;
  return { id: `step${n}`, label: `Step ${n}`, role: 'work' };
}

/** Switching a stage role keeps effects only on the "effect" role (the engine rejects them elsewhere). */
export function setRole(s: LabStage, role: LabStage['role']): LabStage {
  const next: LabStage = { id: s.id, role, ...(s.label !== undefined ? { label: s.label } : {}) };
  if (role === 'effect') next.effects = s.effects && s.effects.length ? s.effects : [{ kind: 'effect', keyed: false }];
  return next;
}

export type YamlResult = { ok: true; model: LabModel } | { ok: false; errors: string[] };

/** Turns pasted haunt.yaml text into a lab model. Protections start off: yaml does not declare them. */
export function modelFromYaml(text: string): YamlResult {
  const r = parseHauntConfig(text);
  if (!r.ok) return { ok: false, errors: r.errors };
  const model: LabModel = {
    name: r.config.name,
    stages: r.config.stages.map((s) => ({
      id: s.id,
      label: s.label,
      role: s.role,
      ...(s.role === 'effect' ? { effects: s.effects.map((e) => ({ kind: e.kind, keyed: e.idempotent === 'required' })) } : {}),
    })),
    parts: {},
  };
  const errs = validateLabModel(model);
  return errs.length ? { ok: false, errors: errs } : { ok: true, model };
}

export function setAllParts(m: LabModel, on: boolean): LabModel {
  const parts: Partial<Record<LabPart, boolean>> = {};
  for (const p of LAB_PARTS) parts[p] = on;
  return { ...m, parts };
}

export interface MatrixView { stages: string[]; faults: string[]; cell(stage: string, fault: string): string }

/** Stage by fault grid from the sweep cells. The worst outcome wins when a pair has several creatures. */
export function matrixView(report: Pick<LabReport, 'cells'>): MatrixView {
  const stages: string[] = [];
  const faults: string[] = [];
  const rank = ['na', 'pass', 'recovered_late', 'repeat', 'fail', 'halt'];
  const map = new Map<string, string>();
  for (const c of report.cells) {
    if (!stages.includes(c.stage)) stages.push(c.stage);
    if (!faults.includes(c.fault)) faults.push(c.fault);
    const k = `${c.stage}\u0000${c.fault}`;
    const prev = map.get(k);
    if (prev === undefined || rank.indexOf(c.outcome) > rank.indexOf(prev)) map.set(k, c.outcome);
  }
  return { stages, faults, cell: (s, f) => map.get(`${s}\u0000${f}`) ?? 'na' };
}

export function worstFindings(report: Pick<LabReport, 'findings'>, n = 5): LabReport['findings'] {
  const sev: Record<string, number> = { high: 0, medium: 1, low: 2 };
  return [...report.findings].sort((a, b) => (sev[a.severity] ?? 3) - (sev[b.severity] ?? 3) || (a.id < b.id ? -1 : 1)).slice(0, n);
}

export interface LabFile { name: string; mime: string; label: string; text: string }

/** haunt.yaml, badge and scorecard for one lab report. */
export function labFiles(report: LabReport): LabFile[] {
  return [
    { name: 'haunt.yaml', mime: 'text/yaml', label: 'haunt.yaml', text: report.yaml },
    ...shareFiles(report).map((f) => ({ name: f.name as string, mime: f.mime, label: f.label, text: f.text })),
  ];
}
