// Creature stack logic (UI-B3). Pure: no DOM, no clock. `now` is passed in by the caller.
// Implements ui-spec section 7 (enter, loom, act, exit, stack) and the depth rules of section 8.
import { CREATURES, type CreatureId } from '../creatures/defs';
import { WORLD_CAPTION } from './world-events';

export interface CreatureVM {
  /** Creature id from the chaos event. Unknown ids draw as a generic specter. */
  id: string;
  fault: string;
  depth: number;
  stage: string;
  inner: boolean;
  deferred: boolean;
  random: boolean;
  /** Process killers (Reaper, Wraith, Lich) stay until process_up. */
  killer: boolean;
  born: number;
  /** When the action starts (null: has not acted). May lie in the future (300 ms rule). */
  actAt: number | null;
  /** Absorbed fault: plays a 500 ms shrug instead of the action. */
  shrug: boolean;
  /** When the exit starts (null: still here). May lie in the future. */
  exitAt: number | null;
  exitDur: number;
  /** Where the fault came from (contract v1.2 rule 52): plan, gremlin, curse or fuzz. */
  source: string;
  /** A fuzz fault nobody has seen: shown with an UNKNOWN tag and its fingerprint (TV3-U7). */
  unknown: boolean;
  fingerprint: string;
  /** Gremlin variant: slow_link, http_500 or duplicate_request. */
  variant: string;
  /** The known fault an unknown shape is built on. */
  base: string;
}

export const MAX_SHOWN = 5;
export const ENTER_MS = 400;
export const EXIT_MS = 300;
export const PUFF_MS = 200;
export const SHRUG_MS = 500;

const KILLERS = new Set(['reaper', 'wraith', 'lich']);
/** Faults with no failure consequence: the creature acts 300 ms after `chaos`, then stays. */
const QUIET_FAULTS = new Set(['duplicate_request', 'slow_link', 'disk_full', 'gremlin']);

export const FAULT_CAPTION: Record<string, string> = {
  crash: 'CRASH', out_of_memory: 'OUT OF MEMORY', power_outage: 'OUTAGE', internet_outage: 'OUTAGE', endpoint_down: '500',
  timeout: 'TIMEOUT', comm_timeout: 'TIMEOUT', slow_link: 'SLOW LINK', http_404: '404', http_429: '429', http_500: '500',
  missing_file: 'MISSING FILE', duplicate_request: 'DUPLICATE', malformed_payload: 'BAD DATA', disk_full: 'DISK FULL',
  hazard_event: 'STORM', driver_unreachable: 'NO DRIVER', boss_power_outage: 'OUTAGE', boss_internet_outage: 'OUTAGE', boss_hazard_storm: 'STORM', gremlin: 'GREMLIN',
};

export const captionOf = (fault: string): string => FAULT_CAPTION[fault] ?? WORLD_CAPTION[fault] ?? fault.replace(/_/g, ' ').toUpperCase();

/** Sprite id to draw: a known creature, or null for the generic specter. */
export const spriteOf = (id: string): CreatureId | null => (CREATURES.some((c) => c.id === id) ? (id as CreatureId) : null);

const words = (s: string): string => s.replace(/_/g, ' ');

/** One line for logs and tickers: a gremlin prank, an UNKNOWN fuzz fault (with its fingerprint), or the plain fault. */
export function chaosPhrase(d: Record<string, unknown>, stageLabel = ''): string {
  const at = stageLabel ? ` at ${stageLabel}` : '';
  const fault = typeof d.fault === 'string' ? d.fault : '';
  if (d.unknown === true) {
    const fp = typeof d.fingerprint === 'string' && d.fingerprint ? ` ${d.fingerprint}` : '';
    return `UNKNOWN fault${fp}${at}`;
  }
  if (d.source === 'gremlin' || fault === 'gremlin') {
    const v = typeof d.variant === 'string' && d.variant ? `: ${words(d.variant)}` : '';
    return `gremlin${v}${at}`;
  }
  return `${fault || 'chaos'} hits ${stageLabel || 'a stage'}`;
}

/** Tooltip for the UNKNOWN tag and the gremlin. Empty for every other creature. */
export function creatureTip(c: Pick<CreatureVM, 'unknown' | 'fingerprint' | 'base' | 'fault' | 'variant' | 'source'>): string {
  if (c.unknown) {
    const fp = c.fingerprint ? ` Fingerprint ${c.fingerprint}: the same shape gets the same id.` : '';
    return `UNKNOWN fault: a shape from the fuzz pool that nobody has seen${c.base ? `, built on ${words(c.base)}` : ''}.${fp} It goes in the Casebook as a new signature.`;
  }
  if (c.source === 'gremlin' || c.fault === 'gremlin') return `Gremlin${c.variant ? ` (${words(c.variant)})` : ''}: a small prank so no lane gets a perfect run. It costs little.`;
  return '';
}

export interface CreatureHost { creatures: CreatureVM[] }

export function addCreature(l: CreatureHost, now: number, d: Record<string, unknown>, stage: string): CreatureVM {
  const fault = typeof d.fault === 'string' ? d.fault : '';
  const id = typeof d.creature === 'string' ? d.creature : 'specter';
  const deferred = d.deferred === true;
  const c: CreatureVM = {
    id, fault, depth: typeof d.depth === 'number' ? d.depth : l.creatures.length + 1, stage,
    inner: d.injectedAt === 'recovery' || d.scope === 'inner', deferred, random: d.source === 'random',
    killer: KILLERS.has(id), born: now, actAt: !deferred && QUIET_FAULTS.has(fault) ? now + 300 : null,
    shrug: false, exitAt: null, exitDur: EXIT_MS,
    source: typeof d.source === 'string' ? d.source : '', unknown: d.unknown === true,
    fingerprint: typeof d.fingerprint === 'string' ? d.fingerprint : '', variant: typeof d.variant === 'string' ? d.variant : '',
    base: typeof (d.fuzz as { fault?: unknown } | undefined)?.fault === 'string' ? String((d.fuzz as { fault: string }).fault) : '',
  };
  l.creatures.push(c);
  return c;
}

const live = (c: CreatureVM): boolean => c.exitAt === null;

/** First consequence event: creatures that have not acted yet act now. */
export function actAll(l: CreatureHost, now: number, killersOnly = false): void {
  for (const c of l.creatures) if (live(c) && c.actAt === null && (!killersOnly || c.killer)) c.actAt = now;
}

export function exitAll(l: CreatureHost, now: number, o: { delay?: number; dur?: number; keepKillers?: boolean } = {}): void {
  for (const c of l.creatures) {
    if (!live(c) || (o.keepKillers && c.killer)) continue;
    // A creature that never acted gets to act before it leaves.
    const wait = o.delay !== undefined && c.actAt === null ? o.delay : 0;
    if (wait) c.actAt = now;
    c.exitAt = now + wait; c.exitDur = o.dur ?? EXIT_MS;
  }
}

export function exitDepth(l: CreatureHost, now: number, depth: number): void {
  const c = l.creatures.find((x) => live(x) && x.depth === depth) ?? [...l.creatures].reverse().find(live);
  if (c) { c.exitAt = now; c.exitDur = EXIT_MS; }
}

export function exitStage(l: CreatureHost, now: number, stage: string): void {
  for (const c of l.creatures) if (live(c) && c.stage === stage) { c.exitAt = now; c.exitDur = EXIT_MS; }
}

/** `chaos_absorbed`: shrug for 500 ms, then exit. */
export function absorb(l: CreatureHost, now: number, creature: string | undefined): void {
  const c = [...l.creatures].reverse().find((x) => live(x) && (!creature || x.id === creature)) ?? [...l.creatures].reverse().find(live);
  if (!c) return;
  c.shrug = true; c.actAt = now; c.exitAt = now + SHRUG_MS; c.exitDur = EXIT_MS;
}

/** Drop creatures that finished leaving long ago. Keeps the list bounded under event storms. */
export function prune(l: CreatureHost, now: number): void {
  if (l.creatures.some((c) => c.exitAt !== null && now > c.exitAt + 2500)) l.creatures = l.creatures.filter((c) => c.exitAt === null || now <= c.exitAt + 2500);
  if (l.creatures.length > 24) l.creatures = l.creatures.slice(-24);
}

/** Creatures to draw, oldest left, newest right, at most five. Fully gone ones are skipped. */
export function shown(l: CreatureHost, now: number, speed = 1): CreatureVM[] {
  const out = l.creatures.filter((c) => c.exitAt === null || now < c.exitAt + c.exitDur / speed);
  return out.slice(-MAX_SHOWN);
}

export interface CreatureFrame {
  anim: string;
  p: number;
  /** 0..1 progress of the enter travel (1 when settled). */
  enter: number;
  /** 0..1 progress of the exit (0 while present). */
  exit: number;
  acted: boolean;
}

const ACT_ANIM: Record<string, string> = {
  gremlin: 'prank', reaper: 'swing', zombie: 'sit', ghost: 'touch', wraith: 'yank', poltergeist: 'fling', doppelganger: 'copy', lich: 'cast',
  banshee: 'scream', goblin: 'hoard', imp: 'throw', gargoyle: 'land', mummy: 'wrap', werewolf: 'howl', wisp: 'lead', witch: 'hex', banshee_queen: 'wail', horseman: 'hurl',
};

export const actAnimOf = (id: string): string => ACT_ANIM[id] ?? 'idle';

export function creatureFrame(c: CreatureVM, now: number, speed = 1, reduced = false): CreatureFrame {
  const sp = Math.max(0.1, speed);
  const enter = reduced ? 1 : Math.min(1, Math.max(0, ((now - c.born) * sp) / ENTER_MS));
  const exit = c.exitAt !== null && now >= c.exitAt ? Math.min(1, ((now - c.exitAt) * sp) / c.exitDur) : 0;
  const acted = c.actAt !== null && now >= c.actAt && !c.shrug;
  const def = CREATURES.find((x) => x.id === c.id);
  if (!def) return { anim: 'idle', p: (now % 2200) / 2200, enter, exit, acted: false };
  if (acted) {
    const a = def.anims.find((x) => x.id === actAnimOf(c.id));
    const dur = (a?.duration ?? 900) / sp;
    const t = (now - (c.actAt as number)) / dur;
    return { anim: a?.id ?? 'idle', p: a?.loop ? t % 1 : Math.min(1, t), enter, exit, acted };
  }
  if (c.id === 'zombie') return { anim: 'shamble', p: (now * sp % 1600) / 1600, enter, exit, acted };
  const idleDur = def.anims.find((x) => x.id === 'idle')?.duration ?? 2000;
  return { anim: 'idle', p: (now % idleDur) / idleDur, enter, exit, acted };
}
