// App registry (modular-engine M1, .kiro/specs/modular-engine R3). Built-in apps live in catalog.ts; any other app is
// registered here at run time from a manifest. No node imports: this bundles for the browser.
import { APPS, APP_VOCAB, BUILTIN_APP_IDS, GENERIC_VOCAB, type AppDef, type AppVocab, type EffectDef, type StageDef, type StageRole } from './catalog';
import type { HauntConfig } from '../config/haunt-config';

export const APP_ID_RE = /^[a-z][a-z0-9_-]{1,31}$/;
export const STAGE_ID_RE = /^[a-z][a-z0-9_]{1,31}$/;
export const MAX_STAGES = 24;

const listeners = new Set<() => void>();
/** Called after any register or unregister (the live server rebuilds its lists). */
export const onRegistryChange = (fn: () => void): (() => void) => { listeners.add(fn); return () => listeners.delete(fn); };

export const isBuiltinApp = (id: string): boolean => (BUILTIN_APP_IDS as readonly string[]).includes(id);
export const isRegisteredApp = (id: unknown): id is string => typeof id === 'string' && Object.prototype.hasOwnProperty.call(APPS, id);
export const getApp = (id: string): AppDef | undefined => (isRegisteredApp(id) ? APPS[id] : undefined);
export const listApps = (): AppDef[] => Object.values(APPS);

/** Problems with an app definition; an empty list means it is valid. Messages say what to change. */
export function validateAppDef(def: AppDef, opts: { alone?: boolean } = {}): string[] {
  const errs: string[] = [];
  if (!APP_ID_RE.test(def.id)) errs.push(`app id "${def.id}": use 2 to 32 lowercase letters, digits, dash or underscore, starting with a letter`);
  if (!/^[a-z]{2,6}$/.test(def.orderPrefix)) errs.push(`idPrefix "${def.orderPrefix}": use 2 to 6 lowercase letters`);
  if (def.stages.length === 0) errs.push('stages: need at least one stage');
  if (def.stages.length > MAX_STAGES) errs.push(`stages: at most ${MAX_STAGES}, got ${def.stages.length}`);
  const seen = new Set<string>();
  for (const s of def.stages) {
    if (!STAGE_ID_RE.test(s.id)) errs.push(`stage "${s.id}": use 2 to 32 lowercase letters, digits or underscore, starting with a letter`);
    if (seen.has(s.id)) errs.push(`stage "${s.id}": duplicate id`);
    seen.add(s.id);
  }
  if (!opts.alone && def.stages.length > 0 && !def.stages.some((s) => s.role === 'input' || s.role === 'effect')) errs.push('stages: need at least one input or effect stage');
  const keys = new Set<string>();
  for (const s of def.stages) for (const e of s.effects) {
    if (keys.has(e.key)) errs.push(`stage "${s.id}": effect key "${e.key}" is used twice; keys must be unique per order`);
    keys.add(e.key);
  }
  return errs;
}

/** Adds an app. Built-in ids cannot be replaced. Registering the same id again replaces a registered (non built-in) app. */
export function registerApp(def: AppDef, vocab: AppVocab = GENERIC_VOCAB, opts: { alone?: boolean } = {}): void {
  if (isBuiltinApp(def.id)) throw new Error(`app "${def.id}" is built in and cannot be replaced`);
  const errs = validateAppDef(def, opts);
  if (errs.length > 0) throw new Error(`app "${def.id}" is not valid:\n- ${errs.join('\n- ')}`);
  APPS[def.id] = { ...def, shortLabel: def.shortLabel ?? def.label };
  APP_VOCAB[def.id] = { ...vocab, idPrefix: def.orderPrefix };
  for (const fn of listeners) fn();
}

/** Removes a registered app (tests, reloads). Built-ins stay. */
export function unregisterApp(id: string): boolean {
  if (isBuiltinApp(id) || !isRegisteredApp(id)) return false;
  delete APPS[id];
  delete APP_VOCAB[id];
  for (const fn of listeners) fn();
  return true;
}

const ROLE_ICON: Record<StageRole, [string, string]> = {
  input: ['inbox', 'archive_box'], work: ['brain', 'think'], effect: ['bolt', 'send_bubbles'], poll: ['hourglass', 'think'], final: ['flag', 'archive_box'],
};
const DEFAULT_MS: Record<StageRole, [number, number]> = { input: [300, 600], work: [600, 1200], effect: [400, 800], poll: [800, 1600], final: [300, 600] };

/** A registered app from a parsed haunt config. Stage ids, roles, effects and durations come from the file; icons and animations default by role. */
export function appFromConfig(config: HauntConfig, opts: { id?: string; label?: string; idPrefix?: string; source?: string } = {}): AppDef {
  const id = opts.id ?? config.name;
  const stages: StageDef[] = config.stages.map((s) => {
    const [icon, workAnimation] = ROLE_ICON[s.role];
    const [min, max] = s.duration ?? DEFAULT_MS[s.role];
    const effects: EffectDef[] = s.effects.map((e) => ({ kind: e.kind, key: e.key, service: e.kind }));
    return { id: s.id, label: s.label, icon, workAnimation, role: s.role, min, max, effects, verb: s.label, ...(s.deny ? { deny: s.deny } : {}), ...(s.block ? { block: s.block } : {}) };
  });
  return { id, label: opts.label ?? config.label ?? id, stages, orderPrefix: opts.idPrefix ?? config.idPrefix ?? 'job', ...(opts.source ? { source: opts.source } : {}) };
}
