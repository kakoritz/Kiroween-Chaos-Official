// H7: `haunt report <run>`. Finds a saved run (a report path, .haunt/runs/<run>/report.json or a file under one of the
// .haunt result folders) and prints it as json, md or html. Local files only.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { renderHtml, renderMarkdown, type Report } from './builder';
import { renderScorecardHtml, scorecardData } from '../share/badge';

export const REPORT_FORMATS = ['json', 'md', 'html'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];
const RESULT_DIRS = ['sweeps', 'ramps', 'stacks', 'soaks', 'bosses'];

/** A run is a report file path, a run id under .haunt/runs, or a name under one of the .haunt result folders (with or without .json). */
export function findAnyRun(root: string, id: string): string | null {
  const cands = [resolve(root, id)];
  if (/^run-[A-Za-z0-9._-]+$/.test(id)) cands.push(join(root, '.haunt', 'runs', id, 'report.json'));
  for (const d of RESULT_DIRS) cands.push(join(root, '.haunt', d, id), join(root, '.haunt', d, `${id}.json`));
  return cands.find((p) => p.endsWith('.json') && existsSync(p)) ?? null;
}

const isFullReport = (r: unknown): r is Report => {
  const o = r as Record<string, unknown> | null;
  return !!o && typeof o.run === 'string' && Array.isArray(o.matrix) && Array.isArray(o.findings) && typeof o.recovery === 'object' && o.recovery !== null;
};

/** The report in the asked format. A full report (writeReport) uses its own renderers; a plain sweep, ramp, stack, soak or boss file gets the scorecard. */
export function renderRunReport(data: unknown, format: ReportFormat): string {
  if (format === 'json') return `${JSON.stringify(data, null, 2)}\n`;
  if (isFullReport(data)) return format === 'md' ? renderMarkdown(data) : renderHtml(data);
  const d = scorecardData(data);
  if (format === 'html') return renderScorecardHtml(d);
  const lines = [`# ${d.app}: grade ${d.grade}`, '', `Reliability ${d.reliabilityPct}%. Repeats ${d.repeats}. Lost orders ${d.lost}.`];
  if (d.recoveryP50 !== undefined) lines.push(`Recovery p50 ${d.recoveryP50} ms, p95 ${d.recoveryP95 ?? d.recoveryP50} ms.`);
  if (d.tiers.length) lines.push('', ...d.tiers.map((t) => `- ${t.tier}: ${t.grade} (${t.score})`));
  if (d.findings.length) lines.push('', '## Findings', ...d.findings.map((f) => `- ${f}`));
  return `${lines.join('\n')}\n`;
}

/** Returns the text to print, or an error message. */
export function reportCommand(root: string, id: string, format: string): { text: string } | { error: string } {
  if (!(REPORT_FORMATS as readonly string[]).includes(format)) return { error: `--format: one of ${REPORT_FORMATS.join(' | ')}` };
  const file = findAnyRun(root, id);
  if (!file) return { error: `run not found: ${id}` };
  let data: unknown;
  try { data = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { return { error: `unreadable report ${file}: ${String(e)}` }; }
  return { text: renderRunReport(data, format as ReportFormat) };
}
