// Workflow Lab model: a declared workflow (stages and the protections it has) that the browser engine can sweep.
// No node imports: this must bundle for the browser. Spec: .kiro/specs/share/spec.md section 4 (SH-C3).
import { STREAMING_PACK_YAML } from '../packs/streaming';
import { EMBEDDED_PACKS } from '../packs/embedded';
import { packToLabModel, parsePack } from '../packs/pack';
import type { HauntConfig, StageDef, StageRole } from '../config/haunt-config';

export type LabPart = 'retry' | 'journal' | 'idempotency' | 'breaker' | 'offline_queue';
export const LAB_PARTS: readonly LabPart[] = ['retry', 'journal', 'idempotency', 'breaker', 'offline_queue'];

export interface LabEffect {
  /** What the effect does, for example "charge" or "email". */
  kind: string;
  /** True when the effect carries an idempotency key. */
  keyed: boolean;
}
export interface LabStage {
  id: string;
  label?: string;
  role: StageRole;
  effects?: LabEffect[];
}
/** Ids of the creatures the lab sends (checked against engine LAB_CREATURES by the tests). */
export const LAB_CREATURE_IDS: readonly string[] = ['reaper', 'wraith', 'banshee', 'zombie', 'ghost', 'goblin', 'imp', 'poltergeist', 'doppelganger', 'witch', 'mummy'];

export interface PackFault { id: string; stage: string; creature: string; art: string; mode: string; behavior: string }
export interface PackBoss { id: string; label?: string; hits: string[]; story?: string }
/** A cursed endpoint: a persistent trait, so the stage it sits behind always sees the fault (not once per sweep). */
export interface PackCurse { id: string; endpoint: string; stage?: string; fault?: string }
export interface PackReviews { label: string; subscores: string[]; /** Subscore to the stage ids it is judged on. */ stages?: Record<string, string[]> }
/** Catalog fault ids the lab engine can model (kept in step with LAB_CREATURES by the tests). */
export const LAB_FAULT_IDS: readonly string[] = ['crash', 'power_outage', 'internet_outage', 'timeout', 'http_404', 'http_429', 'http_500', 'missing_file', 'duplicate_request', 'malformed_payload', 'disk_full'];
/** Pack labels carried on the model and report so the UI changes words, not code (PK-C1). */
export interface LabPackMeta {
  id: string;
  title: string;
  modelBased: boolean;
  /** Lab creature id (art) to the pack's creature name. */
  creatures: Record<string, string>;
  review: PackReviews;
  tiers: Partial<Record<LabPart, string>>;
  faults: PackFault[];
  bosses: PackBoss[];
  curses?: PackCurse[];
}

export interface LabModel {
  name: string;
  /** Set when the model came from a scenario pack. */
  pack?: LabPackMeta;
  stages: LabStage[];
  /** Protections the modelled process has. Missing parts count as off ("none, my bot today"). */
  parts?: Partial<Record<LabPart, boolean>>;
  seed?: number;
}

export const ROLES: readonly StageRole[] = ['input', 'work', 'effect', 'poll', 'final'];

export type PartSet = Record<LabPart, boolean>;

export function partSet(m: Pick<LabModel, 'parts'>): PartSet {
  const p = m.parts ?? {};
  return { retry: !!p.retry, journal: !!p.journal, idempotency: !!p.idempotency, breaker: !!p.breaker, offline_queue: !!p.offline_queue };
}

export function validateLabModel(m: unknown): string[] {
  const errs: string[] = [];
  if (typeof m !== 'object' || m === null) return ['model: expected an object'];
  const o = m as Record<string, unknown>;
  if (typeof o.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(o.name)) errs.push('name: letters, digits, dot, dash or underscore');
  if (!Array.isArray(o.stages) || o.stages.length === 0) { errs.push('stages: need at least one stage'); return errs; }
  if (o.stages.length > 24) errs.push('stages: at most 24');
  const seen = new Set<string>();
  o.stages.forEach((s, i) => {
    const p = `stages[${i}]`;
    if (typeof s !== 'object' || s === null) { errs.push(`${p}: expected an object`); return; }
    const st = s as Record<string, unknown>;
    if (typeof st.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(st.id)) errs.push(`${p}.id: letters, digits, dash or underscore`);
    else if (seen.has(st.id)) errs.push(`${p}.id: duplicate "${st.id}"`);
    else seen.add(st.id);
    if (!ROLES.includes(st.role as StageRole)) errs.push(`${p}.role: one of ${ROLES.join(' | ')}`);
    if (st.effects !== undefined) {
      if (!Array.isArray(st.effects)) errs.push(`${p}.effects: expected a list`);
      else {
        if (st.effects.length > 0 && st.role !== 'effect') errs.push(`${p}.effects: only on role "effect"`);
        st.effects.forEach((e, j) => {
          const eo = e as Record<string, unknown> | null;
          if (!eo || typeof eo.kind !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(eo.kind)) errs.push(`${p}.effects[${j}].kind: letters, digits, dash or underscore`);
          if (!eo || typeof eo.keyed !== 'boolean') errs.push(`${p}.effects[${j}].keyed: true or false`);
        });
      }
    }
  });
  return errs;
}

/** The haunt.yaml a user would put next to their real code (validates with `haunt validate`). */
export function labToConfig(m: LabModel): HauntConfig {
  const stages: StageDef[] = m.stages.map((s) => ({
    id: s.id,
    label: s.label?.trim() || s.id,
    role: s.role,
    effects: s.role === 'effect' ? (s.effects ?? []).map((e) => ({ kind: e.kind, key: e.kind, idempotent: e.keyed ? 'required' as const : 'preferred' as const })) : [],
  }));
  return {
    name: m.name,
    start: 'node dist/bot.js',
    adapter: ['sdk'],
    stages,
    ...(m.stages.some((s) => s.role === 'input') ? { inputs: './inputs/' } : {}),
    ...(m.stages.some((s) => s.role === 'effect') ? { truth: 'http://127.0.0.1:7071' } : {}),
    targets: { recoverMs: 20000, repeats: 0, concurrency: 8 },
  };
}

const q = (s: string): string => (/^[A-Za-z0-9_./:-]+$/.test(s) ? s : JSON.stringify(s));

/** Serialises a lab model to haunt.yaml text (the subset our parser reads). */
export function labToYaml(m: LabModel): string {
  const c = labToConfig(m);
  const out: string[] = [`name: ${q(c.name)}`, `start: ${q(c.start)}`, 'adapter: sdk'];
  if (c.inputs) out.push(`inputs: ${q(c.inputs)}`);
  if (c.truth) out.push(`truth: ${q(c.truth)}`);
  out.push('targets:', `  recoverMs: ${c.targets.recoverMs}`, `  repeats: ${c.targets.repeats}`, `  concurrency: ${c.targets.concurrency}`, 'stages:');
  for (const s of c.stages) {
    out.push(`  - id: ${q(s.id)}`, `    label: ${q(s.label)}`, `    role: ${s.role}`);
    if (s.effects.length) {
      out.push('    effects:');
      for (const e of s.effects) out.push(`      - { kind: ${q(e.kind)}, key: ${q(e.key)}, idempotent: ${e.idempotent} }`);
    }
  }
  return out.join('\n') + '\n';
}

const eff = (kind: string, keyed = false): LabEffect => ({ kind, keyed });

/** Starting points for the form. Parts start empty: "none (my bot today)". */
export const LAB_PRESETS: Record<string, LabModel> = {
  orders: {
    name: 'orders-lab',
    stages: [
      { id: 'account', label: 'Account or login', role: 'effect', effects: [eff('account')] },
      { id: 'create', label: 'Create order', role: 'input' },
      { id: 'submit', label: 'Submit order', role: 'effect', effects: [eff('order')] },
      { id: 'payment', label: 'Payment', role: 'effect', effects: [eff('charge')] },
      { id: 'confirmation', label: 'Confirmation', role: 'effect', effects: [eff('email')] },
      { id: 'receive', label: 'Store receives', role: 'effect', effects: [eff('store')] },
      { id: 'process', label: 'Process order', role: 'effect', effects: [eff('store')] },
      { id: 'ship', label: 'Ship and pack', role: 'effect', effects: [eff('dispatch')] },
      { id: 'transit', label: 'Delivery updates', role: 'poll' },
    ],
  },
  inbox: {
    name: 'inbox-lab',
    stages: [
      { id: 'fetch', label: 'Fetch mail', role: 'input' },
      { id: 'classify', label: 'Classify', role: 'work' },
      { id: 'reply', label: 'Send reply', role: 'effect', effects: [eff('reply')] },
      { id: 'archive', label: 'Archive', role: 'final' },
    ],
  },
  payments: {
    name: 'payments-lab',
    stages: [
      { id: 'receive', label: 'Receive batch', role: 'input' },
      { id: 'validate', label: 'Validate', role: 'work' },
      { id: 'charge', label: 'Charge card', role: 'effect', effects: [eff('charge')] },
      { id: 'ledger', label: 'Write ledger', role: 'effect', effects: [eff('ledger')] },
      { id: 'settle', label: 'Wait for settlement', role: 'poll' },
    ],
  },
  // Lazy: built from the embedded pack text on first read (the packs module imports this one).
  get streaming(): LabModel { return packPreset(STREAMING_PACK_YAML); },
  report: {
    name: 'report-lab',
    stages: [
      { id: 'pull', label: 'Pull data', role: 'input' },
      { id: 'build', label: 'Build report', role: 'work' },
      { id: 'publish', label: 'Publish', role: 'effect', effects: [eff('publish')] },
      { id: 'notify', label: 'Notify owners', role: 'final' },
    ],
  },
};

// Every other embedded pack (ticketing, and any pack made with `haunt pack new`) is a preset too, with no code change.
for (const id of Object.keys(EMBEDDED_PACKS)) {
  if (id in LAB_PRESETS) continue;
  Object.defineProperty(LAB_PRESETS, id, { enumerable: true, configurable: true, get: () => packPreset(EMBEDDED_PACKS[id]!) });
}

export const LAB_COMMANDS: readonly string[] = ['npx haunt init', 'haunt validate', 'haunt sweep'];

/** Commands shown with a lab run: the generic trio, or the pack's own scaffold, check and sweep steps. */
export function labCommands(model: Pick<LabModel, 'pack'>): readonly string[] {
  const id = model.pack?.id;
  if (!id) return LAB_COMMANDS;
  return [`npx haunt init --pack ${id}`, `npx haunt pack check ${id}`, 'haunt validate', 'haunt sweep'];
}

function packPreset(yaml: string): LabModel {
  const r = parsePack(yaml);
  if (!r.ok) throw new Error(`embedded pack is invalid: ${r.errors.join('; ')}`);
  return packToLabModel(r.pack);
}
