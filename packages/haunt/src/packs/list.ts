import { EMBEDDED_PACKS } from './embedded';
import { parsePack } from './pack';

export interface PackSummary {
  id: string;
  title: string;
  modelBased: boolean;
  stages: { id: string; label: string }[];
  faults: { id: string; stage: string; creature: string; sprite?: string }[];
  reviews: { label: string };
}

/** Body of GET /api/packs: the shipped packs, parsed; a pack that fails to parse is skipped. */
export function listPacks(): PackSummary[] {
  const out: PackSummary[] = [];
  for (const text of Object.values(EMBEDDED_PACKS)) {
    const r = parsePack(text);
    if (!r.ok) continue;
    const p = r.pack;
    out.push({
      id: p.id, title: p.title, modelBased: p.modelBased,
      stages: p.stages.map((s) => ({ id: s.id, label: s.label ?? s.id })),
      faults: p.faults.map((f) => ({ id: f.id, stage: f.stage, creature: f.creature, ...(f.sprite ? { sprite: f.sprite } : {}) })),
      reviews: { label: p.reviews.label },
    });
  }
  return out;
}
