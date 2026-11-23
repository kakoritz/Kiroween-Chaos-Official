// Node-side pack loader: reads packs/<id>/pack.yaml. Kept apart from pack.ts so the browser bundle stays free of node imports.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
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

/** Where the user typed the command: npm runs scripts from the repo root but keeps the caller's directory in INIT_CWD. */
export function callerCwd(): string {
  return process.env.INIT_CWD || process.cwd();
}

/** The nearest `packs/` directory at or above `from` (so a pack id works from any folder inside the repo). */
function findPacksDir(from: string): string | undefined {
  let d = resolve(from);
  for (;;) {
    const c = join(d, 'packs');
    if (existsSync(c) && listPacks(c).length) return c;
    const up = dirname(d);
    if (up === d) return undefined;
    d = up;
  }
}

/** The directory holding pack folders: an explicit --dir (relative to the caller), else ./packs, else the nearest packs/ above the caller or the process cwd. */
export function resolvePacksDir(explicit?: string, cwd: string = callerCwd()): string {
  if (explicit) return resolve(cwd, explicit);
  return findPacksDir(cwd) ?? findPacksDir(process.cwd()) ?? resolve(cwd, 'packs');
}

/** A pack id (looked up in the packs dir) or a path to a pack folder or its pack.yaml. */
export function resolvePackRef(ref: string, explicitDir?: string, cwd: string = callerCwd()): { dir: string; id: string } {
  const abs = resolve(cwd, ref);
  const looksLikePath = /[\\/]/.test(ref) || ref.startsWith('.') || isAbsolute(ref);
  if (looksLikePath || (!explicitDir && existsSync(join(abs, 'pack.yaml')))) {
    const folder = basename(abs) === 'pack.yaml' ? dirname(abs) : abs;
    return { dir: dirname(folder), id: basename(folder) };
  }
  return { dir: resolvePacksDir(explicitDir, cwd), id: ref };
}
