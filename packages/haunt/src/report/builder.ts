// Report builder: JSON, Markdown and offline HTML. Spec: runtime.md section 9 (Report JSON), tasks.md H4.2.
import type { Grade } from '../score/grade';
import type { RampStep, ScalabilityGrade } from '../ramp/detect';
import { recoveryStats, type RecoveryStats, type TargetResult } from './targets';

export type MatrixResult = 'pass' | 'repeat' | 'recovered_late' | 'fail' | 'halt' | 'na';
export type Severity = 'high' | 'medium' | 'low';

export interface ReportRepeat { kind: string; extra: number }
export interface MatrixEntry {
  stage: string;
  fault: string;
  point?: string;
  result: MatrixResult;
  repeats: ReportRepeat[];
  recoverMs?: number;
  evidenceSeq: number[];
}
export interface RepeatRow { order: string; kind: string; extra: number; stage: string; fault: string }
export interface LostRow { order: string; reason: 'paid_not_fulfilled' | 'abandoned' }
export interface Finding {
  id: string;
  rule: string;
  severity: Severity;
  stage: string;
  fault: string;
  summary: string;
  evidenceSeq: number[];
  suggestedPart: string;
}
/** One lap of a live run (PT-C11): wall time of the order, its review, and the cancelled label. */
export interface LapRow { order: string; ms: number; stars?: number; cancelled?: boolean; downtimeMs?: number }
export interface TierRow { tier: string; grade: Grade; score: number }

export interface ReportInput {
  run: string;
  mode: string;
  seed: number;
  app: string;
  generatedAt: string;
  grade: Grade;
  reliability: number;
  scalability?: ScalabilityGrade;
  matrix: MatrixEntry[];
  recoveryMs: number[];
  repeats: RepeatRow[];
  lost: LostRow[];
  ramp?: RampStep[];
  knee?: number;
  breakPoint?: number;
  depth?: { stage: string; maxSurvivedDepth: number }[];
  targets: TargetResult[];
  findings: Finding[];
  tiers?: TierRow[];
  laps?: LapRow[];
}

export interface Report {
  run: string;
  mode: string;
  seed: number;
  app: string;
  generatedAt: string;
  grade: Grade;
  reliability: number;
  scalability?: ScalabilityGrade;
  matrix: MatrixEntry[];
  recovery: RecoveryStats;
  repeats: RepeatRow[];
  lost: LostRow[];
  ramp?: RampStep[];
  knee?: number;
  breakPoint?: number;
  depth?: { stage: string; maxSurvivedDepth: number }[];
  targets: TargetResult[];
  findings: Finding[];
  tiers?: TierRow[];
  laps?: LapRow[];
}

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Assemble the report with fixed key order and stable row order so equal inputs give equal JSON. */
export function buildReport(i: ReportInput): Report {
  const r: Report = {
    run: i.run,
    mode: i.mode,
    seed: i.seed,
    app: i.app,
    generatedAt: i.generatedAt,
    grade: i.grade,
    reliability: i.reliability,
  } as Report;
  if (i.scalability !== undefined) r.scalability = i.scalability;
  r.matrix = [...i.matrix].sort(
    (a, b) => cmp(a.stage, b.stage) || cmp(a.fault, b.fault) || cmp(a.point ?? '', b.point ?? ''),
  );
  r.recovery = recoveryStats(i.recoveryMs);
  r.repeats = [...i.repeats].sort((a, b) => cmp(a.order, b.order) || cmp(a.kind, b.kind));
  r.lost = [...i.lost].sort((a, b) => cmp(a.order, b.order));
  if (i.ramp) r.ramp = i.ramp;
  if (i.knee !== undefined) r.knee = i.knee;
  if (i.breakPoint !== undefined) r.breakPoint = i.breakPoint;
  if (i.depth) r.depth = i.depth;
  r.targets = i.targets;
  r.findings = [...i.findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || cmp(a.id, b.id),
  );
  if (i.tiers) r.tiers = i.tiers;
  if (i.laps) r.laps = [...i.laps].sort((a, b) => cmp(a.order, b.order));
  return r;
}

export function renderJson(r: Report): string {
  return JSON.stringify(r, null, 2) + '\n';
}

/** JSON with generatedAt removed, for the determinism comparison. */
export function renderJsonStable(r: Report): string {
  const { generatedAt: _omit, ...rest } = r;
  return JSON.stringify(rest, null, 2) + '\n';
}

function mdCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

const lapMs = (l: LapRow): string => (l.cancelled ? 'cancelled' : String(l.ms));
const lapStars = (l: LapRow): string => (l.cancelled ? 'cancelled' : l.stars === undefined ? '' : String(l.stars));

export function renderMarkdown(r: Report): string {
  const L: string[] = [];
  L.push(`# Chaos Haunt report: ${r.app}`, '');
  L.push(`Run \`${r.run}\`, mode ${r.mode}, seed ${r.seed}.`, '');
  L.push(`**Grade ${r.grade}** (reliability ${r.reliability.toFixed(1)})` + (r.scalability ? `, scalability ${r.scalability}` : ''), '');
  L.push('## Targets', '', '| Target | Value | Limit | Result |', '|---|---|---|---|');
  for (const t of r.targets) L.push(`| ${mdCell(t.name)} | ${t.value} | ${t.target} | ${t.pass ? 'pass' : 'FAIL'} |`);
  L.push('', '## Recovery', '', `p50 ${r.recovery.p50} ms, p95 ${r.recovery.p95} ms, max ${r.recovery.max} ms (${r.recovery.count} samples).`, '');
  L.push('## Matrix', '', '| Stage | Fault | Point | Result | Recover ms |', '|---|---|---|---|---|');
  for (const m of r.matrix) {
    L.push(`| ${mdCell(m.stage)} | ${mdCell(m.fault)} | ${mdCell(m.point ?? '')} | ${m.result} | ${m.recoverMs ?? ''} |`);
  }
  L.push('', '## Repeated side effects', '');
  if (r.repeats.length === 0) L.push('None.');
  else for (const x of r.repeats) L.push(`- ${x.order} ${x.kind} x${x.extra} extra at ${x.stage} (${x.fault})`);
  L.push('', '## Lost orders', '');
  if (r.lost.length === 0) L.push('None.');
  else for (const x of r.lost) L.push(`- ${x.order}: ${x.reason}`);
  if (r.ramp) {
    L.push('', '## Ramp', '', '| Concurrency | Throughput/min | p50 | p95 | Error rate |', '|---|---|---|---|---|');
    for (const s of r.ramp) L.push(`| ${s.concurrency} | ${s.throughputPerMin} | ${s.p50} | ${s.p95} | ${s.errorRate} |`);
    L.push('', `Knee: ${r.knee ?? 'none'}. Break point: ${r.breakPoint ?? 'none'}.`);
  }
  if (r.depth) {
    L.push('', '## Depth', '');
    for (const d of r.depth) L.push(`- ${d.stage}: ${d.maxSurvivedDepth}`);
  }
  if (r.tiers) {
    L.push('', '## Tiers', '', '| Tier | Grade | Score |', '|---|---|---|');
    for (const t of r.tiers) L.push(`| ${mdCell(t.tier)} | ${t.grade} | ${t.score} |`);
  }
  if (r.laps) {
    L.push('', '## Laps and stars', '', '| Order | Lap ms | Stars | Downtime ms |', '|---|---|---|---|');
    for (const l of r.laps) L.push(`| ${mdCell(l.order)} | ${lapMs(l)} | ${lapStars(l)} | ${l.downtimeMs ?? ''} |`);
  }
  L.push('', '## Findings', '');
  if (r.findings.length === 0) L.push('None.');
  else {
    for (const f of r.findings) {
      L.push(`- **${f.severity}** ${f.id} (${f.rule}) at ${f.stage}/${f.fault}: ${f.summary} Suggested part: \`${f.suggestedPart}\`.`);
    }
  }
  return L.join('\n') + '\n';
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function table(head: string[], rows: (string | number)[][]): string {
  const th = head.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
  const body = rows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(String(c))}</td>`).join('')}</tr>`).join('');
  return `<table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`;
}

const CSS =
  'body{font:14px system-ui,sans-serif;margin:2rem auto;max-width:960px;color:#1b1b1f;background:#fafafa}' +
  'table{border-collapse:collapse;width:100%;margin:.5rem 0 1.5rem}th,td{border:1px solid #ccc;padding:4px 8px;text-align:left}' +
  'th{background:#eee}.grade{font-size:2rem;font-weight:700}.fail,.halt{color:#b00020}.pass{color:#1b5e20}';

/** Single self-contained HTML file: inline CSS, no scripts, no external requests. */
export function renderHtml(r: Report): string {
  const P: string[] = [];
  P.push(`<h1>Chaos Haunt report: ${escapeHtml(r.app)}</h1>`);
  P.push(`<p>Run <code>${escapeHtml(r.run)}</code>, mode ${escapeHtml(r.mode)}, seed ${r.seed}, generated ${escapeHtml(r.generatedAt)}.</p>`);
  P.push(
    `<p class="grade">Grade ${r.grade}</p><p>Reliability ${r.reliability.toFixed(1)}` +
      (r.scalability ? `, scalability ${r.scalability}` : '') +
      '</p>',
  );
  P.push('<h2>Targets</h2>' + table(['Target', 'Value', 'Limit', 'Result'], r.targets.map((t) => [t.name, t.value, t.target, t.pass ? 'pass' : 'FAIL'])));
  P.push(`<h2>Recovery</h2><p>p50 ${r.recovery.p50} ms, p95 ${r.recovery.p95} ms, max ${r.recovery.max} ms (${r.recovery.count} samples).</p>`);
  P.push('<h2>Matrix</h2>' + table(['Stage', 'Fault', 'Point', 'Result', 'Recover ms'], r.matrix.map((m) => [m.stage, m.fault, m.point ?? '', m.result, m.recoverMs ?? ''])));
  P.push('<h2>Repeated side effects</h2>' + table(['Order', 'Kind', 'Extra', 'Stage', 'Fault'], r.repeats.map((x) => [x.order, x.kind, x.extra, x.stage, x.fault])));
  P.push('<h2>Lost orders</h2>' + table(['Order', 'Reason'], r.lost.map((x) => [x.order, x.reason])));
  if (r.ramp) {
    P.push('<h2>Ramp</h2>' + table(['Concurrency', 'Throughput/min', 'p50', 'p95', 'Error rate'], r.ramp.map((s) => [s.concurrency, s.throughputPerMin, s.p50, s.p95, s.errorRate])));
    P.push(`<p>Knee: ${r.knee ?? 'none'}. Break point: ${r.breakPoint ?? 'none'}.</p>`);
  }
  if (r.depth) P.push('<h2>Depth</h2>' + table(['Stage', 'Max survived depth'], r.depth.map((d) => [d.stage, d.maxSurvivedDepth])));
  if (r.tiers) P.push('<h2>Tiers</h2>' + table(['Tier', 'Grade', 'Score'], r.tiers.map((t) => [t.tier, t.grade, t.score])));
  if (r.laps) P.push('<h2>Laps and stars</h2>' + table(['Order', 'Lap ms', 'Stars', 'Downtime ms'], r.laps.map((l) => [l.order, lapMs(l), lapStars(l), l.downtimeMs ?? ''])));
  P.push('<h2>Findings</h2>' + table(['Severity', 'Id', 'Rule', 'Stage', 'Fault', 'Summary', 'Suggested part'], r.findings.map((f) => [f.severity, f.id, f.rule, f.stage, f.fault, f.summary, f.suggestedPart])));
  return (
    '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>Chaos Haunt report: ' +
    escapeHtml(r.app) +
    '</title><style>' +
    CSS +
    '</style></head><body>' +
    P.join('\n') +
    '</body></html>\n'
  );
}
