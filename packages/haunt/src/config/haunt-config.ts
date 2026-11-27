import { parseYaml, YamlError } from './yaml';
import { blockById } from '../blocks/library';

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
  /** Fault ids that must not land on this stage (modular-engine R2.2). */
  deny?: string[];
  /** The library block this stage was composed from (`use:`), for per-block blame in a chain report. */
  block?: string;
}
export interface Targets {
  recoverMs: number;
  repeats: number;
  throughputPerMin?: number;
  concurrency: number;
}
/** A creature name an app gives to faults on a stage, shown in the arena instead of the engine's name (modular-engine R6.2). */
/** An own attack (third build list, item 3): a named, tuned press of an existing fault on chosen stages of this app. */
export interface AttackDef { id: string; label: string; base: string; stages: string[]; count?: number; forMs?: number }
/** Faults an own attack can build on: the provider faults and the crashes. */
export const ATTACK_BASES: readonly string[] = ['timeout', 'slow_link', 'http_404', 'http_429', 'http_500', 'endpoint_down', 'internet_outage', 'crash', 'out_of_memory', 'power_outage'];
export interface CreatureName { name: string; stage?: string; faults: string[] }
export interface HauntConfig {
  name: string;
  /** Display name for switchers (defaults to `name`). */
  label?: string;
  /** 2 to 6 lowercase letters used in order ids, `cof-0001` (defaults to `job`). */
  idPrefix?: string;
  creatures?: CreatureName[];
  attacks?: AttackDef[];
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

/**
 * Expands `use: <block>` stages into plain stages (modular-engine R4.2). A stage may override id, label, role, effects, duration and
 * the first effect's `key`. An effect key already taken by an earlier stage gets `:2`, `:3`... so a block can be used twice.
 */
function expandUses(list: unknown[], errors: string[]): unknown[] {
  const keys = new Set<string>();
  const uses = new Map<string, number>();
  return list.map((s, i) => {
    if (!isObj(s) || s.use === undefined) {
      if (isObj(s) && Array.isArray(s.effects)) for (const e of s.effects) if (isObj(e) && isNonEmptyStr(e.key)) keys.add(e.key);
      return s;
    }
    const p = `stages[${i}].`;
    if (!isNonEmptyStr(s.use)) { errors.push(`${p}use: expected a block id`); return s; }
    const b = blockById(s.use);
    if (!b) { errors.push(`${p}use: unknown block "${s.use}" (see docs/BLOCKS.md for the list)`); return s; }
    const n = (uses.get(b.id) ?? 0) + 1;
    uses.set(b.id, n);
    const effects = s.effects !== undefined ? s.effects : b.effects.map((e, j) => {
      let key = j === 0 && isNonEmptyStr(s.key) ? s.key : e.key;
      for (let t = 2; keys.has(key); t++) key = `${e.key}:${t}`;
      keys.add(key);
      return { kind: e.kind, key, idempotent: e.idempotent };
    });
    if (Array.isArray(s.effects)) for (const e of s.effects) if (isObj(e) && isNonEmptyStr(e.key)) keys.add(e.key);
    const { use: _u, key: _k, ...rest } = s;
    return { ...rest, id: s.id ?? (n === 1 ? b.id : `${b.id}_${n}`), label: s.label ?? b.label, role: s.role ?? b.role, duration: s.duration ?? (b.duration[1] > 0 ? b.duration : undefined), effects, __block: b.id };
  });
}

export function validateHauntConfig(raw: unknown): LoadResult {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ['root: expected a mapping'] };
  checkUnknown(raw, ['name', 'label', 'idPrefix', 'creatures', 'attacks', 'start', 'adapter', 'stages', 'inputs', 'truth', 'targets'], '', errors);

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
    expandUses(raw.stages, errors).forEach((s, i) => {
      const p = `stages[${i}].`;
      if (!isObj(s)) { errors.push(`stages[${i}]: expected a mapping`); return; }
      checkUnknown(s, ['id', 'label', 'role', 'effects', 'duration', 'deny', '__block'], p, errors);
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
        else if (!/^[a-z][a-z0-9_]{1,31}$/.test(e.kind) || e.kind === 'tracking' || e.kind === 'handoff') errors.push(`${ep}kind: "${e.kind}" must be lowercase letters, digits and _ (2 to 32), and not tracking or handoff`);
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
      let deny: string[] | undefined;
      if (s.deny !== undefined && s.deny !== null) {
        if (!Array.isArray(s.deny) || !s.deny.every(isNonEmptyStr)) errors.push(`${p}deny: expected a list of fault ids`);
        else deny = s.deny as string[];
      }
      stages.push({
        id: String(s.id), label: isNonEmptyStr(s.label) ? s.label : String(s.id),
        role: s.role as StageRole, effects, ...(duration ? { duration } : {}), ...(deny ? { deny } : {}), ...(typeof s.__block === 'string' ? { block: s.__block } : {}),
      });
    });
  }

  const creatures: CreatureName[] = [];
  if (raw.creatures !== undefined && raw.creatures !== null) {
    if (!Array.isArray(raw.creatures)) errors.push('creatures: expected a list');
    else raw.creatures.forEach((c, i) => {
      const cp = `creatures[${i}].`;
      if (!isObj(c)) { errors.push(`creatures[${i}]: expected a mapping`); return; }
      checkUnknown(c, ['name', 'stage', 'faults'], cp, errors);
      if (!isNonEmptyStr(c.name)) errors.push(`${cp}name: required non-empty string`);
      if (!Array.isArray(c.faults) || c.faults.length === 0 || !c.faults.every(isNonEmptyStr)) errors.push(`${cp}faults: required list of fault ids`);
      if (c.stage !== undefined && !stages.some((s) => s.id === c.stage)) errors.push(`${cp}stage: "${String(c.stage)}" is not a stage of this app`);
      if (isNonEmptyStr(c.name) && Array.isArray(c.faults)) creatures.push({ name: c.name, ...(isNonEmptyStr(c.stage) ? { stage: c.stage } : {}), faults: c.faults as string[] });
    });
  }

  const attacks: AttackDef[] = [];
  if (raw.attacks !== undefined && raw.attacks !== null) {
    if (!Array.isArray(raw.attacks)) errors.push('attacks: expected a list');
    else {
      if (raw.attacks.length > 8) errors.push('attacks: at most 8');
      raw.attacks.forEach((a, i) => {
        const ap = `attacks[${i}].`;
        if (!isObj(a)) { errors.push(`attacks[${i}]: expected a mapping`); return; }
        checkUnknown(a, ['id', 'label', 'base', 'stages', 'count', 'forMs'], ap, errors);
        if (typeof a.id !== 'string' || !/^[a-z][a-z0-9_]{1,31}$/.test(a.id)) errors.push(`${ap}id: lowercase letters, digits and _ (2 to 32)`);
        else if (attacks.some((x) => x.id === a.id)) errors.push(`${ap}id: "${a.id}" is used twice`);
        if (!isNonEmptyStr(a.label) || a.label.length > 40) errors.push(`${ap}label: required, at most 40 characters`);
        if (typeof a.base !== 'string' || !ATTACK_BASES.includes(a.base)) errors.push(`${ap}base: one of ${ATTACK_BASES.join(', ')}`);
        if (!Array.isArray(a.stages) || a.stages.length === 0 || !a.stages.every(isNonEmptyStr)) errors.push(`${ap}stages: required list of stage ids`);
        else for (const st of a.stages) if (!stages.some((s) => s.id === st)) errors.push(`${ap}stages: "${String(st)}" is not a stage of this app`);
        if (a.count !== undefined && (!Number.isInteger(a.count) || (a.count as number) < 1 || (a.count as number) > 10)) errors.push(`${ap}count: a whole number from 1 to 10`);
        if (a.forMs !== undefined && (typeof a.forMs !== 'number' || a.forMs < 100 || a.forMs > 15000)) errors.push(`${ap}forMs: a number from 100 to 15000`);
        if (a.count !== undefined && a.forMs !== undefined) errors.push(`${ap}: give count or forMs, not both`);
        if (typeof a.id === 'string' && isNonEmptyStr(a.label) && typeof a.base === 'string' && Array.isArray(a.stages)) attacks.push({ id: a.id, label: a.label, base: a.base, stages: a.stages as string[], ...(a.count !== undefined ? { count: a.count as number } : {}), ...(a.forMs !== undefined ? { forMs: a.forMs as number } : {}) });
      });
    }
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
      ...(creatures.length > 0 ? { creatures } : {}),
      ...(attacks.length > 0 ? { attacks } : {}),
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

