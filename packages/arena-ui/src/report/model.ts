// UI-W4 / UI-C3: pure model for the report viewer. No DOM here so it is unit tested.
export type CellResult = 'pass' | 'repeat' | 'fail' | 'recovered_late' | 'halt' | 'na';

export interface MatrixCell { stage: string; fault: string; result: string; repeats: unknown[]; evidenceSeq: number[] }
export interface Finding { id: string; rule: string; severity: string; stage: string; fault: string; summary: string; evidenceSeq: number[]; suggestedPart?: string }
export interface Tier { tier: string; grade: string; score: number }
export interface HarnessReport {
  run: number; mode: string; seed: number; app: string; generatedAt: number;
  grade: string; reliability: string;
  matrix: MatrixCell[];
  recovery: { p50: number; p95: number; max: number };
  repeats: { order: string; kind: string; extra: number; stage: string; fault: string }[];
  lost: { order: string; reason: string }[];
  targets: unknown[];
  findings: Finding[];
  tiers: Tier[];
}

export const GRADE_ORDER = ['F', 'D', 'C', 'B', 'A', 'S'];
export const gradeRank = (g: string): number => GRADE_ORDER.indexOf(g.toUpperCase());

export function parseReport(raw: unknown): HarnessReport {
  if (!raw || typeof raw !== 'object') throw new Error('Report is not an object');
  const r = raw as Record<string, unknown>;
  if (typeof r.grade !== 'string' || !Array.isArray(r.matrix)) throw new Error('Not a harness report: needs grade and matrix');
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const rec = (r.recovery ?? {}) as Record<string, number>;
  return {
    run: Number(r.run ?? 0), mode: String(r.mode ?? ''), seed: Number(r.seed ?? 0), app: String(r.app ?? ''),
    generatedAt: Number(r.generatedAt ?? 0), grade: r.grade, reliability: String(r.reliability ?? r.grade),
    matrix: arr<MatrixCell>(r.matrix), recovery: { p50: rec.p50 ?? 0, p95: rec.p95 ?? 0, max: rec.max ?? 0 },
    repeats: arr(r.repeats), lost: arr(r.lost), targets: arr(r.targets), findings: arr<Finding>(r.findings), tiers: arr<Tier>(r.tiers),
  };
}

export function gradeColor(g: string): string {
  const k = g.toUpperCase();
  if (k === 'S' || k === 'A') return '#5ee08a';
  if (k === 'B') return '#a8e05e';
  if (k === 'C') return '#ffc247';
  if (k === 'D') return '#ff9a3c';
  return '#ff4d5e';
}

export function cellKey(c: MatrixCell, index: number, all: MatrixCell[]): string {
  const same = all.slice(0, index).filter((o) => o.stage === c.stage && o.fault === c.fault).length;
  return `${c.stage || '(run)'}|${c.fault}|${same}`;
}

export type Trend = 'improved' | 'worsened' | 'same';
const CELL_RANK: Record<string, number> = { pass: 4, recovered_late: 3, repeat: 2, halt: 1, fail: 0, na: -1 };
export const cellRank = (r: string): number => CELL_RANK[r] ?? 0;

export interface CellDiff { key: string; stage: string; fault: string; before: string | null; after: string | null; trend: Trend }
export interface FindingDiff { resolved: Finding[]; remaining: Finding[]; added: Finding[] }
export interface Comparison {
  gradeBefore: string; gradeAfter: string; gradeTrend: Trend;
  scoreBefore: number; scoreAfter: number; scoreDelta: number;
  repeatsBefore: number; repeatsAfter: number; lostBefore: number; lostAfter: number;
  cells: CellDiff[]; findings: FindingDiff; tiers: { tier: string; before: Tier | null; after: Tier | null; trend: Trend }[];
}

const trendOf = (before: number, after: number): Trend => (after > before ? 'improved' : after < before ? 'worsened' : 'same');
const sig = (f: Finding): string => `${f.rule}|${f.stage}|${f.fault}|${f.summary}`;

export function wavePoints(r: HarnessReport): number {
  return r.tiers.reduce((n, t) => n + (Number.isFinite(t.score) ? t.score : 0), 0);
}

export function compareReports(a: HarnessReport, b: HarnessReport, scoreA = wavePoints(a), scoreB = wavePoints(b)): Comparison {
  const ka = new Map(a.matrix.map((c, i) => [cellKey(c, i, a.matrix), c]));
  const kb = new Map(b.matrix.map((c, i) => [cellKey(c, i, b.matrix), c]));
  const keys = [...new Set([...ka.keys(), ...kb.keys()])];
  const cells: CellDiff[] = keys.map((key) => {
    const x = ka.get(key); const y = kb.get(key);
    const rx = x ? cellRank(x.result) : cellRank('fail'); const ry = y ? cellRank(y.result) : cellRank('fail');
    return { key, stage: (x ?? y)!.stage, fault: (x ?? y)!.fault, before: x?.result ?? null, after: y?.result ?? null, trend: trendOf(rx, ry) };
  });
  const sa = new Set(a.findings.map(sig)); const sb = new Set(b.findings.map(sig));
  const tierIds = [...new Set([...a.tiers.map((t) => t.tier), ...b.tiers.map((t) => t.tier)])];
  return {
    gradeBefore: a.grade, gradeAfter: b.grade, gradeTrend: trendOf(gradeRank(a.grade), gradeRank(b.grade)),
    scoreBefore: scoreA, scoreAfter: scoreB, scoreDelta: scoreB - scoreA,
    repeatsBefore: a.repeats.length, repeatsAfter: b.repeats.length, lostBefore: a.lost.length, lostAfter: b.lost.length,
    cells,
    findings: { resolved: a.findings.filter((f) => !sb.has(sig(f))), remaining: b.findings.filter((f) => sa.has(sig(f))), added: b.findings.filter((f) => !sa.has(sig(f))) },
    tiers: tierIds.map((id) => {
      const before = a.tiers.find((t) => t.tier === id) ?? null; const after = b.tiers.find((t) => t.tier === id) ?? null;
      return { tier: id, before, after, trend: trendOf(before ? gradeRank(before.grade) : -1, after ? gradeRank(after.grade) : -1) };
    }),
  };
}

export const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));

/** The report JSON carries no wave score; the postmortem header does ("Grade F, score -360."). */
export function postmortemScore(md: string): number | null {
  const m = /score\s+(-?\d+)/i.exec(md);
  return m ? Number(m[1]) : null;
}

/** Tiny markdown renderer for postmortems: headings, lists, bold, code. Escapes everything first. */
export function renderMarkdown(md: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s: string) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  const out: string[] = []; let list = false;
  for (const line of md.split(/\r?\n/)) {
    const h = /^(#{1,3})\s+(.*)$/.exec(line); const li = /^[-*]\s+(.*)$/.exec(line);
    if (list && !li) { out.push('</ul>'); list = false; }
    if (h) out.push(`<h${h[1]!.length + 1}>${inline(h[2]!)}</h${h[1]!.length + 1}>`);
    else if (li) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inline(li[1]!)}</li>`); }
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push('</ul>');
  return out.join('');
}
