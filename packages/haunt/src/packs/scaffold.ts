// `haunt pack new <id>` and `haunt init` (PK-C1 follow-up): scaffold a pack from a validated template, and a haunt.yaml from a pack.
// Node only (writes files). The template is parsed and validated before anything is written, so a scaffold is never invalid.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { labToYaml } from '../lab/model';
import { PACK_TIERS, packToLabModel, parsePack, type Pack } from './pack';
import { loadPack } from './load';

/** Preset ids that exist without a pack: a pack with one of these ids would be shadowed in the Workflow Lab. */
export const RESERVED_PACK_IDS: readonly string[] = ['orders', 'inbox', 'payments', 'report'];
const ID = /^[a-z][a-z0-9_-]{1,31}$/;

export function checkPackId(id: string): string | null {
  if (!ID.test(id)) return 'id: 2 to 32 characters, lowercase letters, digits, dash or underscore, starting with a letter';
  if (RESERVED_PACK_IDS.includes(id)) return `id: "${id}" is a built-in Lab preset, pick another name`;
  return null;
}

const titleOf = (id: string): string => `Haunted ${id.split(/[-_]/).filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ')}`;

/** The starting pack: five stages, four faults, a curse, a boss, a review and the five tier texts. Edit the words, keep the shape. */
export function packTemplate(id: string, title = titleOf(id)): string {
  return `# ${title} pack. Edit the words, keep the shape. Check with: npm run haunt -- pack check ${id}
# Then run: npm run packs:embed   (puts a copy in the browser bundle so the Workflow Lab lists it)
# Results are model-based: rules over the protections you declare, not your real code. Say so (modelBased: true) until a real app backs it.
id: ${id}
title: ${JSON.stringify(title)}
modelBased: true
# Stages are the steps of your workflow, in order. kind: input | work | effect | poll | final.
# An effect stage changes the outside world (a charge, an email, a ticket); list each effect and whether it carries an idempotency key.
stages:
  - { id: start, label: Request arrives, kind: input }
  - { id: validate, label: Validate, kind: work }
  - { id: commit, label: Commit the change, kind: effect, effects: [{ kind: record, keyed: true }] }
  - { id: wait, label: Wait for the other side, kind: poll }
  - { id: finish, label: Finish and confirm, kind: final }
ledger:
  - { id: records }
# Faults: what can go wrong and at which stage (or "any"). art must be a creature the arena can draw:
# reaper, wraith, banshee, zombie, ghost, goblin, imp, poltergeist, doppelganger, witch, mummy.
# mode: duplicate | timeout | stall | status | crash | outage | expire | corrupt | misroute.
faults:
  - { id: input_missing, stage: start, creature: Missing Poltergeist, art: poltergeist, mode: corrupt, behavior: "Park the request and say which input is missing" }
  - { id: duplicate_commit, stage: commit, creature: Double Doppelganger, art: doppelganger, mode: duplicate, behavior: "One record per request id, a retry never writes twice" }
  - { id: dependency_timeout, stage: commit, creature: Slow Zombie, art: zombie, mode: timeout, behavior: "Retry with the same key, then park" }
  - { id: backend_down, stage: any, creature: Cloud Banshee, art: banshee, mode: outage, behavior: "Queue the work and resume when the backend is back" }
# Curses are persistent traits: the stage always sees this fault. fault: http_404 | http_429 | http_500 | timeout | ...
curses:
  - { id: cursed_dependency, endpoint: dependency, stage: commit, fault: http_500 }
# The review the people on the other side would give. Each subscore is judged on the stages you map to it.
reviews:
  label: User rating
  subscores: [speed, correctness, ease]
  stages:
    speed: [start, validate, wait]
    correctness: [commit]
    ease: [finish]
# A boss is a night where several stages are hit together.
bosses:
  - { id: big_night, label: Big Night, hits: [start, commit, wait], story: "A busy night while the dependency is down" }
# What each protection means in this domain (shown next to "add this part").
tiers:
  retry: "Retry the dependency call with backoff"
  journal: "Remember how far each request got, replay after a crash"
  idempotency: "Send the request id as the key: one request, one record"
  breaker: "Stop calling a failing dependency and probe before resuming"
  offline_queue: "Park requests while the backend is down and resume later"
`;
}

export interface ScaffoldResult { file: string; pack: Pack }

/** Writes `<packsDir>/<id>/pack.yaml` from the template. Refuses a bad id and an existing pack (unless force). */
export function scaffoldPack(packsDir: string, id: string, opts: { title?: string; force?: boolean } = {}): ScaffoldResult {
  const bad = checkPackId(id);
  if (bad) throw new Error(bad);
  const file = join(packsDir, id, 'pack.yaml');
  if (existsSync(file) && !opts.force) throw new Error(`pack "${id}" already exists: ${file} (use --force to overwrite)`);
  const text = packTemplate(id, opts.title);
  const r = parsePack(text);
  if (!r.ok) throw new Error(`internal: the pack template is invalid:\n  ${r.errors.join('\n  ')}`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  return { file, pack: r.pack };
}

/** The haunt.yaml for a pack (its stages, a Phoenix-less starting point): what `haunt init --pack <id>` writes. */
export function initYaml(pack: Pack): string {
  return labToYaml(packToLabModel(pack, PACK_TIERS.rookie));
}

export interface InitResult { file: string; created: boolean }

/** `haunt init [--pack id]`: writes haunt.yaml in `dir` (never overwrites without force). Without a pack it starts from the stages of the generic template. */
export function writeInit(dir: string, packsDir: string, packId: string | undefined, force = false): InitResult {
  const file = join(dir, 'haunt.yaml');
  if (existsSync(file) && !force) return { file, created: false };
  const pack = packId ? loadPack(packsDir, packId) : (() => { const r = parsePack(packTemplate('my-app')); if (!r.ok) throw new Error(r.errors.join('; ')); return r.pack; })();
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, initYaml(pack));
  return { file, created: true };
}
