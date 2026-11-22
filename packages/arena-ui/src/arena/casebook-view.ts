// TV3-U9: the Casebook table, the awards row and the lessons list (DOM). Models are in casebook.ts and tournament.ts.
// The final screen order is podium, awards, Casebook; the round card shows the Casebook so far.
import { caseRows, caseTitle, lessonsTip, mechanismWord, solvedCounts, type CasebookVM, type CaseRow, type Lesson } from './casebook';
import { AWARD_LABEL, type Award, type TournamentVM } from './tournament';
import { el } from './tournament-view';

export interface CasebookHost {
  laneTitle(lane: number): string;
  stageLabel(id: string): string;
}

const sec = (n: number, d: number): string => `${(n / 1000).toFixed(d)} s`;

function lanesText(lanes: readonly number[], host: CasebookHost, max = 3): string {
  const names = lanes.map((n) => host.laneTitle(n) || `Lane ${n}`);
  return names.length <= max ? names.join(', ') : `${names.slice(0, max).join(', ')} +${names.length - max}`;
}

/** The Casebook table. Open cases come first and are highlighted. At most `max` rows; the rest are counted. */
export function casebookTable(cb: Pick<CasebookVM, 'entries' | 'recommended'>, host: CasebookHost, o: { max?: number; title?: string } = {}): HTMLElement {
  const rows = caseRows(cb);
  const wrap = el('section', 'cbk');
  const open = rows.filter((r) => r.open).length;
  const head = el('div', 'cbk-head');
  head.append(el('h3', '', o.title ?? 'Casebook'));
  head.append(el('span', 'cbk-sub', rows.length === 0 ? 'No edge cases yet' : `${rows.length} ${rows.length === 1 ? 'case' : 'cases'}, ${rows.length - open} solved, ${open} open`));
  wrap.append(head);
  if (rows.length === 0) { wrap.append(el('p', 'cbk-none', 'Every edge case a lane meets is written down here: who solved it, how, and what it cost.')); return wrap; }
  const table = el('div', 'cbk-table'); table.setAttribute('role', 'table'); table.setAttribute('aria-label', 'Casebook');
  const hr = el('div', 'cbk-row cbk-row--h'); hr.setAttribute('role', 'row');
  for (const c of ['Case', 'Met by', 'Solved by, and how', 'Cost', 'Recommended fix']) { const x = el('span', '', c); x.setAttribute('role', 'columnheader'); hr.append(x); }
  table.append(hr);
  const shown = rows.slice(0, o.max ?? rows.length);
  for (const r of shown) table.append(caseRow(r, host));
  wrap.append(table);
  if (rows.length > shown.length) wrap.append(el('p', 'cbk-more', `+ ${rows.length - shown.length} more cases in the final Casebook`));
  return wrap;
}

/** "restart: Journaler, Reconciler +1": solvers grouped by the mechanism that worked. */
function solvedText(r: CaseRow, host: CasebookHost): string {
  const by = new Map<string, number[]>();
  for (const s of r.solvedBy) { const k = s.mechanism || 'solved'; by.set(k, [...(by.get(k) ?? []), s.lane]); }
  return [...by].map(([m, lanes]) => `${mechanismWord(m)}: ${lanesText(lanes, host, 2)}`).join('; ');
}

function caseRow(r: CaseRow, host: CasebookHost): HTMLElement {
  const row = el('div', `cbk-row${r.open ? ' cbk-row--open' : ''}`); row.setAttribute('role', 'row');
  const c = el('span', 'cbk-case'); c.setAttribute('role', 'cell');
  c.append(el('b', '', caseTitle(r.signature, host.stageLabel)));
  if (r.unknown) { const u = el('i', 'cbk-unk', '? UNKNOWN'); u.title = 'A fuzz fault nobody had seen: a new signature.'; c.append(u); }
  const met = el('span', 'cbk-met', lanesText(r.lanes, host)); met.setAttribute('role', 'cell'); met.title = r.lanes.map((n) => host.laneTitle(n) || `Lane ${n}`).join(', ');
  const solved = el('span', 'cbk-solved'); solved.setAttribute('role', 'cell');
  if (r.open) solved.append(el('b', 'cbk-openTag', '⚠ OPEN'), document.createTextNode(' nobody solved it'));
  else solved.append(document.createTextNode(solvedText(r, host)));
  const costBits = [r.costMs > 0 ? sec(r.costMs, 1) : '', r.costPoints !== 0 ? `${r.costPoints > 0 ? '-' : ''}${Math.abs(r.costPoints)} pts` : ''].filter(Boolean);
  const cost = el('span', 'cbk-cost', costBits.length ? costBits.join(', ') : '-'); cost.setAttribute('role', 'cell');
  const fix = el('span', 'cbk-fix', r.recommended); fix.setAttribute('role', 'cell'); fix.title = r.recommended;
  row.append(c, met, solved, cost, fix);
  return row;
}

const SVG = (body: string): string => `<svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true" stroke="#14101f" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;
/** Small code-drawn award icons. */
const ICON: Record<string, string> = {
  champion: SVG('<path d="M5 24l-1-14 7 6 5-9 5 9 7-6-1 14z" fill="#ffd24a"/><path d="M5 27h22" />'),
  battle_tested: SVG('<path d="M16 3l11 4v8c0 7-5 11-11 14C10 26 5 22 5 15V7z" fill="#7ab8ff"/><path d="M11 15l4 4 7-8" fill="none" stroke="#fff"/>'),
  iron_skeleton: SVG('<path d="M9 8a4 4 0 117 2l5 12a4 4 0 11-2 5l-6-13A4 4 0 019 8z" fill="#efe6d2"/><path d="M24 6l-4 4" />'),
  fastest_recovery: SVG('<path d="M18 2L7 18h8l-2 12 12-17h-8z" fill="#ffc247"/>'),
  wooden_spoon: SVG('<ellipse cx="16" cy="10" rx="6" ry="8" fill="#b98a50"/><path d="M16 17v13" stroke-width="4" /><path d="M16 17v13" stroke="#b98a50" stroke-width="1.6" />'),
};
const ICON_FOR = (id: string): string => ICON[id.replace(/([A-Z])/g, '_$1').toLowerCase()] ?? ICON.battle_tested!;

const WHY: Record<string, string> = {
  champion: 'Last lane standing', battle_tested: 'Solved the most distinct cases', iron_skeleton: 'Fewest repeated side effects',
  fastest_recovery: 'Best typical recovery time', wooden_spoon: 'Went out first',
};

const idOf = (a: Award): string => a.id.replace(/([A-Z])/g, '_$1').toLowerCase();

/** When the server sends no awards, work out the ones the client can: Champion, Battle-Tested (from the Casebook) and Wooden Spoon (first to fall). */
export function fallbackAwards(t: Pick<TournamentVM, 'champion' | 'fallen'>, cb: Pick<CasebookVM, 'entries'>): Award[] {
  const out: Award[] = [];
  if (t.champion !== null) out.push({ id: 'champion', label: 'Champion', lane: t.champion, detail: WHY.champion! });
  const counts = [...solvedCounts(cb)].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  if (counts[0] && counts[0][1] > 0) out.push({ id: 'battle_tested', label: 'Battle-Tested', lane: counts[0][0], detail: `${counts[0][1]} distinct ${counts[0][1] === 1 ? 'case' : 'cases'} solved` });
  const first = Object.entries(t.fallen).map(([lane, f]) => ({ lane: Number(lane), round: f.round })).sort((a, b) => a.round - b.round || a.lane - b.lane)[0];
  if (first) out.push({ id: 'wooden_spoon', label: 'Wooden Spoon', lane: first.lane, detail: `Went out in round ${first.round}. Every bot starts somewhere.` });
  return out;
}

/** The awards row: Champion, Battle-Tested, Iron Skeleton, Fastest Recovery, Wooden Spoon, in that order. */
export function awardsRow(awards: readonly Award[], host: CasebookHost): HTMLElement {
  const order = ['champion', 'battle_tested', 'iron_skeleton', 'fastest_recovery', 'wooden_spoon'];
  const rank = (a: Award): number => { const i = order.indexOf(idOf(a)); return i < 0 ? 99 : i; };
  const sorted = [...awards].sort((a, b) => rank(a) - rank(b));
  const wrap = el('section', 'awd');
  wrap.setAttribute('aria-label', 'Awards');
  for (const a of sorted) {
    const id = idOf(a);
    const card = el('div', `awd-card awd-${id}`);
    const ic = el('span', 'awd-ic'); ic.innerHTML = ICON_FOR(id);
    const label = a.label || AWARD_LABEL[id] || id;
    const txt = el('span', 'awd-t');
    txt.append(el('b', '', label), el('span', 'awd-who', a.lane !== null ? host.laneTitle(a.lane) || `Lane ${a.lane}` : '-'), el('span', 'awd-why', a.detail || WHY[id] || ''));
    card.append(ic, txt);
    wrap.append(card);
  }
  return wrap;
}

/** Scroll list for the lane popup: one line per lesson, newest first. */
export function lessonsList(list: readonly Lesson[], stageLabel: (id: string) => string): HTMLElement {
  const ul = el('ul', 'lp-lessons');
  if (list.length === 0) { ul.append(el('li', 'lp-none', 'No lessons yet. A lane learns one each time it overcomes an edge case.')); return ul; }
  for (const l of [...list].reverse()) {
    const li = el('li');
    li.append(el('b', '', caseTitle(l.signature, stageLabel)), document.createTextNode(` → ${mechanismWord(l.mechanism) || 'learned'}`));
    li.append(el('i', '', ` round ${l.round}${l.via === 'suggested' ? ', learned from the loss' : ''}`));
    ul.append(li);
  }
  return ul;
}

export { lessonsTip };
