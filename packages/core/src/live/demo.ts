// Demo scripts: data files under packages/core/demo/ listing timed chaos presses. Spec: runtime.md section 16.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOSSES, faultById } from '../../../haunt/src/chaos/catalog';
import type { TierMode } from '../../../haunt/src/runner/lanes';

export interface DemoWhen { lane: number; event: string; stage?: string; order?: string; attempt?: number }
/**
 * One press. Timing is one of: `atMs` (1x ms since playback start), `when` (first matching event on that lane,
 * runtime.md section 27), or `afterPrevMs` (1x ms after the previous entry fired). `delayMs` waits after a `when` match.
 * `forEachOrder` keeps a `when` entry live and fires it once per order.
 */
export interface DemoPress {
  atMs?: number; when?: DemoWhen; afterPrevMs?: number; delayMs?: number; forEachOrder?: boolean;
  lane: number; fault: string; creature: string; point?: string; scope?: 'inner' | 'outer';
}
export interface DemoBoss { id: string; warnAtMs: number; startAtMs: number }
export interface DemoScript {
  name: string; seed: number; pace: 'show'; orders: number; lanes: number; tiers: TierMode;
  presses: DemoPress[]; boss?: DemoBoss;
}

export const DEMO_NAMES = ['hero', 'full', 'loop'] as const;

/** Throws with a readable message if the script is malformed. Returns it typed otherwise. */
export function validateDemo(raw: unknown): DemoScript {
  const d = raw as DemoScript;
  const bad = (m: string): never => { throw new Error(`demo script: ${m}`); };
  if (!d || typeof d !== 'object') bad('not an object');
  if (typeof d.name !== 'string' || !d.name) bad('name');
  if (!Number.isInteger(d.seed)) bad('seed');
  if (d.pace !== 'show') bad('pace must be "show"');
  if (!Number.isInteger(d.orders) || d.orders < 1) bad('orders');
  if (!Number.isInteger(d.lanes) || d.lanes < 1 || d.lanes > 5) bad('lanes');
  if (d.tiers !== 'race' && d.tiers !== 'allPhoenix') bad('tiers');
  if (!Array.isArray(d.presses)) bad('presses');
  let last = -1;
  for (const [i, p] of d.presses.entries()) {
    if (p.when) {
      if (!Number.isInteger(p.when.lane) || p.when.lane < 1 || p.when.lane > d.lanes) bad('when lane out of range');
      if (typeof p.when.event !== 'string' || !p.when.event) bad('when event');
    } else if (p.afterPrevMs !== undefined) {
      if (!Number.isFinite(p.afterPrevMs) || p.afterPrevMs < 0 || i === 0) bad('afterPrevMs needs a previous press');
    } else {
      if (p.atMs === undefined || !Number.isFinite(p.atMs) || p.atMs < last) bad('presses must be sorted by atMs');
      last = p.atMs as number;
    }
    if (p.forEachOrder && !p.when) bad('forEachOrder needs when');
    if (!Number.isInteger(p.lane) || p.lane < 1 || p.lane > d.lanes) bad(`lane ${p.lane} out of range`);
    const f = faultById(p.fault);
    if (!f) bad(`unknown fault ${p.fault}`);
    else if (f.creature !== p.creature) bad(`fault ${p.fault} belongs to ${f.creature}, not ${p.creature}`);
  }
  if (d.boss) {
    if (!(BOSSES as readonly string[]).includes(d.boss.id)) bad(`unknown boss ${d.boss.id}`);
    if (!(d.boss.startAtMs > d.boss.warnAtMs)) bad('boss start must follow warning');
  }
  return d;
}

export function loadDemo(name: string): DemoScript {
  if (!(DEMO_NAMES as readonly string[]).includes(name)) throw new Error(`unknown demo script: ${name}`);
  // Bundled runs (tools/run-ts.mjs writes to .tmp/run/) move import.meta.url, so fall back to the repo path from cwd.
  const near = fileURLToPath(new URL(`../../demo/${name}.json`, import.meta.url));
  const path = existsSync(near) ? near : join(process.cwd(), 'packages', 'core', 'demo', `${name}.json`);
  return validateDemo(JSON.parse(readFileSync(path, 'utf8')));
}
