// Creature plugin interface, validation and registry.
// Spec: .kiro/specs/engine/runtime.md section 12.
import type { Family } from '../chaos/catalog';

export const FAMILIES: readonly Family[] = ['process', 'network', 'http', 'data', 'world'];

export interface CreatureContext {
  /** Seeded random source. */
  rng: () => number;
  /** Provider admin, runner arm API and input folder helpers are attached by the engine. */
  [key: string]: unknown;
}

export interface CreaturePlugin {
  id: string;
  label: string;
  family: Family;
  faults: string[];
  appliesTo?: { roles?: string[]; stages?: string[]; apps?: string[] };
  inject(ctx: CreatureContext, fault: string, params?: Record<string, unknown>): Promise<void> | void;
  cleanup?(ctx: CreatureContext): Promise<void> | void;
}

/** Returns a list of problems; empty means the value is a valid plugin. */
export function validateCreature(value: unknown): string[] {
  const errs: string[] = [];
  if (typeof value !== 'object' || value === null) return ['plugin is not an object'];
  const p = value as Record<string, unknown>;
  if (typeof p.id !== 'string' || !/^[a-z][a-z0-9_]*$/.test(p.id)) errs.push('id must be lowercase snake_case');
  if (typeof p.label !== 'string' || p.label === '') errs.push('label must be a non-empty string');
  if (!FAMILIES.includes(p.family as Family)) errs.push(`family must be one of ${FAMILIES.join(', ')}`);
  if (!Array.isArray(p.faults) || p.faults.length === 0 || !p.faults.every((f) => typeof f === 'string' && f !== '')) {
    errs.push('faults must be a non-empty string array');
  }
  if (typeof p.inject !== 'function') errs.push('inject must be a function');
  if (p.cleanup !== undefined && typeof p.cleanup !== 'function') errs.push('cleanup must be a function when present');
  if (p.appliesTo !== undefined && (typeof p.appliesTo !== 'object' || p.appliesTo === null)) errs.push('appliesTo must be an object when present');
  return errs;
}

export class CreatureRegistry {
  private readonly byId = new Map<string, CreaturePlugin>();

  register(plugin: unknown, source = 'plugin'): CreaturePlugin {
    const errs = validateCreature(plugin);
    if (errs.length > 0) throw new Error(`invalid creature (${source}): ${errs.join('; ')}`);
    const p = plugin as CreaturePlugin;
    if (this.byId.has(p.id)) throw new Error(`duplicate creature id "${p.id}" (${source})`);
    this.byId.set(p.id, p);
    return p;
  }

  get(id: string): CreaturePlugin | undefined {
    return this.byId.get(id);
  }

  list(): CreaturePlugin[] {
    return [...this.byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  /** The creature that handles a fault id, first by sorted id. */
  forFault(fault: string): CreaturePlugin | undefined {
    return this.list().find((c) => c.faults.includes(fault));
  }

  byFamily(family: Family): CreaturePlugin[] {
    return this.list().filter((c) => c.family === family);
  }
}
