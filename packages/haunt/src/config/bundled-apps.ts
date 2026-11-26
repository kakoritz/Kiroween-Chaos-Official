// Apps that ship as config only (modular-engine M6). Registered at live start next to the three built-in apps. Node only.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { registerAppFromDir, type RegisterResult } from './register-dir';

/** Folders under the repo root, in the order they appear in the app switcher. */
export const BUNDLED_APP_DIRS: readonly string[] = ['apps/haunted-playback', 'examples/coffee-shop'];

/** Registers each bundled app that exists (registering again replaces it). Returns the results; a bad one never stops the others. */
export function registerBundledApps(root = process.cwd()): RegisterResult[] {
  const out: RegisterResult[] = [];
  for (const d of BUNDLED_APP_DIRS) {
    const dir = resolve(root, d);
    if (!existsSync(resolve(dir, 'haunt.yaml'))) continue;
    out.push(registerAppFromDir(dir));
  }
  return out;
}
