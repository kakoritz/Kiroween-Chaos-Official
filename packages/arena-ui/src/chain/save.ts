// Save and share a chain (chain-wizard-v2 R5): the chain lives in the link, and downloads as haunt.yaml.
import { blockById } from '../../../haunt/src/blocks/library';
import type { StageRole } from '../../../haunt/src/config/haunt-config';
import type { ChainModel, ChainStage } from './model';

const ROLES: StageRole[] = ['input', 'work', 'effect', 'poll', 'final'];
type Packed = { n: string; s: Array<[string, string, string, string, string]> };

const b64 = (t: string): string => btoa(unescape(encodeURIComponent(t))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (t: string): string => decodeURIComponent(escape(atob(t.replace(/-/g, '+').replace(/_/g, '/'))));

/** The part after `#c=` in a share link. */
export function encodeChain(m: ChainModel): string {
  const p: Packed = { n: m.name, s: m.stages.map((s) => [s.use ?? '', s.id, s.label, s.role, s.effectKind ?? '']) };
  return b64(JSON.stringify(p));
}

/** The chain from a share link, or undefined when it is damaged or names an unknown block. Never throws. */
export function decodeChain(text: string): ChainModel | undefined {
  try {
    const p = JSON.parse(unb64(text.replace(/^#?c=/, ''))) as Packed;
    if (typeof p.n !== 'string' || !Array.isArray(p.s) || p.s.length > 24) return undefined;
    const stages: ChainStage[] = [];
    for (const r of p.s) {
      if (!Array.isArray(r) || r.some((x) => typeof x !== 'string')) return undefined;
      const [use, id, label, role, kind] = r;
      if (!/^[a-z][a-z0-9_]{1,31}$/.test(id!) || !ROLES.includes(role as StageRole)) return undefined;
      if (use && !blockById(use)) return undefined;
      stages.push({ ...(use ? { use } : {}), id: id!, label: label!.slice(0, 60), role: role as StageRole, ...(kind ? { effectKind: kind } : {}) });
    }
    return { name: p.n.slice(0, 60), stages };
  } catch { return undefined; }
}

export const shareUrl = (base: string, m: ChainModel): string => `${base.split('#')[0]}#c=${encodeChain(m)}`;
export const yamlFileName = (m: ChainModel): string => `${(m.name || 'my-chain').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'my-chain'}.haunt.yaml`;
