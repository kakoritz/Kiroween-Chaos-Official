import { compareReports, parseReport, postmortemScore, renderMarkdown, gradeColor, signed, type Comparison, type HarnessReport } from '../src/report/model';
import w1 from '../../../docs/proof/wave1-report.json';
import w2 from '../../../docs/proof/wave2-report.json';
import pm1 from '../../../docs/proof/wave1-postmortem.md?raw';
import pm2 from '../../../docs/proof/wave2-postmortem.md?raw';

interface Wave { n: number; report: HarnessReport; postmortem: string; source: string }

const root = document.getElementById('report')!;
const waves: Wave[] = [];
let tab = 'compare';
let selA = 0;
let selB = 1;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

async function fetchJson(url: string): Promise<unknown> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.text();
}

async function load(): Promise<void> {
  const useLive = new URLSearchParams(location.search).get('live') === '1';
  if (useLive) {
    for (let n = 1; n <= 6; n++) {
      try {
        const report = parseReport(await fetchJson(`/api/waves/${n}/report`));
        const postmortem = await fetchText(`/api/waves/${n}/postmortem`).catch(() => '');
        waves.push({ n, report, postmortem, source: 'live API' });
      } catch { break; }
    }
  }
  if (waves.length === 0) {
    waves.push({ n: 1, report: parseReport(w1), postmortem: pm1, source: 'sample: docs/proof' });
    waves.push({ n: 2, report: parseReport(w2), postmortem: pm2, source: 'sample: docs/proof' });
  }
  selA = 0;
  selB = Math.min(1, waves.length - 1);
  const m = /#\/report\/(\d+)/.exec(location.hash);
  if (m) { tab = 'summary'; selA = Math.max(0, waves.findIndex((w) => w.n === Number(m[1]))); }
}

function scoreOf(w: Wave): number | null { return postmortemScore(w.postmortem); }

function gradeRing(g: string, size = 'lg'): HTMLElement {
  const ring = el('div', `ring ring--${size}`, g);
  ring.style.setProperty('--gc', gradeColor(g));
  ring.setAttribute('role', 'img');
  ring.setAttribute('aria-label', `Grade ${g}`);
  return ring;
}

const ICON: Record<string, string> = { pass: '\u2713', repeat: '\u21BB', fail: '\u2717', recovered_late: '\u29D6', halt: '\u23F9', na: '\u2013' };

function chip(result: string | null): HTMLElement {
  const c = el('span', `cell cell--${result ?? 'na'}`, `${ICON[result ?? 'na'] ?? '?'} ${result ?? 'none'}`);
  return c;
}

function trendBadge(t: string): HTMLElement {
  const arrow = t === 'improved' ? '\u25B2 improved' : t === 'worsened' ? '\u25BC worsened' : '= same';
  return el('span', `trend trend--${t}`, arrow);
}

function metric(label: string, before: string, after: string, trend: string): HTMLElement {
  const row = el('div', 'metric');
  row.append(el('span', 'metric-l', label), el('span', 'metric-b', before), el('span', 'arrow', '\u2192'), el('span', 'metric-a', after), trendBadge(trend));
  return row;
}

function sidePanel(title: string, w: Wave, cmp: Comparison, which: 'before' | 'after'): HTMLElement {
  const p = el('section', `side side--${which}`);
  p.setAttribute('aria-label', title);
  p.append(el('h3', undefined, `${title}: wave ${w.n}`));
  p.append(gradeRing(w.report.grade));
  const sc = scoreOf(w);
  p.append(el('div', 'big', sc === null ? 'score n/a' : `score ${sc}`));
  const rows = el('dl', 'kv');
  const add = (k: string, v: string) => rows.append(el('dt', undefined, k), el('dd', undefined, v));
  add('Reliability', w.report.reliability);
  add('Repeated effects', String(w.report.repeats.length));
  add('Lost orders', String(w.report.lost.length));
  add('Findings', String(w.report.findings.length));
  add('Recovery p50 / p95 / max', `${w.report.recovery.p50} / ${w.report.recovery.p95} / ${w.report.recovery.max}`);
  for (const t of w.report.tiers) add(`Lane ${t.tier}`, t.grade);
  p.append(rows);
  void cmp;
  return p;
}

function compareView(): HTMLElement {
  const wrap = el('div', 'compare');
  if (waves.length < 2) { wrap.append(el('p', 'empty', 'Run a second wave to compare.')); return wrap; }
  const a = waves[selA]!; const b = waves[selB]!;
  const cmp = compareReports(a.report, b.report, scoreOf(a) ?? 0, scoreOf(b) ?? 0);

  const pick = el('div', 'pickers');
  for (const [label, sel, set] of [['Before', selA, (i: number) => { selA = i; }], ['After', selB, (i: number) => { selB = i; }]] as const) {
    const s = el('select'); s.setAttribute('aria-label', `${label} wave`);
    waves.forEach((w, i) => { const o = el('option', undefined, `${label}: wave ${w.n}`); o.value = String(i); o.selected = i === sel; s.append(o); });
    s.onchange = () => { set(Number(s.value)); render(); };
    pick.append(s);
  }
  wrap.append(pick);

  const delta = el('div', 'delta');
  delta.append(
    metric('Wave grade', cmp.gradeBefore, cmp.gradeAfter, cmp.gradeTrend),
    metric('Wave score', String(cmp.scoreBefore), `${cmp.scoreAfter} (${signed(cmp.scoreDelta)})`, cmp.scoreDelta > 0 ? 'improved' : cmp.scoreDelta < 0 ? 'worsened' : 'same'),
    metric('Repeated effects', String(cmp.repeatsBefore), String(cmp.repeatsAfter), cmp.repeatsAfter < cmp.repeatsBefore ? 'improved' : cmp.repeatsAfter > cmp.repeatsBefore ? 'worsened' : 'same'),
    metric('Lost orders', String(cmp.lostBefore), String(cmp.lostAfter), cmp.lostAfter < cmp.lostBefore ? 'improved' : cmp.lostAfter > cmp.lostBefore ? 'worsened' : 'same'),
  );
  for (const t of cmp.tiers) delta.append(metric(`Lane ${t.tier}`, t.before?.grade ?? '-', t.after?.grade ?? '-', t.trend));
  wrap.append(delta);

  const sides = el('div', 'sides');
  sides.append(sidePanel('Before', a, cmp, 'before'), sidePanel('After', b, cmp, 'after'));
  wrap.append(sides);

  const grid = el('section', 'diffgrid');
  grid.append(el('h3', undefined, 'Matrix changes'));
  const table = el('table');
  const head = el('tr'); for (const h of ['Stage', 'Fault', 'Before', 'After', '']) head.append(el('th', undefined, h));
  table.append(head);
  cmp.cells.forEach((c, i) => {
    const tr = el('tr', `row row--${c.trend}`);
    tr.append(el('td', undefined, c.stage || 'whole run'), el('td', undefined, `${c.fault} #${i + 1}`));
    const tb = el('td'); tb.append(chip(c.before)); const ta = el('td'); ta.append(chip(c.after)); const tt = el('td'); tt.append(trendBadge(c.trend));
    tr.append(tb, ta, tt);
    table.append(tr);
  });
  grid.append(table);
  wrap.append(grid);

  const fd = el('section', 'findings');
  fd.append(el('h3', undefined, 'Findings'));
  const group = (title: string, cls: string, list: { id: string; severity: string; summary: string }[]) => {
    const g = el('div', `fgroup fgroup--${cls}`);
    g.append(el('h4', undefined, `${title} (${list.length})`));
    if (!list.length) g.append(el('p', 'none', 'none'));
    for (const f of list) g.append(el('div', 'finding', `${f.id} [${f.severity}] ${f.summary}`));
    return g;
  };
  fd.append(group('Resolved', 'ok', cmp.findings.resolved), group('Remaining', 'warn', cmp.findings.remaining), group('New', 'fail', cmp.findings.added));
  wrap.append(fd);
  return wrap;
}

function summaryView(): HTMLElement {
  const w = waves[selA]!;
  const wrap = el('div', 'summary');
  wrap.append(gradeRing(w.report.grade));
  const sc = scoreOf(w);
  const kv = el('dl', 'kv');
  for (const [k, v] of [['Wave', String(w.n)], ['App', w.report.app], ['Seed', String(w.report.seed)], ['Score', sc === null ? 'n/a' : String(sc)], ['Reliability', w.report.reliability], ['Repeats', String(w.report.repeats.length)], ['Lost orders', String(w.report.lost.length)], ['Source', w.source]]) {
    kv.append(el('dt', undefined, k), el('dd', undefined, v!));
  }
  wrap.append(kv);
  const table = el('table'); const head = el('tr');
  for (const h of ['Stage', 'Fault', 'Result', 'Evidence seq']) head.append(el('th', undefined, h));
  table.append(head);
  w.report.matrix.forEach((c, i) => {
    const tr = el('tr'); const td = el('td'); td.append(chip(c.result));
    tr.append(el('td', undefined, c.stage || 'whole run'), el('td', undefined, `${c.fault} #${i + 1}`), td, el('td', undefined, c.evidenceSeq.join(', ')));
    table.append(tr);
  });
  wrap.append(table);
  const pm = el('article', 'pm'); pm.innerHTML = renderMarkdown(w.postmortem);
  wrap.append(pm);
  return wrap;
}

function render(): void {
  root.replaceChildren();
  const bar = el('header', 'bar');
  bar.append(el('strong', undefined, 'HAUNT'), el('span', 'muted', 'Report viewer'));
  const tabs = el('nav', 'tabs'); tabs.setAttribute('role', 'tablist');
  for (const [id, label] of [['compare', 'Compare'], ['summary', 'Summary']]) {
    const b = el('button', 'tab', label); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(tab === id));
    b.onclick = () => { tab = id; render(); };
    tabs.append(b);
  }
  bar.append(tabs);
  const file = el('input'); file.type = 'file'; file.accept = '.json,application/json'; file.setAttribute('aria-label', 'Load a report JSON');
  file.onchange = async () => {
    const f = file.files?.[0]; if (!f) return;
    try { waves.push({ n: waves.length + 1, report: parseReport(JSON.parse(await f.text())), postmortem: '', source: f.name }); render(); } catch (e) { alert(String(e)); }
  };
  bar.append(el('span', 'spacer'), file);
  root.append(bar);
  const main = el('main'); main.append(tab === 'summary' ? summaryView() : compareView());
  root.append(main);
  root.dataset.ready = '1';
}

load().then(render, (e) => { root.textContent = String(e); });
