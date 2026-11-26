// Registers an app from a directory holding a `haunt.yaml` (node only). Spec: .kiro/specs/modular-engine R3.2, R3.3.
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadHauntConfig } from './load';
import { appFromConfig, registerApp, validateAppDef } from '../shared/registry';
import type { AppDef } from '../shared/catalog';
import { faultById } from '../chaos/catalog';

export type RegisterResult = { ok: true; app: AppDef } | { ok: false; errors: string[] };

/** Loads `<dir>/haunt.yaml` (or `dir` itself when it is a file), checks it and registers the app. Never throws: errors name the file, the field and the fix. */
export function registerAppFromDir(dir: string): RegisterResult {
  const path = resolve(dir);
  const file = /\.ya?ml$/.test(path) ? path : resolve(path, 'haunt.yaml');
  if (!existsSync(file)) return { ok: false, errors: [`${file}: not found. An app folder needs a haunt.yaml (see docs/OWN-BOT.md)`] };
  const loaded = loadHauntConfig(file);
  if (!loaded.ok) return { ok: false, errors: loaded.errors.map((e) => `${file}: ${e}`) };
  const app = appFromConfig(loaded.config, { source: dirname(file) });
  const errs = validateAppDef(app);
  loaded.config.creatures?.forEach((c, i) => c.faults.forEach((f) => { if (!faultById(f)) errs.push(`creatures[${i}].faults: unknown fault "${f}" (see contract/V1_2.md for the fault ids)`); }));
  if (errs.length > 0) return { ok: false, errors: errs.map((e) => `${file}: ${e}`) };
  try { registerApp(app); } catch (e) { return { ok: false, errors: [`${file}: ${(e as Error).message}`] }; }
  return { ok: true, app };
}
