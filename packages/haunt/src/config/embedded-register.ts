// Registers the config-only apps from their embedded copy, for the browser (no fs). Same checks as registerAppFromDir. Pure.
import { EMBEDDED_APPS } from './embedded-apps';
import { parseHauntConfig } from './haunt-config';
import { appFromConfig, registerApp, validateAppDef } from '../shared/registry';
import type { AppDef } from '../shared/catalog';

/** Registers every embedded app; returns the ones registered. A bad one is skipped and named in `errors`. */
export function registerEmbeddedApps(): { apps: AppDef[]; errors: string[] } {
  const apps: AppDef[] = [];
  const errors: string[] = [];
  for (const [dir, text] of Object.entries(EMBEDDED_APPS)) {
    const r = parseHauntConfig(text);
    if (!r.ok) { errors.push(`${dir}: ${r.errors.join('; ')}`); continue; }
    const app = appFromConfig(r.config);
    const errs = validateAppDef(app);
    if (errs.length > 0) { errors.push(`${dir}: ${errs.join('; ')}`); continue; }
    registerApp(app);
    apps.push(app);
  }
  return { apps, errors };
}

export type RegisterTextResult = { ok: true; app: AppDef } | { ok: false; errors: string[] };

/** Registers an app from haunt.yaml text (the Chain Wizard's "run in the arena"). Same checks as a folder. A built-in id is refused. Pure. */
export function registerManifestText(text: string, opts: { source?: string } = {}): RegisterTextResult {
  if (text.length > 32_000) return { ok: false, errors: ['manifest: too large (32 KB at most)'] };
  const r = parseHauntConfig(text);
  if (!r.ok) return { ok: false, errors: r.errors };
  const app = appFromConfig(r.config, opts.source ? { source: opts.source } : {});
  const errs = validateAppDef(app);
  if (errs.length > 0) return { ok: false, errors: errs };
  try { registerApp(app); } catch (e) { return { ok: false, errors: [(e as Error).message] }; }
  return { ok: true, app };
}
