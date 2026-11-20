// Loads creature plugins from a directory (default export of each .ts/.js/.mjs file).
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CreatureRegistry } from './plugin';

export type Importer = (file: string) => Promise<{ default?: unknown }>;

const defaultImporter: Importer = (file) => import(pathToFileURL(file).href);
const PLUGIN_FILE = /\.(ts|js|mjs)$/;

/** Loads every plugin file in `dir` in name order into `registry`. A missing directory loads nothing. */
export async function loadCreatures(
  dir: string,
  registry: CreatureRegistry = new CreatureRegistry(),
  importer: Importer = defaultImporter,
): Promise<CreatureRegistry> {
  if (!existsSync(dir)) return registry;
  const files = readdirSync(dir).filter((f) => PLUGIN_FILE.test(f) && !f.endsWith('.d.ts')).sort();
  for (const f of files) {
    const mod = await importer(join(dir, f));
    if (mod.default === undefined) throw new Error(`creature file ${f} has no default export`);
    registry.register(mod.default, f);
  }
  return registry;
}
