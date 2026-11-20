// Runner lane setup: lane to tier mapping (runtime.md section 11) and per-lane order input layout (section 5).
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateOrders, orderId, tierById, type OrderData, type TierDef, type TierId } from '../pipeline/pipeline';

export type TierMode = 'race' | 'allPhoenix';

const RACE_SETS: Record<number, readonly TierId[]> = {
  1: ['phoenix'],
  2: ['rookie', 'phoenix'],
  3: ['rookie', 'journaler', 'phoenix'],
  4: ['rookie', 'retrier', 'journaler', 'phoenix'],
  5: ['rookie', 'retrier', 'journaler', 'reconciler', 'phoenix'],
};

/** Tier for each lane, in lane order. */
export function tiersForLanes(lanes: number, mode: TierMode = 'race'): TierDef[] {
  if (!Number.isInteger(lanes) || lanes < 1 || lanes > 5) throw new Error(`lanes must be 1 to 5, got ${lanes}`);
  const ids = mode === 'allPhoenix' ? Array<TierId>(lanes).fill('phoenix') : RACE_SETS[lanes]!;
  return ids.map(tierById);
}

export const LANE_SUBDIRS = ['orders', 'done', 'failed', 'parked', 'quarantine'] as const;

export interface LanePaths {
  root: string;
  orders: string;
  done: string;
  failed: string;
  parked: string;
  quarantine: string;
  orig: string;
}

export function lanePaths(runDir: string, lane: number): LanePaths {
  const root = join(runDir, `lane-${lane}`);
  return {
    root,
    orders: join(root, 'orders'),
    done: join(root, 'done'),
    failed: join(root, 'failed'),
    parked: join(root, 'parked'),
    quarantine: join(root, 'quarantine'),
    orig: join(root, 'orig'),
  };
}

/** Write ord-0001.json .. ord-<N>.json and the empty outcome folders. Returns the orders written. */
export function prepareLane(runDir: string, lane: number, seed: string | number, count: number): { paths: LanePaths; orders: OrderData[] } {
  const paths = lanePaths(runDir, lane);
  for (const d of LANE_SUBDIRS) mkdirSync(paths[d], { recursive: true });
  const orders = generateOrders(seed, count);
  for (const o of orders) writeFileSync(join(paths.orders, `${o.id}.json`), JSON.stringify(o));
  return { paths, orders };
}

/** Lowest-named file in `orders/`, or undefined when empty. Hidden (`.haunted`) files are skipped. */
export function nextOrderFile(paths: LanePaths): string | undefined {
  return readdirSync(paths.orders).filter((f) => f.endsWith('.json')).sort()[0];
}

/** Files still in `orders/` (including `.haunted` ones); the runner emits `order_abandoned` for each of a halted lane. */
export function abandonedOrders(paths: LanePaths): string[] {
  return readdirSync(paths.orders).sort().map((f) => f.replace(/(\.dup)?\.json(\.haunted)?$/, '')).filter((v, i, a) => a.indexOf(v) === i);
}

/** `duplicate_request`: copy the current order file to `ord-<N>.dup.json`. Returns the dup name, or undefined if no order is pending. */
export function injectDuplicate(paths: LanePaths): string | undefined {
  const f = nextOrderFile(paths);
  if (!f) return undefined;
  const dup = f.replace(/\.json$/, '.dup.json');
  copyFileSync(join(paths.orders, f), join(paths.orders, dup));
  return dup;
}

/** `missing_file`: rename `ord-<k>.json` to `.haunted`. Returns a restore function. */
export function hauntFile(paths: LanePaths, file: string): () => void {
  const from = join(paths.orders, file);
  const to = `${from}.haunted`;
  renameSync(from, to);
  return () => {
    if (existsSync(to)) renameSync(to, from);
  };
}

/** `malformed_payload`: truncate the next unread file, saving the original in `orig/`. Returns the file hit. */
export function corruptNext(paths: LanePaths): string | undefined {
  const f = nextOrderFile(paths);
  if (!f) return undefined;
  mkdirSync(paths.orig, { recursive: true });
  copyFileSync(join(paths.orders, f), join(paths.orig, f));
  writeFileSync(join(paths.orders, f), '{"id":"' + f.slice(0, 8) + '","items":[');
  return f;
}

export { orderId };
