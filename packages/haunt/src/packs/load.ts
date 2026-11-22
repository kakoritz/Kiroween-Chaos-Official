// Node-side pack loader: reads packs/<id>/pack.yaml. Kept apart from pack.ts so the browser bundle stays free of node imports.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePack, type Pack } from './pack';

export function loadPack(dir: string, id: string): Pack {
  const file = join(dir, id, 'pack.yaml');
  if (!existsSync(file)) throw new Error(`pack "${id}" not found: ${file}`);
  const r = parsePack(readFileSync(file, 'utf8'));
  if (!r.ok) throw new Error(`invalid pack ${file}:\n  ${r.errors.join('\n  ')}`);
  if (r.pack.id !== id) throw new Error(`invalid pack ${file}: id "${r.pack.id}" does not match folder "${id}"`);
  return r.pack;
}

export function listPacks(dir: string): string[] {
  return existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'pack.yaml'))).map((d) => d.name).sort()
    : [];
}
