// "Save as block" in the Chain Wizard (second build list, item 2): a custom stage becomes a block in your own library, kept in this browser.
// The repo-wide library stays as it is; `npm run block:add` is the way to put a block into a checkout. Pure of the DOM: storage is passed in.
import { BLOCKS, blockById, registerBlock, validateBlock, type Block } from '../../../haunt/src/blocks/library';
import type { ChainStage } from './model';

export const MY_BLOCKS_KEY = 'haunt:my-blocks';
const mine = new Set<string>();
export const isMine = (id: string): boolean => mine.has(id);
export const myBlockIds = (): string[] => [...mine];

const DURATION: Record<string, [number, number]> = { input: [300, 600], work: [600, 1200], effect: [400, 800], poll: [800, 1600], final: [300, 600] };

/** The block a custom stage describes. */
export function blockFromStage(s: ChainStage): Block {
  const effects = s.role === 'effect' ? [{ kind: s.effectKind ?? 'store', key: `${s.id}:1`, idempotent: 'required' as const }] : [];
  return { id: s.id, label: s.label, role: s.role, about: 'Your own block.', effects, duration: DURATION[s.role] ?? [400, 800] };
}

export interface MyStore { getItem(k: string): string | null; setItem(k: string, v: string): void }

const readAll = (store: MyStore): Block[] => { try { const v = JSON.parse(store.getItem(MY_BLOCKS_KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };

/** Adds the stage to the library now and to the browser's storage for next time. Returns the problems, or none. */
export function saveMyBlock(s: ChainStage, store: MyStore): { ok: true; block: Block } | { ok: false; errors: string[] } {
  if (s.use) return { ok: false, errors: [`"${s.id}" already comes from the block "${s.use}".`] };
  const block = blockFromStage(s);
  const errs = validateBlock(block);
  if (blockById(block.id)) errs.push(`id: "${block.id}" is already a block; rename the stage first`);
  if (errs.length > 0) return { ok: false, errors: errs };
  registerBlock(block);
  mine.add(block.id);
  try { store.setItem(MY_BLOCKS_KEY, JSON.stringify([...readAll(store).filter((b) => b.id !== block.id), block])); } catch { /* storage full or blocked: the block still works until the page closes */ }
  return { ok: true, block };
}

/** Puts the blocks saved in an earlier visit back into the library. A bad or clashing entry is skipped. */
export function loadMyBlocks(store: MyStore): number {
  let n = 0;
  for (const b of readAll(store)) {
    if (!b || typeof b !== 'object' || blockById(b.id) || validateBlock(b).length > 0) continue;
    registerBlock(b);
    mine.add(b.id);
    n++;
  }
  return n;
}

/** For tests: forget this page's own blocks. */
export function forgetMyBlocks(): void { for (const id of mine) { const i = BLOCKS.findIndex((b) => b.id === id); if (i >= 0) BLOCKS.splice(i, 1); } mine.clear(); }
