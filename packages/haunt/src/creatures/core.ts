// The six core creatures: Reaper (crash), Zombie (timeout), Ghost (404), Poltergeist (missing file),
// Doppelganger (duplicate request), Wraith (power outage). Spec: tasks.md H2.2, runtime.md section 12.
import { faultBody, type PostFault } from '../runner/provider';
import { faultById } from '../chaos/catalog';
import type { CreatureContext, CreaturePlugin } from './plugin';

/** What the engine attaches to the context for the core creatures. */
export interface CoreContext extends CreatureContext {
  lane: string;
  stage: string | null;
  /** Posts a /_fault body to the provider. */
  postFault?: PostFault;
  /** Arms a process fault (kill at the next hook point). */
  armProcess?: (fault: string, params?: Record<string, unknown>) => void | Promise<void>;
  /** Input folder helpers. */
  input?: { removeFile(): void | Promise<void>; duplicateFile(): void | Promise<void> };
}

export function need<T>(v: T | undefined, what: string, fault: string): T {
  if (v === undefined) throw new Error(`creature context is missing ${what} for fault "${fault}"`);
  return v;
}

export function providerCreature(id: string, label: string, family: 'network' | 'http' | 'world', faults: string[]): CreaturePlugin {
  return {
    id, label, family, faults,
    async inject(ctx, fault, params) {
      const c = ctx as CoreContext;
      const def = faultById(fault);
      const body = faultBody(c.lane, c.stage, {
        id: 0,
        fault,
        forMs: params?.forMs as number | undefined ?? undefined,
        count: params?.count as number | undefined ?? undefined,
      });
      if (!def || !body) throw new Error(`${id} cannot inject "${fault}"`);
      await need(c.postFault, 'postFault', fault)(body);
    },
  };
}

function processCreature(id: string, label: string, faults: string[]): CreaturePlugin {
  return {
    id, label, family: 'process', faults,
    async inject(ctx, fault, params) {
      await need((ctx as CoreContext).armProcess, 'armProcess', fault)(fault, params);
    },
  };
}

function fileCreature(id: string, label: string, fault: string, op: 'removeFile' | 'duplicateFile'): CreaturePlugin {
  return {
    id, label, family: 'data', faults: [fault],
    appliesTo: { stages: ['intake'] },
    async inject(ctx) {
      await need((ctx as CoreContext).input, 'input', fault)[op]();
    },
  };
}

export const reaper = processCreature('reaper', 'Reaper', ['crash', 'out_of_memory']);
export const wraith = processCreature('wraith', 'Wraith', ['power_outage']);
export const zombie = providerCreature('zombie', 'Zombie', 'network', ['timeout', 'comm_timeout', 'slow_link']);
export const ghost = providerCreature('ghost', 'Ghost', 'http', ['http_404']);
export const poltergeist = fileCreature('poltergeist', 'Poltergeist', 'missing_file', 'removeFile');
export const doppelganger = fileCreature('doppelganger', 'Doppelganger', 'duplicate_request', 'duplicateFile');

export const CORE_CREATURES: readonly CreaturePlugin[] = [reaper, zombie, ghost, poltergeist, doppelganger, wraith];
