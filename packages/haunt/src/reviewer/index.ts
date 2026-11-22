// Reviewer entry: review events, write postmortem.md and the hardening spec. Spec: runtime.md section 10.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HauntEvent } from '../score/score';
import type { Finding } from '../report/builder';
import { reviewEvents, type ReviewOptions } from './rules';
import { renderHardening, renderPostmortem, type HardeningFiles } from './render';
import { PatternStore, minePatterns } from '../miner/patterns';
import { renderFixSpec, type FixSpec } from '../miner/specs';

export * from './rules';
export * from './render';

export interface ReviewResult { findings: Finding[]; postmortem: string; hardening: HardeningFiles; /** The serious spec of TV3-C12, when `fixSpec` was asked for. */ fixSpec?: FixSpec }

export function runReviewer(run: string, events: HauntEvent[], opts: ReviewOptions & { botFile?: string; fixSpec?: boolean } = {}): ReviewResult {
  const findings = reviewEvents(events, opts);
  const base: ReviewResult = { findings, postmortem: renderPostmortem(run, findings), hardening: renderHardening(run, findings, opts.botFile) };
  if (!opts.fixSpec) return base;
  // The pattern miner and fix spec writer (spec 8.2) replace the rule-based hardening text: same four-file layout, with evidence, patch, test and diff budget.
  const store = new PatternStore('');
  store.ingest(minePatterns({ run, events: events as never }), run);
  const fixSpec = renderFixSpec({ runId: run, patterns: store.list() });
  return { ...base, hardening: { requirements: fixSpec.requirements, design: fixSpec.design, tasks: fixSpec.tasks }, fixSpec };
}

export interface WrittenReview { postmortem: string; specDir: string }

/** Writes `<root>/.haunt/runs/<run>/postmortem.md` and `<specsDir>/hardening-<run>/{requirements,design,tasks}.md`. */
export function writeReview(root: string, specsDir: string, run: string, r: ReviewResult): WrittenReview {
  if (!/^[A-Za-z0-9._-]+$/.test(run) || run.startsWith('.')) throw new Error(`unsafe run id: ${run}`);
  const runDir = join(root, '.haunt', 'runs', run);
  const specDir = join(specsDir, `hardening-${run}`);
  mkdirSync(runDir, { recursive: true });
  mkdirSync(specDir, { recursive: true });
  const postmortem = join(runDir, 'postmortem.md');
  writeFileSync(postmortem, r.postmortem);
  writeFileSync(join(specDir, 'requirements.md'), r.hardening.requirements);
  writeFileSync(join(specDir, 'design.md'), r.hardening.design);
  writeFileSync(join(specDir, 'tasks.md'), r.hardening.tasks);
  if (r.fixSpec) writeFileSync(join(specDir, 'README.md'), r.fixSpec.readme);
  return { postmortem, specDir };
}
