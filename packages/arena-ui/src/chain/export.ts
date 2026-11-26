// Export a chain result as one self-contained page and a badge (chain-wizard-v2 second list, item 6). Pure: text in, text out.
import type { ChainReport } from '../../../haunt/src/blocks/cards';
import type { ChainModel } from './model';
import { toYaml } from './model';

const esc = (t: string): string => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const COLOR: Record<string, string> = { A: '#2e9e5b', B: '#7cb342', C: '#e0a800', D: '#e67e22', F: '#d64545' };
const colorOf = (g: string): string => COLOR[g.charAt(0).toUpperCase()] ?? '#888';

/** A small SVG badge: "chaos grade | A". */
export function chainBadge(report: ChainReport): string {
  const g = esc(report.grade), c = colorOf(report.grade);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="132" height="20" role="img" aria-label="chaos grade: ${g}"><rect width="86" height="20" fill="#3b3b4f"/><rect x="86" width="46" height="20" fill="${c}"/><g fill="#fff" font-family="Verdana,sans-serif" font-size="11" text-anchor="middle"><text x="43" y="14">chaos grade</text><text x="109" y="14">${g}</text></g></svg>\n`;
}

export interface ExportInput { model: ChainModel; report: ChainReport; protections: string; date?: string }

/** One HTML file: no script, no outside request. Says plainly that the result is model-based. */
export function chainReportHtml(i: ExportInput): string {
  const r = i.report;
  const rows = [...r.blame].sort((a, b) => b.failed - a.failed)
    .map((b) => `<tr><td>${esc(b.stage)}</td><td>${esc(b.block ?? 'custom')}</td><td>${b.failed}/${b.tried}</td><td>${Math.round(b.share * 100)}%</td></tr>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Chaos report: ${esc(i.model.name)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#1d1d26}h1{margin:0}.g{display:inline-block;font-size:3rem;font-weight:700;color:#fff;background:${colorOf(r.grade)};border-radius:.5rem;padding:0 1rem;margin:.5rem 0}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:.3rem .5rem;text-align:left}pre{background:#f4f4f8;padding:.7rem;overflow:auto}.n{color:#555;font-size:.9rem}</style></head>
<body><h1>${esc(i.model.name)}</h1>
<p class="n">Chaos report${i.date ? `, ${esc(i.date)}` : ''}. Protections: ${esc(i.protections)}.</p>
<div class="g" aria-label="grade ${esc(r.grade)}">${esc(r.grade)}</div>
<p>${r.failed} of ${r.tried} attacks did not end clean. Reliability ${Math.round(r.reliability * 100)}%.</p>
<h2>Who failed</h2>
<table><tr><th>Stage</th><th>Block</th><th>Failed</th><th>Share</th></tr>${rows}</table>
<h2>The chain (haunt.yaml)</h2>
<pre>${esc(toYaml(i.model))}</pre>
<p class="n">Model-based what-if: the same rules as the Workflow Lab, not your running code. Run your real bot in the arena to confirm.</p>
</body></html>
`;
}

export const exportFileName = (m: ChainModel, kind: 'report' | 'badge'): string =>
  `${(m.name || 'chain').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'chain'}-${kind === 'report' ? 'chaos-report.html' : 'chaos-badge.svg'}`;
