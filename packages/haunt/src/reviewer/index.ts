// Reviewer entry: review events, write postmortem.md and the hardening spec. Spec: runtime.md section 10.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HauntEvent } from '../score/score';
import type { Finding } from '../report/builder';
import { reviewEvents, type ReviewOptions } from './rules';
import { renderHardening, renderPostmortem, type HardeningFiles } from './render';

export * from './rules';
export * from './render';

export interface ReviewResult { findings: Finding[]; postmortem: string; hardening: HardeningFiles }

export function runReviewer(run: string, events: HauntEvent[], opts: ReviewOptions & { botFile?: string } = {}): ReviewResult {
  const findings = reviewEvents(events, opts);
  return { findings, postmortem: renderPostmortem(run, findings), hardening: renderHardening(run, findings, opts.botFile) };
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
  return { postmortem, specDir };
}
