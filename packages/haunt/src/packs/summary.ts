// PK-U1 (Core side): the packs the app switcher can list. Pure and browser-safe: it reads the embedded copies of packs/*/pack.yaml.
import { EMBEDDED_PACKS } from './embedded';
import { parsePack, packMeta } from './pack';

/** One entry of `GET /api/packs`. Additive to the contract; see docs/CORE-API-NOTES.md. */
export interface PackSummary {
  id: string;
  title: string;
  /** True when results come from rules over declared protections, not a runnable app. The switcher shows a "model-based" tag. */
  modelBased: boolean;
  /** The runnable app that backs the pack (an id of `GET /api/apps`), or null for a pack that only runs in the lab. */
  app: 'orders' | 'inbox' | null;
  stages: { id: string; label: string; kind: string }[];
  /** Creature art id to the creature's name in this pack. */
  creatures: Record<string, string>;
  faults: number;
  reviewLabel: string;
}

/** Packs whose own app exists in the live server. A pack not listed here is lab-only. */
const PACK_APP: Readonly<Record<string, 'orders' | 'inbox'>> = { ticketing: 'inbox' };

export function listPackSummaries(): PackSummary[] {
  const out: PackSummary[] = [];
  for (const id of Object.keys(EMBEDDED_PACKS).sort()) {
    const r = parsePack(EMBEDDED_PACKS[id]!);
    if (!r.ok) continue;
    const p = r.pack;
    out.push({
      id: p.id, title: p.title, modelBased: p.modelBased, app: PACK_APP[p.id] ?? null,
      stages: p.stages.map((s) => ({ id: s.id, label: s.label ?? s.id, kind: s.role })),
      creatures: packMeta(p).creatures, faults: p.faults.length, reviewLabel: p.reviews.label,
    });
  }
  return out;
}
