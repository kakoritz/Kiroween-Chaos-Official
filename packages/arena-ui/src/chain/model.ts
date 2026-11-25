// Chain wizard model (modular-engine R12.3, R12.6): an ordered list of blocks and custom stages. Pure, no DOM.
// The wizard and a haunt.yaml are two views of the same flow: `toYaml` writes the manifest, `fromConfig` reads one back.
import { BLOCKS, blockById, type Block } from '../../../haunt/src/blocks/library';
import { parseHauntConfig, type HauntConfig, type StageRole } from '../../../haunt/src/config/haunt-config';

export interface ChainStage {
  /** Library block id; absent for a custom stage. */
  use?: string;
  id: string;
  label: string;
  role: StageRole;
  /** Custom stage only: the effect kind (one provider kind, for example charge). */
  effectKind?: string;
}
export interface ChainModel { name: string; stages: ChainStage[] }

export const emptyChain = (name = 'my-chain'): ChainModel => ({ name, stages: [] });

const uniqueId = (m: ChainModel, base: string): string => {
  const ids = new Set(m.stages.map((s) => s.id));
  if (!ids.has(base)) return base;
  for (let i = 2; ; i++) if (!ids.has(`${base}_${i}`)) return `${base}_${i}`;
};

export function addBlock(m: ChainModel, blockId: string): ChainModel {
  const b = blockById(blockId);
  if (!b) return m;
  return { ...m, stages: [...m.stages, { use: b.id, id: uniqueId(m, b.id), label: b.label, role: b.role }] };
}

export function addCustom(m: ChainModel, id: string, role: StageRole, effectKind = 'store'): ChainModel {
  const clean = id.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^[^a-z]+/, '').replace(/_+$/, '');
  if (clean.length < 2) return m;
  return { ...m, stages: [...m.stages, { id: uniqueId(m, clean), label: clean.replace(/_/g, ' '), role, ...(role === 'effect' ? { effectKind } : {}) }] };
}

export function move(m: ChainModel, from: number, to: number): ChainModel {
  if (from === to || from < 0 || to < 0 || from >= m.stages.length || to >= m.stages.length) return m;
  const stages = [...m.stages];
  const [x] = stages.splice(from, 1);
  stages.splice(to, 0, x!);
  return { ...m, stages };
}

export const removeAt = (m: ChainModel, i: number): ChainModel => ({ ...m, stages: m.stages.filter((_, k) => k !== i) });

export function rename(m: ChainModel, i: number, id: string): ChainModel {
  const clean = id.trim();
  if (!/^[a-z][a-z0-9_]{1,31}$/.test(clean) || m.stages.some((s, k) => k !== i && s.id === clean)) return m;
  return { ...m, stages: m.stages.map((s, k) => (k === i ? { ...s, id: clean } : s)) };
}

/** Problems that stop a chain from running; an empty list means it can be tested. */
export function chainProblems(m: ChainModel): string[] {
  const errs: string[] = [];
  if (m.stages.length === 0) errs.push('Add at least one block.');
  if (m.stages.length > 24) errs.push('A chain has at most 24 stages.');
  if (m.stages.length > 0 && !m.stages.some((s) => s.role === 'input' || s.role === 'effect')) errs.push('Add an input or an effect block: a chain of only work and polls changes nothing outside.');
  return errs;
}

/** The haunt.yaml text of the chain: library blocks as `use:`, custom stages inline. */
export function toYaml(m: ChainModel): string {
  const out = [`name: ${m.name || 'my-chain'}`, 'start: node dist/bot.js', 'truth: http://127.0.0.1:7071', 'stages:'];
  for (const s of m.stages) {
    if (s.use) out.push(`  - { use: ${s.use}, id: ${s.id}${blockById(s.use)?.label !== s.label ? `, label: ${JSON.stringify(s.label)}` : ''} }`);
    else if (s.role === 'effect') out.push(`  - { id: ${s.id}, label: ${JSON.stringify(s.label)}, role: effect, effects: [{ kind: ${s.effectKind ?? 'store'}, key: "${s.id}:1", idempotent: required }] }`);
    else out.push(`  - { id: ${s.id}, label: ${JSON.stringify(s.label)}, role: ${s.role} }`);
  }
  return out.join('\n') + '\n';
}

/** The runnable config of a chain (blocks expanded), or the errors. */
export function toConfig(m: ChainModel): { ok: true; config: HauntConfig } | { ok: false; errors: string[] } {
  const p = chainProblems(m);
  if (p.length) return { ok: false, errors: p };
  const r = parseHauntConfig(toYaml(m));
  return r.ok ? { ok: true, config: r.config } : { ok: false, errors: r.errors };
}

/** A chain from a manifest (the other view): stages with a block come back as that block. */
export function fromConfig(c: HauntConfig): ChainModel {
  return {
    name: c.name,
    stages: c.stages.map((s) => ({ ...(s.block ? { use: s.block } : {}), id: s.id, label: s.label, role: s.role, ...(!s.block && s.role === 'effect' ? { effectKind: s.effects[0]?.kind ?? 'store' } : {}) })),
  };
}

export const libraryByRole = (): Record<string, Block[]> => {
  const out: Record<string, Block[]> = { input: [], work: [], effect: [], poll: [], final: [] };
  for (const b of BLOCKS) out[b.role]!.push(b);
  return out;
};
