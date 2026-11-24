// PK-U3: the Live Chaos panel. A modal opened from the header: mode selector, guard-rail summary, a big KILL SWITCH, the steady-state
// meter and the audit log tail. It drives the built-in demo target on the live server and nothing else.
import { Card, el } from '../arena/tournament-view';
import { MODES, MODE_LABEL, MODE_NOTE, auditLine, killNote, meterView, parseMonkey, parsePreview, railsView, statusLine, type MonkeyMode, type MonkeyView } from './model';
import { MonkeyUnavailable, type MonkeyClient } from './client';

export interface MonkeyHost {
  client: MonkeyClient;
  onBadge?(running: boolean): void;
  onError?(e: unknown): void;
}

const POLL_MS = 700;

export class MonkeyPanel extends Card {
  view: MonkeyView | null = null;
  unavailable: string | null = null;
  /** The mode picked in the selector. */
  picked: MonkeyMode = 'observe';
  /** Guard rails of the picked mode, fetched when the selector changes (the server only describes the mode it last ran). */
  preview: { mode: MonkeyMode; lines: string[] } | null = null;
  private timer: number | undefined;
  private body: HTMLElement | null = null;
  private busy = false;

  constructor(stage: HTMLElement, private readonly host: MonkeyHost) { super(stage); }

  async open(): Promise<void> {
    this.paintShell();
    await this.reload();
    this.timer = window.setInterval(() => { void this.reload(true); }, POLL_MS);
  }

  protected override onClose(): void {
    this.body = null;
    if (this.timer !== undefined) { clearInterval(this.timer); this.timer = undefined; }
  }

  /** One read of the server. Also used once at page load to keep the header badge honest. */
  async reload(quiet = false): Promise<void> {
    try {
      const v = parseMonkey(await this.host.client.getState());
      if (v) this.view = v;
      this.unavailable = null;
      this.host.onBadge?.(v?.running ?? false);
    } catch (e) {
      if (e instanceof MonkeyUnavailable) this.unavailable = e.message;
      else if (!quiet) this.host.onError?.(e);
      this.host.onBadge?.(false);
    }
    this.refresh();
  }

  /** Pick a mode and load its guard rails right away. */
  async pick(mode: MonkeyMode): Promise<void> {
    this.picked = mode;
    this.refresh();
    try {
      const p = parsePreview(await this.host.client.preview(mode));
      if (p && p.mode === mode) this.preview = p;
    } catch (e) { if (!(e instanceof MonkeyUnavailable)) this.host.onError?.(e); }
    this.refresh();
  }

  async start(mode: MonkeyMode): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try { this.view = parseMonkey(await this.host.client.start(mode)) ?? this.view; this.picked = mode; }
    catch (e) { this.host.onError?.(e); }
    finally { this.busy = false; }
    this.host.onBadge?.(this.view?.running ?? false);
    this.refresh();
  }

  /** The kill switch. Never disabled while the page can reach the server; idle is harmless. */
  async kill(): Promise<void> {
    try { this.view = parseMonkey(await this.host.client.stop()) ?? this.view; }
    catch (e) { this.host.onError?.(e); }
    this.host.onBadge?.(this.view?.running ?? false);
    this.refresh();
  }

  private paintShell(): void {
    const dlg = el('div', 'tv-card mk-card');
    const head = el('div', 'tv-head');
    const title = el('h2', '', 'Live Chaos');
    title.id = 'mk-title';
    head.append(title, el('span', 'tv-sub', 'demo target only'));
    const close = el('button', 'btn btn--ghost mk-close', 'Close'); close.type = 'button';
    close.addEventListener('click', () => this.close());
    head.append(close);
    this.body = el('div', 'mk-body');
    dlg.append(head, this.body);
    this.mount(dlg, close, 'mk-title');
    this.refresh();
  }

  refresh(): void {
    const b = this.body;
    if (!b) return;
    b.replaceChildren();
    if (this.unavailable) { b.append(el('p', 'mk-note', this.unavailable)); return; }
    const v = this.view;
    if (!v) { b.append(el('p', 'mk-note', 'Loading...')); return; }

    // The kill switch first: it must never be hard to find.
    const kill = el('button', v.running ? 'mk-kill mk-kill--live' : 'mk-kill', 'KILL SWITCH'); kill.type = 'button'; kill.id = 'mk-kill';
    kill.setAttribute('aria-label', 'Kill switch: end every injection now');
    kill.addEventListener('click', () => { void this.kill(); });
    const killBox = el('div', 'mk-killbox');
    killBox.append(kill, el('p', 'mk-killnote', killNote(v)));
    b.append(killBox);

    const status = el('div', `mk-status mk-status--${v.status}`);
    status.setAttribute('role', 'status');
    status.append(el('strong', '', statusLine(v)), el('span', 'mk-inj', ` Injections: ${v.injections}`));
    b.append(status);

    // Mode selector: radio-style buttons; starting is a separate, deliberate press.
    const modes = el('div', 'mk-modes'); modes.setAttribute('role', 'radiogroup'); modes.setAttribute('aria-label', 'Live Chaos mode');
    const shown: MonkeyMode = v.running ? v.mode : this.picked;
    for (const m of MODES) {
      const on = shown === m;
      const btn = el('button', on ? 'btn mk-mode mk-mode--on' : 'btn mk-mode', MODE_LABEL[m]); btn.type = 'button';
      btn.setAttribute('role', 'radio'); btn.setAttribute('aria-checked', String(on)); btn.dataset.mode = m;
      btn.disabled = v.running;
      btn.addEventListener('click', () => { void this.pick(m); });
      modes.append(btn);
    }
    const go = el('button', 'btn mk-go', v.running ? 'Running' : `Start ${MODE_LABEL[this.picked]}`); go.type = 'button'; go.id = 'mk-start';
    go.disabled = v.running || this.busy;
    go.addEventListener('click', () => { void this.start(this.picked); });
    const chosen = el('p', 'mk-chosen'); chosen.setAttribute('aria-live', 'polite');
    chosen.append(el('span', '', v.running ? 'Running mode: ' : 'Selected mode: '), el('strong', '', MODE_LABEL[shown]));
    b.append(modes, chosen, el('p', 'mk-note', MODE_NOTE[shown]), go);

    // Guard rails (the server describes the mode it is running or last ran).
    const rails = el('section', 'mk-rails'); rails.setAttribute('aria-label', 'Guard rails');
    const rv = railsView(v, this.picked, this.preview);
    rails.append(el('h3', '', rv.title));
    const ul = el('ul');
    if (rv.pending) ul.append(el('li', '', 'Loading...'));
    for (const l of rv.lines) ul.append(el('li', '', l));
    rails.append(ul);
    b.append(rails);

    // Steady-state meter.
    const m = meterView(v);
    const meter = el('section', 'mk-meter'); meter.setAttribute('aria-label', 'Steady state');
    meter.append(el('h3', '', `Steady state: ${m.label}`));
    const track = el('div', `mk-track mk-track--${m.tone}`); track.setAttribute('role', 'meter');
    track.setAttribute('aria-valuemin', '0'); track.setAttribute('aria-valuemax', '100'); track.setAttribute('aria-valuenow', String(Math.round(m.fill))); track.setAttribute('aria-valuetext', m.text);
    const fill = el('span', 'mk-fill'); fill.style.width = `${m.fill}%`;
    const mark = el('i', 'mk-mark'); mark.style.left = `${m.marker}%`; mark.title = 'threshold';
    track.append(fill, mark);
    const verdict = v.steady.held === false ? 'BREACHED: every injection was removed.' : v.steady.held === true ? 'Holding.' : 'Collecting samples.';
    meter.append(track, el('p', 'mk-meter-text', `${m.text}. ${verdict}`));
    const dots = el('div', 'mk-dots');
    for (const x of v.steady.recent) dots.append(el('i', x ? 'mk-dot mk-dot--ok' : 'mk-dot mk-dot--bad'));
    meter.append(dots);
    b.append(meter);

    // Audit tail.
    const audit = el('section', 'mk-audit'); audit.setAttribute('aria-label', 'Audit log');
    audit.append(el('h3', '', 'Audit log (latest)'));
    const pre = el('pre', 'mk-log'); pre.tabIndex = 0;
    pre.textContent = v.audit.length ? v.audit.map(auditLine).join('\n') : 'No entries yet.';
    audit.append(pre);
    b.append(audit);
  }
}
