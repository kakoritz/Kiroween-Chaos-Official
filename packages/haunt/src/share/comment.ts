// Share: Markdown for the pull request comment of the GitHub Action. Spec: share/spec.md section 3 (SH-C2).
// Pure code and deterministic. It only builds a string; the Action posts it with `gh`.
import { scorecardData, esc } from './badge';

/** Hidden marker so the Action can find and update its own comment instead of adding a new one. */
export const COMMENT_MARKER = '<!-- haunt-sweep-comment -->';

export interface CommentOptions {
  /** Link or relative path to the badge image, for example the uploaded artifact. Optional. */
  badgeUrl?: string;
  /** Link to the workflow run with the artifacts. Optional. */
  runUrl?: string;
  /** Whether the configured targets passed. Undefined means unknown. */
  targetsPassed?: boolean;
}

const ICON: Record<string, string> = { pass: 'ok', recovered_late: 'late', repeat: 'repeat', fail: 'FAIL', halt: 'HALT', na: '-' };
const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/** Markdown report: grade line, small stage by fault table, top findings. */
export function renderPrComment(report: unknown, opts: CommentOptions = {}): string {
  const d = scorecardData(report);
  const lines: string[] = [COMMENT_MARKER];
  const badge = opts.badgeUrl ? `![Kiroween Chaos ${d.grade} ${d.score}](${opts.badgeUrl}) ` : '';
  lines.push(`## ${badge}Kiroween Chaos: grade ${d.grade} (${d.score})`);
  lines.push('');
  const status = opts.targetsPassed === undefined ? 'unknown' : opts.targetsPassed ? 'passed' : 'FAILED';
  lines.push(`App \`${cell(d.app)}\`. Targets: **${status}**. Reliability ${d.reliabilityPct}%, repeated side effects ${d.repeats}, lost orders ${d.lost}.`);
  if (d.recoveryP50 !== undefined || d.recoveryP95 !== undefined) {
    lines.push(`Recovery p50 ${d.recoveryP50 ?? '-'} s, p95 ${d.recoveryP95 ?? '-'} s.`);
  }
  if (d.tiers.length) {
    lines.push('');
    lines.push('| Tier | Grade | Score |');
    lines.push('| --- | --- | --- |');
    for (const t of d.tiers) lines.push(`| ${cell(t.tier)} | ${t.grade} | ${t.score} |`);
  }
  if (d.stages.length && d.faults.length) {
    lines.push('');
    lines.push(`| Stage | ${d.faults.map(cell).join(' | ')} |`);
    lines.push(`| --- |${d.faults.map(() => ' --- |').join('')}`);
    for (const s of d.stages) {
      const row = d.faults.map((f) => {
        const r = d.cells[`${s}\u0000${f}`];
        return r === undefined ? '' : (ICON[r] ?? r);
      });
      lines.push(`| ${cell(s)} | ${row.join(' | ')} |`);
    }
  }
  if (d.findings.length) {
    lines.push('');
    lines.push('Top findings:');
    for (const f of d.findings) lines.push(`- ${cell(esc(f))}`);
  }
  if (opts.runUrl) {
    lines.push('');
    lines.push(`Full report and badge: [workflow run artifacts](${opts.runUrl}).`);
  }
  return `${lines.join('\n')}\n`;
}
