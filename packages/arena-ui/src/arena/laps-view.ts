// PT-U6: DOM renderers shared by the lane popup, the wave end card and the report tab "Laps & stars".
import './laps.css';
import { OUTCOME_MARK, lapTable, secText, starBars, starNum, type LapRow, type LapTable, type StarPoint } from './laps-model';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Lap table: one row per order, best (green star) and slowest (red turtle) tags, footer with totals and averages. */
export function renderLapTable(rows: readonly LapRow[], label = 'Laps'): HTMLElement {
  const t: LapTable = lapTable(rows);
  const wrap = el('div', 'lt-wrap');
  if (t.rows.length === 0) { wrap.append(el('p', 'lt-empty', 'No finished laps yet.')); return wrap; }
  const table = el('table', 'lt');
  table.setAttribute('aria-label', label);
  const head = el('tr');
  for (const h of ['Order', '', 'Lap', 'Tries', 'Retries', 'Down', 'Issues', 'Stars']) { const th = el('th', '', h); th.scope = 'col'; head.append(th); }
  const thead = el('thead'); thead.append(head);
  const body = el('tbody');
  for (const r of t.rows) {
    const tr = el('tr', `lt-row lt-row--${r.outcome}${r.tag ? ` lt-row--${r.tag}` : ''}`);
    const mark = el('td', 'lt-mark', OUTCOME_MARK[r.outcome]); mark.title = r.outcome;
    mark.setAttribute('aria-label', r.outcome);
    const lap = el('td', 'lt-num', secText(r.ms));
    if (r.tag === 'best') lap.append(el('span', 'lt-tag lt-tag--best', '\u2605 best'));
    if (r.tag === 'slowest') lap.append(el('span', 'lt-tag lt-tag--slow', '\uD83D\uDC22 slowest'));
    tr.append(
      el('td', 'lt-order', r.order), mark, lap, el('td', 'lt-num', String(r.attempts)), el('td', 'lt-num', String(r.retries)),
      el('td', `lt-num${r.downtimeMs > 0 ? ' lt-bad' : ''}`, r.downtimeMs > 0 ? secText(r.downtimeMs) : '\u2013'),
      el('td', `lt-num${r.issues > 0 ? ' lt-warn' : ''}`, String(r.issues)),
      el('td', 'lt-num', r.stars === null ? '\u2013' : `\u2605 ${starNum(r.stars)}`),
    );
    body.append(tr);
  }
  const f = t.footer;
  const foot = el('tfoot'); const fr = el('tr');
  fr.append(
    el('th', 'lt-order', `${f.count} orders`), el('td', ''), el('td', 'lt-num', `${secText(f.totalMs)} total${f.avgMs !== null ? `, avg ${secText(f.avgMs)}` : ''}`),
    el('td', 'lt-num', String(f.attempts)), el('td', 'lt-num', String(f.retries)), el('td', 'lt-num', f.downtimeMs > 0 ? secText(f.downtimeMs) : '\u2013'),
    el('td', 'lt-num', String(f.issues)), el('td', 'lt-num', f.avgStars === null ? '\u2013' : `avg ${starNum(f.avgStars)}`),
  );
  foot.append(fr);
  table.append(thead, body, foot);
  wrap.append(table);
  return wrap;
}

/** Star progression: one bar per order, height cumStars / cumMax, label at each order (5/5, 6/10, 8/15, ...). */
export function renderStarChart(series: readonly StarPoint[], label = 'Star progression'): HTMLElement {
  const box = el('div', 'sc');
  box.setAttribute('role', 'img');
  const bars = starBars(series);
  box.setAttribute('aria-label', bars.length ? `${label}: ${bars.map((b) => `${b.order} ${b.label}`).join(', ')}` : `${label}: no reviews yet`);
  if (bars.length === 0) { box.append(el('span', 'sc-none', 'No reviews yet')); return box; }
  for (const b of bars) {
    const col = el('div', 'sc-col');
    const bar = el('div', `sc-bar sc-bar--${b.tone}`);
    bar.style.height = `${Math.max(4, Math.round(b.ratio * 100))}%`;
    bar.title = `${b.order}: ${b.label}`;
    col.append(bar, el('span', 'sc-lbl', b.label));
    box.append(col);
  }
  return box;
}

/** Issues-by-step heat row: one chip per stage coloured by its share of the worst stage. */
export function renderHeatRow(issues: readonly { stage: string; count: number; heat: 0 | 1 | 2 | 3 }[], labelOf: (id: string) => string = (s) => s): HTMLElement {
  const row = el('div', 'hr');
  row.setAttribute('role', 'list');
  row.setAttribute('aria-label', 'Issues by step');
  for (const i of issues) {
    const c = el('span', `hr-chip hr-chip--${i.heat}`, `${labelOf(i.stage).slice(0, 10)} ${i.count}`);
    c.setAttribute('role', 'listitem');
    c.title = `${labelOf(i.stage)}: ${i.count} issue${i.count === 1 ? '' : 's'}`;
    row.append(c);
  }
  return row;
}
