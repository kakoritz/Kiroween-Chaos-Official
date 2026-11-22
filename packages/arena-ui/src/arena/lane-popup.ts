// Lane popup v2 (playtest-v2 ui.md section 5): a focus-trapped modal with a live mini scene (a crop of the
// arena canvas, so it is the same renderer fed the same events), the stage table, order picker, log with
// filters, lap summary, review card, replay and a chaos picker. Replaces the UI-C1 stage inspector panel.
import type { ArenaEvent, Creature } from '../api/types';
import { CHIP_WORD } from './chips';
import {
  FILTERS, OUTCOME_ICON, OUTCOME_WORD, bestSlowest, downtimePoints, filterLog, lapOf, logEntries, offsetText, orderRows, reviewOf,
  secs, segment, sortUnique, stageRows, starGlyphs, starText, starTone, type LogFilter, type OrderRow,
} from './lane-popup-model';
import { replayCount } from './inspector';
import { lapRowsFromEvents, lapRowsOf, mergeLapRows } from './laps-model';
import { renderLapTable } from './laps-view';

const MAX_BUF = 1500;
const ALL_ORDERS = '*';
const SCENE_W = 1100;
const SCENE_H = 170;
const SPEEDS = [1, 2, 4] as const;
const REPLAY_BASE_MS = 3000;

export interface LanePopupHost {
  stageIds(): string[];
  stageLabel(id: string): string;
  /** Lane tier name and the order it is running now. */
  laneInfo(lane: number): { tier: string; order: string | null; running: boolean } | null;
  /** Where the lane sits on the arena canvas (design pixels), or null when it is not drawn. */
  laneBox(lane: number): { top: number; h: number } | null;
  chaos(lane: number, creature?: string): Promise<unknown>;
  creatures(): Promise<Creature[]>;
  fetchOrder(lane: number, order: string): Promise<unknown>;
  fetchLaps(lane: number): Promise<unknown>;
  onError(e: unknown): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

export class LanePopup {
  private buf: ArenaEvent[] = [];
  private lane = 0;
  private stageFocus: string | null = null;
  private picked: string | null = null;
  private pinSeq = 0;
  private filter: LogFilter = 'all';
  private follow = true;
  private scrub = 1;
  private replayAt: number | null = null;
  private replaySpeed = 1;
  private serverOrder: unknown = null;
  private serverFor = '';
  private serverLaps: unknown = null;
  private sig = '';
  private pickerSig = '';
  private openState = false;
  private returnFocus: HTMLElement | null = null;
  private creatureList: Creature[] | null = null;
  private frozen: HTMLCanvasElement | null = null;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly dlg: HTMLElement;
  private readonly title: HTMLElement;
  private readonly pace: HTMLElement;
  private readonly picker: HTMLElement;
  private readonly sceneCv: HTMLCanvasElement;
  private readonly tableBody: HTMLElement;
  private readonly logBox: HTMLElement;
  private readonly logHead: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly review: HTMLElement;
  private readonly lapsBox: HTMLDetailsElement;
  private readonly lapsBody: HTMLElement;
  private readonly followBox: HTMLInputElement;
  private readonly scrubber: HTMLInputElement;
  private readonly replayBtn: HTMLButtonElement;
  private readonly speedSel: HTMLSelectElement;
  private readonly chaosBtn: HTMLButtonElement;
  private readonly chaosSel: HTMLSelectElement;
  private readonly closeBtn: HTMLButtonElement;

  constructor(private readonly root: HTMLElement, private readonly host: LanePopupHost, private readonly source: HTMLCanvasElement) {
    root.classList.add('lp-dim', 'hidden');
    const dlg = el('div', 'lp');
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-label', 'Lane details');
    this.dlg = dlg;
    const head = el('div', 'lp-head');
    this.title = el('h2', 'lp-title', 'Lane');
    this.title.id = 'lp-title';
    dlg.setAttribute('aria-labelledby', 'lp-title');
    this.picker = el('div', 'lp-picker');
    this.pace = el('div', 'lp-pace');
    this.closeBtn = el('button', 'btn btn--ghost lp-x', 'Close');
    this.closeBtn.type = 'button';
    this.closeBtn.setAttribute('aria-label', 'Close lane details');
    this.closeBtn.addEventListener('click', () => this.close());
    head.append(this.title, this.picker, this.pace, this.closeBtn);

    const sceneBar = el('div', 'lp-scenebar');
    this.sceneCv = el('canvas', 'lp-scene');
    this.sceneCv.width = SCENE_W; this.sceneCv.height = SCENE_H;
    this.sceneCv.setAttribute('role', 'img');
    this.sceneCv.setAttribute('aria-label', 'Live view of this lane');
    this.ctx = this.sceneCv.getContext('2d');
    const fl = el('label', 'lp-follow');
    this.followBox = el('input'); this.followBox.type = 'checkbox'; this.followBox.checked = true;
    fl.append(this.followBox, el('span', '', 'Follow lane'));
    this.scrubber = el('input', 'lp-scrub'); this.scrubber.type = 'range'; this.scrubber.min = '0'; this.scrubber.max = '100'; this.scrubber.value = '100';
    this.scrubber.disabled = true; this.scrubber.setAttribute('aria-label', 'Scrub the log');
    this.followBox.addEventListener('change', () => this.setFollow(this.followBox.checked));
    this.scrubber.addEventListener('input', () => { this.scrub = Number(this.scrubber.value) / 100; this.sig = ''; });
    sceneBar.append(this.sceneCv, fl, this.scrubber);

    const mid = el('div', 'lp-mid');
    const table = el('table', 'lp-table');
    table.setAttribute('aria-label', 'Stages of this order');
    const thead = el('thead');
    const hr = el('tr');
    for (const h of ['Stage', 'Status', 'Tries', 'Retries', 'Issues', 'Down', 'Time', 'Recover']) { const th = el('th', '', h); th.scope = 'col'; hr.append(th); }
    thead.append(hr);
    this.tableBody = el('tbody');
    table.append(thead, this.tableBody);
    const tw = el('div', 'lp-tablewrap'); tw.append(table);

    const logWrap = el('div', 'lp-logwrap');
    this.logHead = el('div', 'lp-loghead');
    this.logBox = el('div', 'lp-log');
    this.logBox.setAttribute('role', 'log');
    this.logBox.setAttribute('aria-live', 'off');
    this.logBox.tabIndex = 0;
    logWrap.append(this.logHead, this.logBox);
    mid.append(tw, logWrap);

    const foot = el('div', 'lp-foot');
    this.summary = el('div', 'lp-summary');
    this.review = el('div', 'lp-review');
    const acts = el('div', 'lp-acts');
    this.replayBtn = el('button', 'btn btn--ghost', 'Replay'); this.replayBtn.type = 'button';
    this.replayBtn.addEventListener('click', () => { this.replayAt = performance.now(); this.sig = ''; });
    this.speedSel = el('select', 'lp-sel'); this.speedSel.setAttribute('aria-label', 'Replay speed');
    for (const s of SPEEDS) { const o = el('option', '', `${s}x`); o.value = String(s); this.speedSel.append(o); }
    this.speedSel.addEventListener('change', () => { this.replaySpeed = Number(this.speedSel.value) || 1; });
    this.chaosSel = el('select', 'lp-sel'); this.chaosSel.setAttribute('aria-label', 'Chaos creature');
    const rnd = el('option', '', 'Random'); rnd.value = ''; this.chaosSel.append(rnd);
    this.chaosBtn = el('button', 'btn', 'Chaos'); this.chaosBtn.type = 'button';
    this.chaosBtn.addEventListener('click', () => {
      this.chaosBtn.disabled = true;
      this.host.chaos(this.lane, this.chaosSel.value || undefined).catch((e) => this.host.onError(e)).finally(() => { this.chaosBtn.disabled = false; });
    });
    acts.append(this.replayBtn, this.speedSel, this.chaosSel, this.chaosBtn);
    foot.append(this.summary, this.review, acts);

    this.lapsBox = el('details', 'lp-laps') as HTMLDetailsElement;
    this.lapsBody = el('div', 'lp-lapsbody');
    this.lapsBox.append(el('summary', '', 'Laps of this wave'), this.lapsBody);
    this.lapsBox.addEventListener('toggle', () => { this.sig = ''; });
    dlg.append(head, sceneBar, mid, this.lapsBox, foot);
    root.append(dlg);
    root.addEventListener('mousedown', (e) => { if (e.target === root) this.close(); });
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  get isOpen(): boolean { return this.openState; }

  /** Every event passes through here so a popup opened later still has the lane's history. */
  record(ev: ArenaEvent): void {
    if (ev.type === 'reset') { this.buf = []; this.close(); return; }
    if (typeof ev.lane !== 'number') return;
    this.buf.push(ev);
    if (this.buf.length > MAX_BUF) this.buf.splice(0, this.buf.length - MAX_BUF);
  }

  /** Same signature as the old inspector: `stageIdx` and `stage` focus the table and log on that stage. */
  open(lane: number, _stageIdx: number | null, stage: string | null, order: string | null): void {
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.lane = lane;
    this.stageFocus = stage;
    this.picked = order && this.host.laneInfo(lane)?.order !== order ? order : null;
    this.pinSeq = this.buf.length > 0 ? this.buf[this.buf.length - 1]!.seq : 0;
    this.filter = 'all';
    this.follow = true; this.followBox.checked = true; this.scrubber.disabled = true; this.scrub = 1; this.frozen = null;
    this.replayAt = null;
    this.serverOrder = null; this.serverLaps = null;
    this.sig = '';
    this.pickerSig = '';
    this.openState = true;
    this.root.classList.remove('hidden');
    this.host.fetchLaps(lane).then((d) => { if (this.openState && this.lane === lane) { this.serverLaps = d; this.sig = ''; } }).catch(() => { /* the buffer still fills it */ });
    this.fetchPicked();
    if (!this.creatureList) {
      this.host.creatures().then((c) => {
        this.creatureList = c;
        for (const x of c.filter((k) => !k.boss)) { const o = el('option', '', x.label); o.value = x.id; this.chaosSel.append(o); }
      }).catch(() => { this.creatureList = []; });
    }
    this.closeBtn.focus();
  }

  close(): void {
    if (!this.openState) return;
    this.openState = false;
    this.root.classList.add('hidden');
    this.returnFocus?.focus?.();
    this.returnFocus = null;
  }

  private setFollow(on: boolean): void {
    this.follow = on;
    this.scrubber.disabled = on;
    this.scrub = 1;
    this.scrubber.value = '100';
    if (!on) {
      // Freeze the last frame so the scrubber has a still picture to sit beside.
      const f = document.createElement('canvas');
      f.width = SCENE_W; f.height = SCENE_H;
      f.getContext('2d')?.drawImage(this.sceneCv, 0, 0);
      this.frozen = f;
    } else this.frozen = null;
    this.sig = '';
  }

  private fetchPicked(): void {
    const lane = this.lane;
    const order = this.picked ?? this.host.laneInfo(lane)?.order ?? null;
    this.serverOrder = null;
    this.serverFor = order ?? '';
    if (!order || order === ALL_ORDERS) return;
    this.host.fetchOrder(lane, order).then((d) => {
      if (this.openState && this.lane === lane && this.serverFor === order) { this.serverOrder = d; this.sig = ''; }
    }).catch(() => { /* the buffer still fills it */ });
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.openState) return;
    if (e.key === 'Escape') { e.stopPropagation(); this.close(); return; }
    if (e.key !== 'Tab') return;
    const f = Array.from(this.dlg.querySelectorAll<HTMLElement>('button, select, input, [tabindex="0"]')).filter((x) => !(x as HTMLButtonElement).disabled && x.offsetParent !== null);
    if (f.length === 0) return;
    const first = f[0]!; const last = f[f.length - 1]!;
    const active = document.activeElement;
    if (!this.dlg.contains(active)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  }

  private currentOrder(): string | null { return this.host.laneInfo(this.lane)?.order ?? null; }

  /** Call once per animation frame. Redraws the scene each frame and the panels only when something changed. */
  render(now: number): void {
    if (!this.openState) return;
    this.drawScene();
    const info = this.host.laneInfo(this.lane);
    const cur = info?.order ?? null;
    const order = this.picked ?? cur;
    if ((order ?? '') !== this.serverFor) this.fetchPicked();
    const seg = segment(this.buf, this.lane);
    const allOrders = order === ALL_ORDERS;
    // "All orders" only widens the log; the table, lap and review keep describing the current order.
    const evs = allOrders ? (cur ? seg.get(cur) ?? [] : []) : order ? seg.get(order) ?? [] : [];
    const logEvs = allOrders ? sortUnique([...seg.values()].flat()) : evs;
    const stageIds = this.host.stageIds();
    const rows = stageRows(evs, stageIds, this.serverOrder);
    const orders = orderRows(this.buf, this.lane, this.serverLaps);
    const all = logEntries(logEvs, this.host.stageLabel);
    const outcomeRow = orders.find((o) => o.order === (allOrders ? cur : order));
    const outcome = outcomeRow?.outcome ?? 'running';
    const live = !!info?.running && order === cur && outcome === 'running';
    const pinned = this.picked !== null;

    let shown = filterLog(all, this.filter, this.stageFocus);
    let replaying = false;
    if (this.replayAt !== null) {
      const dur = REPLAY_BASE_MS / this.replaySpeed;
      const n = replayCount(shown.length, now - this.replayAt, dur);
      replaying = now - this.replayAt < dur;
      if (!replaying) this.replayAt = null;
      shown = shown.slice(0, n);
    } else if (!this.follow) shown = shown.slice(0, Math.ceil(shown.length * this.scrub));

    // A pinned view only changes when its own order gets events, so reading never fights new live activity.
    const lastOwn = logEvs.length > 0 ? logEvs[logEvs.length - 1]!.seq : 0;
    const lastAny = this.buf.length > 0 ? this.buf[this.buf.length - 1]!.seq : 0;
    const last = pinned ? lastOwn : lastAny;
    const missed = pinned ? this.buf.filter((e) => e.lane === this.lane && e.seq > this.pinSeq).length : 0;
    const key = [this.lane, order, this.filter, this.stageFocus, shown.length, last, live, replaying, this.follow, this.scrub,
      this.serverOrder ? 1 : 0, this.serverLaps ? 1 : 0, info?.tier, outcome, pinned ? 'p' : cur, pinned ? Math.min(missed, 99) : ''].join('|');
    this.replayBtn.disabled = live || replaying || all.length === 0;
    this.chaosBtn.classList.toggle('hidden', !live);
    this.chaosSel.classList.toggle('hidden', !live);
    if (key === this.sig) return;
    this.sig = key;

    this.title.textContent = `Lane ${this.lane}: ${info?.tier ?? ''}`.trim();
    this.paintPicker(orders, order);
    this.paintTable(rows);
    this.paintLog(shown, all.length, live, pinned, missed);
    const lap = lapOf(evs, rows, this.serverOrder);
    const rv = reviewOf(evs, outcome, this.serverOrder);
    this.paintSummary(lap, rv, evs, outcome, orders, order, live);
    this.paintReview(rv);
    const cum = rv?.cum ?? this.latestCum();
    this.pace.textContent = cum ? `\u2605 ${starText(cum.stars)}/${cum.max}` : '';
    this.pace.title = 'Stars so far in this wave';
    if (this.lapsBox.open) this.lapsBody.replaceChildren(renderLapTable(mergeLapRows(lapRowsOf(this.serverLaps), lapRowsFromEvents(this.buf, this.lane)), 'Laps of this wave'));
  }

  private latestCum(): { stars: number; max: number } | null {
    for (let i = this.buf.length - 1; i >= 0; i--) {
      const e = this.buf[i]!;
      if (e.lane !== this.lane || e.type !== 'review') continue;
      const c = (e.detail as Record<string, any> | undefined)?.cum;
      if (c && typeof c.stars === 'number') return { stars: c.stars, max: Number(c.max) || 0 };
    }
    return null;
  }

  private drawScene(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.follow && this.frozen) { ctx.drawImage(this.frozen, 0, 0); return; }
    const box = this.host.laneBox(this.lane);
    ctx.fillStyle = '#0d0b14';
    ctx.fillRect(0, 0, SCENE_W, SCENE_H);
    if (!box) return;
    // Crop the lane out of the arena canvas, scaled to fit while keeping its aspect ratio.
    const sw = this.source.width;
    const k = sw / 1920;
    const scale = Math.min(SCENE_W / sw, SCENE_H / (box.h * k));
    const dw = sw * scale; const dh = box.h * k * scale;
    ctx.drawImage(this.source, 0, box.top * k, sw, box.h * k, (SCENE_W - dw) / 2, (SCENE_H - dh) / 2, dw, dh);
  }

  private paintPicker(orders: OrderRow[], order: string | null): void {
    const psig = `${this.lane}|${order}|${orders.map((o) => `${o.order}:${o.outcome}:${o.lapMs}:${o.stars}`).join(',')}`;
    if (psig === this.pickerSig) return;
    this.pickerSig = psig;
    const sel = el('select', 'lp-sel lp-ordersel');
    sel.setAttribute('aria-label', 'Order');
    const bs = bestSlowest(orders);
    if (orders.length > 0) { const all = el('option', '', 'All orders'); all.value = ALL_ORDERS; all.selected = order === ALL_ORDERS; sel.append(all); }
    for (const o of orders) {
      const tag = bs?.best === o.order ? ' \u2605best' : bs?.slowest === o.order ? ' \uD83D\uDC22slowest' : '';
      const opt = el('option', '', `${OUTCOME_ICON[o.outcome]} ${o.order}${o.lapMs !== null ? ` ${secs(o.lapMs)}` : ''}${o.stars !== null ? ` \u2605${starText(o.stars)}` : ''}${tag}`);
      opt.value = o.order;
      opt.selected = o.order === order;
      sel.append(opt);
    }
    if (orders.length === 0) { const o = el('option', '', 'No orders yet'); o.value = ''; sel.append(o); sel.disabled = true; }
    sel.addEventListener('change', () => {
      const cur = this.currentOrder();
      this.picked = sel.value && sel.value !== cur ? sel.value : null;
      this.pinSeq = this.buf.length > 0 ? this.buf[this.buf.length - 1]!.seq : 0;
      this.replayAt = null; this.stageFocus = null;
      this.fetchPicked();
      this.sig = '';
    });
    const hadFocus = this.picker.contains(document.activeElement);
    this.picker.replaceChildren(el('span', 'lp-lab', 'Order'), sel);
    if (hadFocus) sel.focus();
  }

  private paintTable(rows: ReturnType<typeof stageRows>): void {
    this.tableBody.replaceChildren(...rows.map((r) => {
      const tr = el('tr', `lp-row lp-st-${r.state}${this.stageFocus === r.stage ? ' lp-row--on' : ''}`);
      const name = el('td');
      const b = el('button', 'lp-rowbtn', this.host.stageLabel(r.stage));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(this.stageFocus === r.stage));
      b.title = 'Show only this stage in the log';
      b.addEventListener('click', () => { this.stageFocus = this.stageFocus === r.stage ? null : r.stage; this.sig = ''; });
      name.append(b);
      const status = el('td', 'lp-status', `${r.icon} ${CHIP_WORD[r.state]}`);
      const cells = [
        el('td', '', r.attempts ? String(r.attempts) : '-'),
        el('td', '', String(r.retries)),
        el('td', r.issues ? 'lp-bad' : '', r.issues ? `\u2691 ${r.issues}` : '0'),
        el('td', r.downtimeMs > 0 ? 'lp-bad' : '', r.downtimeMs > 0 ? secs(r.downtimeMs) : '-'),
        el('td', '', r.ms !== null ? `${r.ms} ms` : '-'),
        el('td', '', r.recoverable === 'n/a' ? 'n/a' : r.recoverable),
      ];
      tr.append(name, status, ...cells);
      return tr;
    }));
  }

  private paintLog(shown: ReturnType<typeof filterLog>, total: number, live: boolean, pinned: boolean, missed: number): void {
    // Never repaint under a text selection: the reader is copying or reading.
    const sel = typeof window !== 'undefined' ? window.getSelection?.() : null;
    if (pinned && sel && !sel.isCollapsed && sel.anchorNode && this.logBox.contains(sel.anchorNode)) return;
    const hadFocus = this.logHead.contains(document.activeElement);
    const bar = FILTERS.map((f) => {
      const b = el('button', `lp-chip${this.filter === f ? ' lp-chip--on' : ''}`, f === 'all' ? 'All' : f === 'issues' ? 'Issues' : 'Score');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(this.filter === f));
      b.addEventListener('click', () => { this.filter = f; this.sig = ''; });
      return b;
    });
    const note = el('span', 'lp-lognote', `${live ? '\u25CF LIVE ' : ''}${this.stageFocus ? `Stage: ${this.host.stageLabel(this.stageFocus)} ` : ''}(${shown.length}/${total})`);
    const extra: HTMLElement[] = [];
    if (pinned) {
      const pause = el('span', 'lp-pause', `⏸ Paused${missed > 0 ? `, ${missed} new elsewhere` : ''}`);
      const back = el('button', 'lp-chip', 'Back to live'); back.type = 'button';
      back.addEventListener('click', () => { this.picked = null; this.fetchPicked(); this.sig = ''; this.pickerSig = ''; });
      extra.push(pause, back);
    }
    this.logHead.replaceChildren(...bar, note, ...extra);
    if (hadFocus) (this.logHead.querySelector('.lp-chip--on') as HTMLElement | null)?.focus();
    const prevTop = this.logBox.scrollTop;
    const wasBottom = this.logBox.scrollHeight - this.logBox.clientHeight - prevTop < 24 || this.logBox.childElementCount === 0;
    this.logBox.replaceChildren(...shown.map((x) => {
      const row = el('div', `lp-line lp-line--${x.level}`);
      row.append(el('span', 'lp-ic', x.icon), el('span', 'lp-t', offsetText(x.t)), el('span', '', x.text));
      return row;
    }));
    // Live view follows the newest line; a pinned view keeps exactly where the reader is.
    this.logBox.scrollTop = !pinned && wasBottom ? this.logBox.scrollHeight : pinned ? prevTop : prevTop;
  }

  private paintSummary(lap: ReturnType<typeof lapOf>, rv: ReturnType<typeof reviewOf>, evs: ArenaEvent[], outcome: keyof typeof OUTCOME_WORD, orders: OrderRow[], order: string | null, live: boolean): void {
    void rv;
    const pts = downtimePoints(evs);
    const bs = bestSlowest(orders);
    const facts: [string, string, string][] = lap
      ? [
        ['Lap', `${secs(lap.ms)}${lap.final ? '' : ' so far'}`, ''],
        ['Attempts', String(lap.attempts), ''],
        ['Retries', String(lap.retries), ''],
        ['Downtime', lap.downtimeMs > 0 ? `${secs(lap.downtimeMs)}${pts ? ` (-${pts} points)` : ''}` : 'none', lap.downtimeMs > 0 ? 'lp-bad' : ''],
        ['Issues', String(lap.issues), lap.issues ? 'lp-bad' : ''],
      ]
      : [['Lap', 'no data yet', '']];
    const head = el('div', 'lp-sumhead');
    head.append(el('b', '', `Lap summary${order ? `: order ${order}` : ''}`), el('span', `lp-out lp-out--${outcome}`, `${OUTCOME_ICON[outcome]} ${OUTCOME_WORD[outcome]}${live ? ' (live)' : ''}`));
    if (bs && order === bs.best) head.append(el('span', 'lp-tag lp-tag--best', '\u2605 best lap'));
    if (bs && order === bs.slowest) head.append(el('span', 'lp-tag lp-tag--slow', '\uD83D\uDC22 slowest lap'));
    const grid = el('div', 'lp-facts');
    for (const [k, v, c] of facts) { const f = el('div', 'lp-fact'); f.append(el('span', '', k), el('b', c, v)); grid.append(f); }
    this.summary.replaceChildren(head, grid);
  }

  private paintReview(rv: ReturnType<typeof reviewOf>): void {
    if (!rv) { this.review.replaceChildren(el('div', 'lp-rvnone', 'No review yet')); return; }
    const card = el('div', `lp-rv lp-rv--${starTone(rv.stars)}`);
    const top = el('div', 'lp-rvtop');
    const av = el('span', `lp-avatar${rv.stars >= 4 ? ' lp-avatar--happy' : rv.stars >= 3 ? '' : ' lp-avatar--mad'}`, rv.stars >= 3 ? '\u263A' : '\u2639');
    av.setAttribute('aria-hidden', 'true');
    top.append(av, el('b', 'lp-stars', `${starGlyphs(rv.stars)} ${starText(rv.stars)}`));
    card.append(top);
    if (rv.cancelled) card.append(el('div', 'lp-rvtext', 'Never arrived'));
    else {
      const bars = el('div', 'lp-bars');
      for (const s of rv.sub) {
        const r = el('div', 'lp-bar');
        const fill = el('i'); fill.style.width = `${Math.max(0, Math.min(100, (s.value / 5) * 100))}%`;
        const track = el('span', 'lp-track'); track.append(fill);
        r.append(el('span', 'lp-barlab', s.label), track, el('span', 'lp-barval', starText(s.value)));
        bars.append(r);
      }
      card.append(bars);
    }
    if (rv.text) card.append(el('div', 'lp-rvtext', `"${rv.text}"`));
    this.review.replaceChildren(card);
  }
}
