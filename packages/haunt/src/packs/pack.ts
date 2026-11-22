// Scenario packs (PK-C1): a pack is data (stages, faults, creature names, reviews, tiers). The engine builds a generic bot
// from the stages and the five parts (the Workflow Lab model). No node imports: this bundles for the browser.
// Spec: .kiro/specs/packs/spec.md sections 2 and 3.
import { LAB_CREATURE_IDS, LAB_PARTS, ROLES, validateLabModel, type LabModel, type LabPart, type LabStage, type LabPackMeta, type PackFault, type PackBoss } from '../lab/model';
import { parseYaml } from '../config/yaml';

export type { LabPackMeta, PackFault, PackBoss };
export interface Pack {
  id: string;
  title: string;
  modelBased: boolean;
  stages: LabStage[];
  ledger: { id: string }[];
  faults: PackFault[];
  curses: { id: string; endpoint: string }[];
  reviews: { label: string; subscores: string[] };
  bosses: PackBoss[];
  tiers: Partial<Record<LabPart, string>>;
}

/** The five tiers as part sets (rookie = none, phoenix = all). Same ladder as the sweep tiers. */
export const PACK_TIERS: Record<'rookie' | 'retrier' | 'journaler' | 'reconciler' | 'phoenix', Partial<Record<LabPart, boolean>>> = {
  rookie: {},
  retrier: { retry: true },
  journaler: { retry: true, journal: true },
  reconciler: { retry: true, journal: true, idempotency: true },
  phoenix: { retry: true, journal: true, idempotency: true, breaker: true, offline_queue: true },
};

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

interface RawPack { id: string; stages: { id: string; label: string; kind: LabStage['role']; effects?: { kind: string; keyed: boolean }[] }[] }
function stagesOf(r: RawPack): LabStage[] {
  return r.stages.map((s) => ({ id: s.id, label: s.label, role: s.kind, ...(s.effects ? { effects: s.effects.map((e) => ({ kind: e.kind, keyed: e.keyed })) } : {}) }));
}

/** Returns a list of problems; an empty list means the pack is valid. */
export function validatePack(raw: unknown): string[] {
  const errs: string[] = [];
  if (!isObj(raw)) return ['pack: expected a map'];
  if (!isStr(raw.id) || !/^[a-z0-9][a-z0-9_-]*$/.test(raw.id)) errs.push('id: lowercase letters, digits, dash or underscore');
  if (!isStr(raw.title)) errs.push('title: required text');
  if (!Array.isArray(raw.stages) || raw.stages.length === 0) { errs.push('stages: need at least one stage'); return errs; }
  const ids = new Set<string>();
  raw.stages.forEach((s, i) => {
    const p = `stages[${i}]`;
    if (!isObj(s)) { errs.push(`${p}: expected a map`); return; }
    if (!isStr(s.id) || !ID.test(s.id)) errs.push(`${p}.id: letters, digits, dash or underscore`);
    else if (ids.has(s.id)) errs.push(`${p}.id: duplicate "${s.id}"`);
    else ids.add(s.id);
    if (!ROLES.includes(s.kind as never)) errs.push(`${p}.kind: one of ${ROLES.join(' | ')}`);
    if (!isStr(s.label)) errs.push(`${p}.label: required text`);
  });
  const faultIds = new Set<string>();
  if (!Array.isArray(raw.faults) || raw.faults.length === 0) errs.push('faults: need at least one fault');
  else raw.faults.forEach((f, i) => {
    const p = `faults[${i}]`;
    if (!isObj(f)) { errs.push(`${p}: expected a map`); return; }
    if (!isStr(f.id) || !ID.test(f.id)) errs.push(`${p}.id: letters, digits, dash or underscore`);
    else if (faultIds.has(f.id)) errs.push(`${p}.id: duplicate "${f.id}"`);
    else faultIds.add(f.id);
    if (f.stage !== 'any' && !(isStr(f.stage) && ids.has(f.stage))) errs.push(`${p}.stage: must be a declared stage id or "any"`);
    if (!isStr(f.creature)) errs.push(`${p}.creature: required text`);
    if (!isStr(f.art) || !LAB_CREATURE_IDS.includes(f.art)) errs.push(`${p}.art: an existing creature id (${LAB_CREATURE_IDS.join(', ')})`);
    if (!isStr(f.mode)) errs.push(`${p}.mode: required text`);
    if (!isStr(f.behavior)) errs.push(`${p}.behavior: required text`);
  });
  if (!isObj(raw.reviews) || !isStr(raw.reviews.label) || !Array.isArray(raw.reviews.subscores) || raw.reviews.subscores.length === 0 || !raw.reviews.subscores.every(isStr)) {
    errs.push('reviews: need label and a list of subscores');
  }
  if (raw.ledger !== undefined && !(Array.isArray(raw.ledger) && raw.ledger.every((l) => isObj(l) && isStr(l.id)))) errs.push('ledger: list of {id}');
  if (raw.curses !== undefined && !(Array.isArray(raw.curses) && raw.curses.every((c) => isObj(c) && isStr(c.id) && isStr(c.endpoint)))) errs.push('curses: list of {id, endpoint}');
  if (raw.bosses !== undefined) {
    if (!Array.isArray(raw.bosses)) errs.push('bosses: expected a list');
    else raw.bosses.forEach((b, i) => {
      if (!isObj(b) || !isStr(b.id) || !Array.isArray(b.hits) || b.hits.length === 0) { errs.push(`bosses[${i}]: need id and hits`); return; }
      for (const h of b.hits) if (!ids.has(String(h))) errs.push(`bosses[${i}].hits: unknown stage "${String(h)}"`);
    });
  }
  if (!isObj(raw.tiers)) errs.push('tiers: map of part to text');
  else for (const [k, v] of Object.entries(raw.tiers)) {
    if (!(LAB_PARTS as readonly string[]).includes(k)) errs.push(`tiers.${k}: unknown part`);
    else if (!isStr(v)) errs.push(`tiers.${k}: required text`);
  }
  // the generic bot model built from the stages must itself be valid
  if (errs.length === 0) errs.push(...validateLabModel({ name: `${String(raw.id)}-lab`, stages: stagesOf(raw as unknown as RawPack) }).map((e) => `model: ${e}`));
  return errs;
}

export type PackResult = { ok: true; pack: Pack } | { ok: false; errors: string[] };

export function parsePack(text: string): PackResult {
  let raw: unknown;
  try { raw = parseYaml(text); } catch (e) { return { ok: false, errors: [(e as Error).message] }; }
  const errors = validatePack(raw);
  if (errors.length) return { ok: false, errors };
  const r = raw as Record<string, unknown> & RawPack;
  return {
    ok: true,
    pack: {
      id: r.id, title: String(r.title), modelBased: r.modelBased !== false, stages: stagesOf(r),
      ledger: (r.ledger as Pack['ledger']) ?? [], faults: r.faults as unknown as PackFault[], curses: (r.curses as Pack['curses']) ?? [],
      reviews: r.reviews as Pack['reviews'], bosses: (r.bosses as PackBoss[] | undefined) ?? [], tiers: r.tiers as Pack['tiers'],
    },
  };
}

export function packMeta(p: Pack): LabPackMeta {
  const creatures: Record<string, string> = {};
  for (const f of p.faults) if (!(f.art in creatures)) creatures[f.art] = f.creature;
  return { id: p.id, title: p.title, modelBased: p.modelBased, creatures, review: p.reviews, tiers: p.tiers, faults: p.faults, bosses: p.bosses };
}

/** The generic bot model for a pack: stages from the pack, parts from a tier (or none), labels carried along. */
export function packToLabModel(p: Pack, parts: Partial<Record<LabPart, boolean>> = {}): LabModel {
  return { name: `${p.id}-lab`, stages: p.stages.map((s) => ({ ...s, ...(s.effects ? { effects: s.effects.map((e) => ({ ...e })) } : {}) })), parts: { ...parts }, pack: packMeta(p) };
}
