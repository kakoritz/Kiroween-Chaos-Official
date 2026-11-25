import { parseYaml, YamlError } from './yaml';

export type Adapter = 'sdk' | 'proxy' | 'process';
export type StageRole = 'input' | 'work' | 'effect' | 'poll' | 'final';
export type Idempotency = 'required' | 'preferred';

export interface StageEffect { kind: string; key: string; idempotent: Idempotency }
export interface StageDef {
  id: string;
  label: string;
  role: StageRole;
  effects: StageEffect[];
  duration?: [number, number];
}
export interface Targets {
  recoverMs: number;
  repeats: number;
  throughputPerMin?: number;
  concurrency: number;
}
export interface HauntConfig {
  name: string;
  /** Display name for switchers (defaults to `name`). */
  label?: string;
  /** 2 to 6 lowercase letters used in order ids, `cof-0001` (defaults to `job`). */
  idPrefix?: string;
  start: string;
  adapter: Adapter[];
  stages: StageDef[];
  inputs?: string;
  truth?: string;
  targets: Targets;
}

export type LoadResult = { ok: true; config: HauntConfig; errors: [] } | { ok: false; errors: string[] };

const ADAPTERS: Adapter[] = ['sdk', 'proxy', 'process'];
const ROLES: StageRole[] = ['input', 'work', 'effect', 'poll', 'final'];
const IDEM: Idempotency[] = ['required', 'preferred'];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNonEmptyStr = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

function checkUnknown(o: Record<string, unknown>, known: string[], path: string, errors: string[]): void {
  for (const k of Object.keys(o)) if (!known.includes(k)) errors.push(`${path}${k}: unknown field`);
}

export function validateHauntConfig(raw: unknown): LoadResult {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ['root: expected a mapping'] };
  checkUnknown(raw, ['name', 'label', 'idPrefix', 'start', 'adapter', 'stages', 'inputs', 'truth', 'targets'], '', errors);

  if (!isNonEmptyStr(raw.name)) errors.push('name: required non-empty string');
  if (!isNonEmptyStr(raw.start)) errors.push('start: required non-empty string');

  let adapter: Adapter[] = ['sdk'];
  if (raw.adapter !== undefined && raw.adapter !== null) {
    const list = Array.isArray(raw.adapter) ? raw.adapter : [raw.adapter];
    const bad = list.filter((a) => !ADAPTERS.includes(a as Adapter));
    if (list.length === 0 || bad.length > 0) errors.push(`adapter: must be one or more of ${ADAPTERS.join(' | ')}`);
    else adapter = list as Adapter[];
  }

  const stages: StageDef[] = [];
  if (!Array.isArray(raw.stages) || raw.stages.length === 0) {
    errors.push('stages: required non-empty list');
  } else {
    const seen = new Set<string>();
    raw.stages.forEach((s, i) => {
      const p = `stages[${i}].`;
      if (!isObj(s)) { errors.push(`stages[${i}]: expected a mapping`); return; }
      checkUnknown(s, ['id', 'label', 'role', 'effects', 'duration'], p, errors);
      if (!isNonEmptyStr(s.id)) errors.push(`${p}id: required non-empty string`);
      else if (seen.has(s.id)) errors.push(`${p}id: duplicate stage id "${s.id}"`);
      else seen.add(s.id);
      if (!ROLES.includes(s.role as StageRole)) errors.push(`${p}role: required, one of ${ROLES.join(' | ')}`);
      if (s.label !== undefined && !isNonEmptyStr(s.label)) errors.push(`${p}label: must be a non-empty string`);

      const effects: StageEffect[] = [];
      if (s.effects !== undefined && s.effects !== null) {
        if (!Array.isArray(s.effects)) errors.push(`${p}effects: expected a list`);
        else s.effects.forEach((e, j) => {
          const ep = `${p}effects[${j}].`;
          if (!isObj(e)) { errors.push(`${p}effects[${j}]: expected a mapping`); return; }
          checkUnknown(e, ['kind', 'key', 'idempotent'], ep, errors);
          if (!isNonEmptyStr(e.kind)) errors.push(`${ep}kind: required non-empty string`);
          if (!IDEM.includes(e.idempotent as Idempotency)) errors.push(`${ep}idempotent: required, one of ${IDEM.join(' | ')}`);
          effects.push({
            kind: String(e.kind), key: isNonEmptyStr(e.key) ? e.key : String(e.kind), idempotent: e.idempotent as Idempotency,
          });
        });
      }
      if (effects.length > 0 && s.role !== 'effect') errors.push(`${p}effects: only allowed on role "effect"`);

      let duration: [number, number] | undefined;
      if (s.duration !== undefined && s.duration !== null) {
        const d = s.duration;
        if (!Array.isArray(d) || d.length !== 2 || !d.every((n) => typeof n === 'number' && n >= 0) || (d[0] as number) > (d[1] as number)) {
          errors.push(`${p}duration: expected [min, max] in ms with 0 <= min <= max`);
        } else duration = [d[0] as number, d[1] as number];
      }
      stages.push({
        id: String(s.id), label: isNonEmptyStr(s.label) ? s.label : String(s.id),
        role: s.role as StageRole, effects, ...(duration ? { duration } : {}),
      });
    });
  }

  if (raw.inputs !== undefined && raw.inputs !== null && !isNonEmptyStr(raw.inputs)) errors.push('inputs: must be a non-empty string');
  if (raw.truth !== undefined && raw.truth !== null) {
    if (!isNonEmptyStr(raw.truth)) errors.push('truth: must be a URL string');
    else if (!/^https?:\/\/\S+$/.test(raw.truth)) errors.push('truth: must be an http(s) URL');
  }
  if (stages.some((s) => s.role === 'effect') && !isNonEmptyStr(raw.truth)) {
    errors.push('truth: required when any stage has role "effect"');
  }

  const targets: Targets = { recoverMs: 20000, repeats: 0, concurrency: 8 };
  if (raw.targets !== undefined && raw.targets !== null) {
    if (!isObj(raw.targets)) errors.push('targets: expected a mapping');
    else {
      const t = raw.targets;
      checkUnknown(t, ['recoverMs', 'repeats', 'throughputPerMin', 'concurrency'], 'targets.', errors);
      const num = (k: 'recoverMs' | 'repeats' | 'throughputPerMin' | 'concurrency', min: number, int: boolean): void => {
        const v = t[k];
        if (v === undefined || v === null) return;
        if (typeof v !== 'number' || !Number.isFinite(v) || v < min || (int && !Number.isInteger(v))) {
          errors.push(`targets.${k}: expected ${int ? 'an integer' : 'a number'} >= ${min}`);
        } else targets[k] = v;
      };
      num('recoverMs', 1, false);
      num('repeats', 0, true);
      num('throughputPerMin', 1, false);
      num('concurrency', 1, true);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    config: {
      name: raw.name as string,
      ...(isNonEmptyStr(raw.label) ? { label: raw.label } : {}),
      ...(isNonEmptyStr(raw.idPrefix) ? { idPrefix: raw.idPrefix } : {}),
      start: raw.start as string,
      adapter,
      stages,
      ...(isNonEmptyStr(raw.inputs) ? { inputs: raw.inputs } : {}),
      ...(isNonEmptyStr(raw.truth) ? { truth: raw.truth } : {}),
      targets,
    },
  };
}

export function parseHauntConfig(source: string): LoadResult {
  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (e) {
    if (e instanceof YamlError) return { ok: false, errors: [`yaml: ${e.message}`] };
    throw e;
  }
  return validateHauntConfig(raw);
}

