// Rank board and ledger panel (UI-A4). The pure helpers (sorting, columns, cell text) carry the
// logic and are unit tested; the DOM painters only mirror the view model (ui-spec sections 10, 11).
import type { ArenaVM, LaneVM, SkelMode } from './model';
import { rankGlyph } from '../onboarding/polish';

export const ROW_H = 29;
/** Height of the rank board's column header row. */
export const HEAD_H = 20;
/** Short column titles so the nine ledger columns fit the panel; the full name stays in the tooltip. */
const SHORT_LABEL: Record<string, string> = { Accounts: 'Accts', Orders: 'Placed', Shipments: 'Ships', Notices: 'Notes', Receipts: 'Receipts' };
export const ledgerHeader = (full: string): string => SHORT_LABEL[full] ?? full;
const KIND_ORDER = ['account_create', 'order', 'charge', 'email', 'store', 'dispatch', 'notify', 'ticket'];
export const KIND_LABEL: Record<string, string> = {
  account_create: 'Accounts', order: 'Orders', charge: 'Charges', email: 'Emails', store: 'Store', dispatch: 'Shipments', notify: 'Notices', ticket: 'Tickets',
};
export const DEFAULT_KINDS = ['account_create', 'order', 'charge', 'email', 'store', 'dispatch', 'notify'];

/** Score descending, then fewer repeats, then lane number (ui-spec section 10). */
export function rankLanes(lanes: readonly LaneVM[]): LaneVM[] {
  return [...lanes].sort((a, b) => b.score - a.score || a.counts.repeats - b.counts.repeats || a.lane - b.lane);
}

/** Effect kinds to show: every kind seen, in the canonical order, or the orders-app default. */
/** The provider sometimes reports `account` or `reply`; they belong in the Accounts and Emails columns. */
export const canonKind = (k: string): string => (k === 'account' ? 'account_create' : k === 'reply' ? 'email' : k);

export function ledgerKinds(vm: ArenaVM): string[] {
  const seen = new Set<string>();
  for (const l of vm.lanes) for (const k of Object.keys(l.ledger)) seen.add(canonKind(k));
  if (!seen.size) return DEFAULT_KINDS;
  const known = KIND_ORDER.filter((k) => seen.has(k));
  const extra = [...seen].filter((k) => !KIND_ORDER.includes(k)).sort();
  return [...known, ...extra];
}

export interface CellView { rows: number; repeats: number; text: string; dup: boolean }
export function cellView(l: LaneVM, kind: string): CellView {
  const c = { rows: 0, repeats: 0 };
  for (const [k, v] of Object.entries(l.ledger)) if (canonKind(k) === kind) { c.rows += v.rows; c.repeats += v.repeats; }
  return { rows: c.rows, repeats: c.repeats, dup: c.repeats > 0, text: c.repeats > 0 ? `${c.rows} +${c.repeats}` : String(c.rows) };
}

/** Column title. In the orders app (a `charge` column is present) the confirmation email is the customer's receipt. */
export const kindLabel = (k: string, orders = false): string => (k === 'email' && orders ? 'Receipts' : KIND_LABEL[k] ?? k.replace(/_/g, ' '));

/** Icon plus color for the state: dead dims, halted is struck through, done is checked. */
export function stateIcon(m: SkelMode): { icon: string; label: string } {
  switch (m) {
    case 'dead': return { icon: '\u2620', label: 'dead' };
    case 'halted': return { icon: '\u26D4', label: 'halted' };
    case 'done': return { icon: '\u2714', label: 'done' };
    case 'working': return { icon: '\u2699', label: 'working' };
    case 'recovering': case 'reassembling': return { icon: '\u21BB', label: 'recovering' };
    case 'fail': return { icon: '\u26A0', label: 'failing' };
    default: return { icon: '\u00B7', label: 'idle' };
  }
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const tierName = (t: string): string => (t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Lane');

/** Competition ranking by score: ties share a rank (1,1,3). PT-U8. */
export function rankNumbers(ranked: readonly LaneVM[]): number[] {
  const out: number[] = [];
  ranked.forEach((l, i) => out.push(i > 0 && ranked[i - 1]!.score === l.score ? out[i - 1]! : i + 1));
  return out;
}

/** Average stars (cum stars over cum max, scaled to 5), or a dash with no reviews yet. */
export function avgStarsText(l: LaneVM): string {
  return l.stars && l.stars.max > 0 ? ((l.stars.sum / l.stars.max) * 5).toFixed(1) : '-';
}

export class RankBoard {
  private rows = new Map<number, HTMLElement>();
  private sig = '';
  constructor(private host: HTMLElement) {
    const head = document.createElement('div');
    head.className = 'rb-head';
    head.innerHTML = '<span></span><span>Lane</span><span title="score">Score</span><span title="average stars (out of 5)">Stars</span><span title="orders completed / failed">Done/Lost</span><span title="duplicate side effects">Dupes</span><span></span>';
    host.appendChild(head);
  }
  update(vm: ArenaVM): void {
    const ranked = rankLanes(vm.lanes);
    const sig = ranked.map((l) => `${l.lane}:${l.score}:${avgStarsText(l)}:${l.counts.completed}:${l.counts.failed}:${l.counts.repeats}:${l.mode}`).join('|');
    if (sig === this.sig) return;
    this.sig = sig;
    const live = new Set(ranked.map((l) => l.lane));
    for (const [n, el] of this.rows) if (!live.has(n)) { el.remove(); this.rows.delete(n); }
    const nums = rankNumbers(ranked);
    ranked.forEach((l, i) => {
      let el = this.rows.get(l.lane);
      if (!el) { el = document.createElement('div'); el.className = 'rb-row'; this.host.appendChild(el); this.rows.set(l.lane, el); }
      const st = stateIcon(l.mode);
      el.style.transform = `translateY(${HEAD_H + i * ROW_H}px)`;
      el.className = `rb-row rb-${l.mode}`;
      el.innerHTML = `<span class="rb-rank">${nums[i] === 1 ? rankGlyph(0, l.score) : String(nums[i])}</span>`
        + `<span class="rb-name">${esc(tierName(l.tier))} <i>#${l.lane}</i></span>`
        + `<span class="rb-score">${l.score}</span>`
        + `<span class="rb-avg" title="average stars">${avgStarsText(l)}</span>`
        + `<span class="rb-cf" title="completed / failed">${l.counts.completed}/${l.counts.failed}</span>`
        + `<span class="rb-rep${l.counts.repeats ? ' bad' : ''}" title="repeats">${l.counts.repeats ? '\u00D7' + l.counts.repeats : '-'}</span>`
        + `<span class="rb-state" title="${st.label}">${st.icon}</span>`;
    });
  }
}

export class LedgerPanel {
  private sig = '';
  private body: HTMLElement;
  constructor(host: HTMLElement) {
    host.innerHTML = '<table class="lg"><thead></thead><tbody></tbody></table>';
    this.body = host;
  }
  update(vm: ArenaVM, now: number): void {
    const kinds = ledgerKinds(vm);
    const flash = vm.lanes.map((l) => kinds.map((k) => (l.flash[k] !== undefined && now - l.flash[k]! < 1200 ? 1 : 0)).join('')).join(',');
    const sig = kinds.join() + '#' + vm.lanes.map((l) => `${l.lane}:${l.counts.completed}:${kinds.map((k) => cellView(l, k).text).join(',')}`).join('|') + '#' + flash;
    if (sig === this.sig) return;
    this.sig = sig;
    const head = `<tr><th>Lane</th>${kinds.map((k) => { const full = kindLabel(k, kinds.includes('charge')); return `<th title="${esc(full)} written to the outside world">${esc(ledgerHeader(full))}</th>`; }).join('')}</tr>`;
    const rows = vm.lanes.map((l) => {
      const cells = kinds.map((k) => {
        const c = cellView(l, k);
        const fl = l.flash[k] !== undefined && now - l.flash[k]! < 1200;
        const txt = c.dup ? `<b>${c.rows}</b> <em>+${c.repeats}</em>` : String(c.rows);
        return `<td class="${c.dup ? 'dup' : ''}${fl ? ' flash' : ''}">${c.dup ? '\u26A0 ' : ''}${txt}</td>`;
      }).join('');
      return `<tr><th>${esc(tierName(l.tier))} <i>#${l.lane}</i></th>${cells}<td class="lg-exp-c" title="orders completed so far">${l.counts.completed}</td></tr>`;
    }).join('');
    this.body.querySelector('thead')!.innerHTML = head.replace('</tr>', '<th title="orders completed so far">Done</th></tr>');
    this.body.querySelector('tbody')!.innerHTML = rows;
  }
}
