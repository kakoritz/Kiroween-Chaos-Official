// Demo scripts: data files under packages/core/demo/ listing timed chaos presses. Spec: runtime.md section 16.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BOSSES, faultById } from '../../../haunt/src/chaos/catalog';
import type { TierMode } from '../../../haunt/src/runner/lanes';

export interface DemoPress { atMs: number; lane: number; fault: string; creature: string; point?: string; scope?: 'inner' | 'outer' }
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
  for (const p of d.presses) {
    if (!Number.isFinite(p.atMs) || p.atMs < last) bad('presses must be sorted by atMs');
    last = p.atMs;
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
  const path = fileURLToPath(new URL(`../../demo/${name}.json`, import.meta.url));
  return validateDemo(JSON.parse(readFileSync(path, 'utf8')));
}
