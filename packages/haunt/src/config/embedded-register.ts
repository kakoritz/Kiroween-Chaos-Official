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
