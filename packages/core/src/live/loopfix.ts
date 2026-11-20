// Events between loop waves: the reviewer's hardening spec, the recorded fix and the parts the hardened bundle adds.
// Spec: runtime.md section 32; contract/PROTOCOL.md rules 26 and the `loop` demo.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HauntEvent } from '../../../haunt/src/score/score';
import type { HardeningBody } from './runtime';

/** Parts a built bot bundle declares (`node <bundle> --parts`). Empty when the bundle is missing or prints nothing usable. */
export function botParts(file: string): string[] {
  if (!existsSync(file)) return [];
  const r = spawnSync(process.execPath, [file, '--parts'], { encoding: 'utf8', timeout: 10000 });
  try {
    const p = (JSON.parse(r.stdout) as { parts?: unknown }).parts;
    return Array.isArray(p) ? p.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

/** Lines added and deleted going from `before` to `after`, as multiset differences (no ordering). */
export function lineDelta(before: string, after: string): { add: number; del: number } {
  const count = new Map<string, number>();
  for (const l of before.split(/\r?\n/)) count.set(l, (count.get(l) ?? 0) + 1);
  let add = 0;
  for (const l of after.split(/\r?\n/)) {
    const c = count.get(l) ?? 0;
    if (c > 0) count.set(l, c - 1); else add++;
  }
  let del = 0;
  for (const c of count.values()) del += c;
  return { add, del };
}

export interface LoopFixOptions {
  /** Lane that swaps to the hardened bundle. */
  lane: string;
  /** Source files of the original and the hardened bot, as repo-relative paths. */
  beforeSrc: string;
  afterSrc: string;
  /** Built bundles that declare parts. */
  beforeBundle: string;
  afterBundle: string;
  root: string;
  hardening?: () => HardeningBody | undefined;
}

/** `hardening_spec`, `fix_applied{recorded:true}`, then one `part_added` per part the hardened bundle adds, in that order. */
export function loopFixEvents(o: LoopFixOptions): HauntEvent[] {
  const evs: HauntEvent[] = [];
  const h = o.hardening?.();
  const spec = h?.spec ?? 'hardening';
  if (h) {
    const ids = new Set<string>();
    for (const f of h.files) for (const m of f.content.matchAll(/\bF\d+\b/g)) ids.add(m[0]);
    evs.push({ type: 'hardening_spec', detail: { spec, title: h.title, path: `.kiro/specs/${h.spec}/`, findings: ids.size } } as HauntEvent);
  }
  const read = (p: string) => { const f = join(o.root, p); return existsSync(f) ? readFileSync(f, 'utf8') : ''; };
  const d = lineDelta(read(o.beforeSrc), read(o.afterSrc));
  evs.push({ type: 'fix_applied', detail: { spec, files: [{ path: o.afterSrc, add: d.add, del: d.del }], recorded: true } } as HauntEvent);
  const had = new Set(botParts(o.beforeBundle));
  for (const part of botParts(o.afterBundle)) {
    if (!had.has(part)) evs.push({ type: 'part_added', lane: o.lane, detail: { part, source: 'hardening_spec', spec } } as HauntEvent);
  }
  return evs;
}
