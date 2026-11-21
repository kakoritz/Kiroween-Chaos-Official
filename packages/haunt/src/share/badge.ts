// Share: grade badge (shields style SVG) and 1200x630 scorecard (SVG and HTML). Spec: share/spec.md section 2 (SH-C1).
// Pure code: no clock, no random, no external fonts or images, so the same report gives the same bytes.
import type { Grade } from '../score/grade';

export const GRADE_COLOURS: Record<Grade, string> = {
  A: '#2ea44f',
  B: '#97ca00',
  C: '#dfb317',
  D: '#fe7d37',
  F: '#e05d44',
};

const RESULT_COLOURS: Record<string, string> = {
  pass: '#2ea44f',
  repeat: '#dfb317',
  recovered_late: '#97ca00',
  fail: '#e05d44',
  halt: '#8b1a1a',
  na: '#444a57',
};
const RESULT_ORDER = ['pass', 'recovered_late', 'repeat', 'fail', 'halt', 'na'];

type Json = Record<string, unknown>;

export interface ScorecardData {
  app: string;
  grade: Grade;
  score: number;
  reliabilityPct: number;
  repeats: number;
  lost: number;
  recoveryP50?: number;
  recoveryP95?: number;
  stages: string[];
  faults: string[];
  /** cell result by `${stage}\u0000${fault}` */
  cells: Record<string, string>;
  tiers: { tier: string; grade: Grade; score: number }[];
  findings: string[];
}

const GRADES: Grade[] = ['A', 'B', 'C', 'D', 'F'];
const asGrade = (v: unknown): Grade => (typeof v === 'string' && GRADES.includes(v as Grade) ? (v as Grade) : 'F');
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Normalise a saved report (full report or a plain sweep report) into the fields the scorecard shows. */
export function scorecardData(report: unknown): ScorecardData {
  const r = (report ?? {}) as Json;
  const grade = asGrade(r.grade);
  const rel = num(r.reliability);
  const reliabilityPct = rel === undefined ? 0 : Math.round(rel <= 1 ? rel * 100 : rel);
  const score = rel === undefined ? { A: 95, B: 85, C: 70, D: 55, F: 25 }[grade] : reliabilityPct;
  const cells: Record<string, string> = {};
  const stages = new Set<string>();
  const faults = new Set<string>();
  const put = (stage: string, fault: string, result: string): void => {
    stages.add(stage);
    faults.add(fault);
    const key = `${stage}\u0000${fault}`;
    const prev = cells[key];
    const rank = (x: string): number => RESULT_ORDER.indexOf(x === 'n/a' ? 'na' : x);
    if (prev === undefined || rank(result) > rank(prev)) cells[key] = result === 'n/a' ? 'na' : result;
  };
  if (Array.isArray(r.matrix)) {
    for (const m of r.matrix as Json[]) put(String(m.stage ?? ''), String(m.fault ?? ''), String(m.result ?? 'na'));
  }
  if (Array.isArray(r.cells)) {
    for (const c of r.cells as Json[]) put(String(c.stage ?? ''), String(c.fault ?? c.creature ?? ''), String(c.outcome ?? 'na'));
  }
  const rec = (r.recovery ?? {}) as Json;
  const tiers = Array.isArray(r.tiers)
    ? (r.tiers as Json[]).map((t) => ({ tier: String(t.tier ?? ''), grade: asGrade(t.grade), score: num(t.score) ?? 0 }))
    : [];
  const sev: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const findings = Array.isArray(r.findings)
    ? (r.findings as Json[])
        .map((f) => ({ s: sev[String(f.severity)] ?? 3, id: String(f.id ?? ''), t: String(f.summary ?? f.rule ?? '') }))
        .sort((a, b) => a.s - b.s || cmp(a.id, b.id))
        .slice(0, 3)
        .map((f) => f.t)
    : [];
  const repeatsRaw = Array.isArray(r.repeats) ? (r.repeats as Json[]).reduce((n, x) => n + (num(x.extra) ?? 1), 0) : 0;
  const repeatCells = Array.isArray(r.cells) ? (r.cells as Json[]).filter((c) => Array.isArray(c.repeatedKinds) && c.repeatedKinds.length).length : 0;
  const lostRaw = Array.isArray(r.lost) ? r.lost.length : Array.isArray(r.cells) ? (r.cells as Json[]).filter((c) => c.lost === true).length : 0;
  return {
    app: String(r.app ?? 'app'),
    grade,
    score,
    reliabilityPct,
    repeats: repeatsRaw || repeatCells,
    lost: lostRaw,
    recoveryP50: num(rec.p50),
    recoveryP95: num(rec.p95),
    stages: [...stages].sort(cmp),
    faults: [...faults].sort(cmp),
    cells,
    tiers,
    findings,
  };
}

/** Shields-style badge, 20 px tall: label "Haunt", value "A 94". */
export function renderBadgeSvg(d: Pick<ScorecardData, 'grade' | 'score'>): string {
  const label = 'Haunt';
  const value = `${d.grade} ${d.score}`;
  const lw = 6 * label.length + 14;
  const vw = 6.6 * value.length + 14;
  const w = Math.round(lw + vw);
  const colour = GRADE_COLOURS[d.grade];
  const title = `${label}: ${value}`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${esc(title)}">`,
    `<title>${esc(title)}</title>`,
    `<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>`,
    `<clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>`,
    `<g clip-path="url(#r)"><rect width="${Math.round(lw)}" height="20" fill="#555"/><rect x="${Math.round(lw)}" width="${w - Math.round(lw)}" height="20" fill="${colour}"/><rect width="${w}" height="20" fill="url(#s)"/></g>`,
    `<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">`,
    `<text x="${Math.round(lw / 2)}" y="14">${label}</text>`,
    `<text x="${Math.round(lw + (w - lw) / 2)}" y="14" font-weight="bold">${esc(value)}</text>`,
    `</g></svg>`,
    '',
  ].join('\n');
}

const trunc = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}\u2026` : s);

/** 1200x630 social card. */
export function renderScorecardSvg(d: ScorecardData): string {
  const colour = GRADE_COLOURS[d.grade];
  const out: string[] = [];
  const t = (x: number, y: number, size: number, fill: string, s: string, extra = ''): void => {
    out.push(`<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${extra}>${esc(s)}</text>`);
  };
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" role="img" aria-label="Haunt resilience scorecard: ${esc(d.grade)} ${d.score}">`);
  out.push(`<title>Haunt resilience scorecard</title>`);
  out.push(`<rect width="1200" height="630" fill="#14121c"/><rect x="0" y="0" width="1200" height="8" fill="${colour}"/>`);
  t(48, 70, 34, '#ffffff', 'Haunt resilience scorecard', 'font-weight="bold"');
  t(48, 104, 20, '#a9a4bd', trunc(d.app, 60));
  // grade ring
  const cx = 220, cy = 270, rad = 100, circ = 2 * Math.PI * rad;
  const dash = (Math.max(0, Math.min(100, d.score)) / 100) * circ;
  out.push(`<circle cx="${cx}" cy="${cy}" r="${rad}" fill="none" stroke="#2a2740" stroke-width="22"/>`);
  out.push(`<circle cx="${cx}" cy="${cy}" r="${rad}" fill="none" stroke="${colour}" stroke-width="22" stroke-dasharray="${dash.toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>`);
  t(cx, cy + 22, 80, colour, d.grade, 'text-anchor="middle" font-weight="bold"');
  t(cx, cy + 62, 24, '#ffffff', `score ${d.score}`, 'text-anchor="middle"');
  // stats
  const stats: [string, string][] = [
    ['Reliability', `${d.reliabilityPct}%`],
    ['Repeats', String(d.repeats)],
    ['Lost orders', String(d.lost)],
    ['Recovery p50', d.recoveryP50 === undefined ? 'n/a' : `${d.recoveryP50} ms`],
    ['Recovery p95', d.recoveryP95 === undefined ? 'n/a' : `${d.recoveryP95} ms`],
  ];
  stats.forEach(([k, v], i) => {
    const x = 400 + (i % 3) * 250;
    const y = 190 + Math.floor(i / 3) * 90;
    t(x, y, 16, '#a9a4bd', k);
    t(x, y + 36, 34, '#ffffff', v, 'font-weight="bold"');
  });
  // heat-map
  const hx = 400, hy = 380, cw = 28, ch = 14;
  const stagesShown = d.stages.slice(0, 8);
  const faultsShown = d.faults.slice(0, 12);
  t(hx, hy - 10, 14, '#a9a4bd', 'Coverage: stage by fault');
  stagesShown.forEach((s, si) => {
    faultsShown.forEach((f, fi) => {
      const res = d.cells[`${s}\u0000${f}`];
      const fill = res ? (RESULT_COLOURS[res] ?? RESULT_COLOURS.na) : '#22202f';
      out.push(`<rect x="${hx + fi * (cw + 3)}" y="${hy + si * (ch + 3)}" width="${cw}" height="${ch}" rx="2" fill="${fill}"/>`);
    });
  });
  // legend
  RESULT_ORDER.forEach((k, i) => {
    out.push(`<rect x="${hx + i * 70}" y="${hy + 8 * 17 + 6}" width="10" height="10" fill="${RESULT_COLOURS[k]}"/>`);
    t(hx + i * 70 + 14, hy + 8 * 17 + 15, 11, '#a9a4bd', k === 'recovered_late' ? 'late' : k);
  });
  // tier bars
  if (d.tiers.length) {
    const bx = 880, by = 380;
    t(bx, by - 10, 14, '#a9a4bd', 'Tiers');
    d.tiers.slice(0, 5).forEach((r, i) => {
      const y = by + i * 24;
      t(bx, y + 12, 12, '#ffffff', trunc(r.tier, 10));
      out.push(`<rect x="${bx + 80}" y="${y}" width="200" height="14" rx="3" fill="#2a2740"/>`);
      out.push(`<rect x="${bx + 80}" y="${y}" width="${Math.round(2 * Math.max(0, Math.min(100, r.score || { A: 95, B: 85, C: 70, D: 55, F: 25 }[r.grade])))}" height="14" rx="3" fill="${GRADE_COLOURS[r.grade]}"/>`);
      t(bx + 290, y + 12, 12, GRADE_COLOURS[r.grade], r.grade, 'font-weight="bold"');
    });
  }
  // findings
  const worst = d.findings.map((f, i) => `${i + 1}. ${trunc(f, 90)}`);
  worst.forEach((line, i) => t(48, 520 + i * 22, 15, '#d8d4ea', line));
  t(48, 612, 14, '#6f6a86', 'tested with Haunt \u00b7 kakoritz/Kiroween-Chaos');
  out.push('</svg>');
  return out.join('\n') + '\n';
}

/** Standalone HTML page showing the scorecard; no scripts, no external requests. */
export function renderScorecardHtml(d: ScorecardData): string {
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>Haunt resilience scorecard: ${esc(d.app)} ${esc(d.grade)} ${d.score}</title>`,
    '<style>html,body{margin:0;background:#0b0a10;display:flex;align-items:center;justify-content:center;min-height:100vh}svg{max-width:100%;height:auto}</style>',
    '</head><body>',
    renderScorecardSvg(d).replace(/\n$/, ''),
    '</body></html>',
    '',
  ].join('\n');
}

export interface BadgeFiles { 'haunt-badge.svg': string; 'haunt-scorecard.svg': string; 'haunt-scorecard.html': string }

export function renderBadgeFiles(report: unknown): BadgeFiles {
  const d = scorecardData(report);
  return {
    'haunt-badge.svg': renderBadgeSvg(d),
    'haunt-scorecard.svg': renderScorecardSvg(d),
    'haunt-scorecard.html': renderScorecardHtml(d),
  };
}
