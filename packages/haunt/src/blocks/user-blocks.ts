// Custom blocks on disk (modular-engine R13.3): `blocks/user.yaml` is a list of blocks next to the built-in library. Node only.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseYaml } from '../config/yaml';
import { loadHauntConfig } from '../config/load';
import { blockById, registerBlock, validateBlock, type Block } from './library';

export const USER_BLOCKS_FILE = (root = process.cwd()): string => resolve(root, 'blocks', 'user.yaml');

/** Registers every block of the file. Returns the problems per block; a bad block is skipped, never half-added. */
export function loadUserBlocks(file = USER_BLOCKS_FILE()): string[] {
  if (!existsSync(file)) return [];
  let list: unknown;
  try { list = parseYaml(readFileSync(file, 'utf8')); } catch (e) { return [`${file}: ${(e as Error).message}`]; }
  const errs: string[] = [];
  for (const b of Array.isArray(list) ? list : []) {
    try { if (!blockById((b as Block).id)) registerBlock(b as Block); } catch (e) { errs.push(`${file}: ${(e as Error).message}`); }
  }
  return errs;
}

const line = (b: Block): string => `- { id: ${b.id}, label: ${JSON.stringify(b.label)}, role: ${b.role}, about: ${JSON.stringify(b.about)}, duration: [${b.duration[0]}, ${b.duration[1]}], effects: [${b.effects.map((e) => `{ kind: ${e.kind}, key: ${JSON.stringify(e.key)}, idempotent: ${e.idempotent} }`).join(', ')}] }`;

/** Takes the inline stage `stageId` of a manifest, checks it as a block and appends it to the user library. */
export function promoteStageToBlock(manifest: string, stageId: string, file = USER_BLOCKS_FILE()): { ok: true; block: Block; file: string } | { ok: false; errors: string[] } {
  const r = loadHauntConfig(manifest);
  if (!r.ok) return { ok: false, errors: r.errors };
  const s = r.config.stages.find((x) => x.id === stageId);
  if (!s) return { ok: false, errors: [`${manifest}: no stage "${stageId}" (stages: ${r.config.stages.map((x) => x.id).join(', ')})`] };
  const block: Block = { id: s.id, label: s.label, role: s.role, about: `Custom block from ${r.config.name}.`, effects: s.effects.map((e) => ({ ...e })), duration: s.duration ?? [400, 800] };
  const errs = validateBlock(block);
  if (blockById(block.id)) errs.push(`id: "${block.id}" is already a block; rename the stage first`);
  if (errs.length > 0) return { ok: false, errors: errs.map((e) => `${stageId}: ${e}`) };
  mkdirSync(dirname(file), { recursive: true });
  const prev = existsSync(file) ? readFileSync(file, 'utf8').replace(/\n*$/, '\n') : '# Custom blocks. Use them in a manifest with `use: <id>`.\n';
  writeFileSync(file, prev + line(block) + '\n');
  return { ok: true, block, file };
}
