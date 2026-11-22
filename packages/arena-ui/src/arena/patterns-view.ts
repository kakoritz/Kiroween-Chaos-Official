// TV3-U11: the Patterns screen, the loop's money shot: run, mine, apply, rerun, closed. A modal opened from the header or the final
// screen. List of patterns by cost with status chips, "Write fix spec", "Improve" with a progress strip, and the compare report.
import {
  HANDLING_WORD, PHASES, PHASE_DOES, PHASE_LABEL, STATUS_TIP, STATUS_WORD, foldPattern, gradeMove, isRunning, lowerIsBetter, metricText, overlayText, parseImprove,
  parsePatterns, patternTitle, phaseProgress, plainFix, secText, specResultOf, type CompareReport, type Delta, type ImproveState, type PatternRow, type SpecResult,
} from './patterns';
import { Card, el } from './tournament-view';

export interface PatternsHost {
  getPatterns(): Promise<unknown>;
  writeSpecs(): Promise<unknown>;
  startImprove(): Promise<unknown>;
  getImprove(): Promise<unknown>;
  stageLabel(id: string): string;
  laneTitle(lane: number): string;
  onError(e: unknown): void;
  /** Tell the header about the count (qualifying patterns) and whether the loop runs. */
  onBadge?(qualifying: number, running: boolean): void;
}

const POLL_MS = 1500;

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back */ }
  try {
    const t = document.createElement('textarea');
    t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.append(t); t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
  } catch { return false; }
}

/** Owns the data (patterns, spec, improve state); paints only while open, but keeps the badge fresh. */
export class PatternsPanel extends Card {
  rows: PatternRow[] = [];
  qualifying = 0;
  thresholds = '';
  spec: SpecResult | null = null;
  improve: ImproveState | null = null;
  private timer: number | undefined;
  private body: HTMLElement | null = null;
  private busy = { spec: false, improve: false };
  private loaded = false;

  constructor(stage: HTMLElement, private readonly host: PatternsHost, private readonly reduced: () => boolean) { super(stage); }

  /** Events: `pattern` and `spec_written` update the data live. */
  onEvent(ev: { type: string; detail?: Record<string, unknown> }): void {
    if (ev.type === 'pattern') { this.rows = foldPattern(this.rows, ev.detail); this.qualifying = this.rows.filter((p) => p.qualifies).length; this.refresh(); }
    else if (ev.type === 'spec_written') { const s = specResultOf(ev.detail); if (s) { this.spec = s; this.refresh(); } }
    else if (ev.type === 'reset') { this.rows = []; this.qualifying = 0; this.spec = null; this.refresh(); }
  }

  /** The improve loop is running its tournaments. */
  get running(): boolean { return isRunning(this.improve); }

  async open(): Promise<void> {
    this.paintShell();
    await this.reload();
    this.poll();
  }

  protected override onClose(): void { this.body = null; if (!isRunning(this.improve)) this.stopPoll(); }

  /** Called once at page load: is a loop already running, and how many patterns are waiting? */
  async hydrate(): Promise<void> {
    await this.reload(true);
    if (isRunning(this.improve)) this.poll();
  }

  private async reload(quiet = false): Promise<void> {
    try { const v = parsePatterns(await this.host.getPatterns()); this.rows = v.rows; this.qualifying = v.qualifying; this.thresholds = v.thresholds; } catch (e) { if (!quiet) this.host.onError(e); }
    try { this.improve = parseImprove(await this.host.getImprove()) ?? this.improve; } catch { /* no loop yet */ }
    if (this.improve?.spec) this.spec = this.improve.spec;
    this.loaded = true;
    this.refresh();
  }

  private poll(): void {
    this.stopPoll();
    this.timer = window.setInterval(async () => {
      const was = this.improve?.phase;
      try { this.improve = parseImprove(await this.host.getImprove()) ?? this.improve; } catch { /* keep the last state */ }
      if (this.improve?.spec) this.spec = this.improve.spec;
      if (this.improve && this.improve.phase !== was) {
        try { const v = parsePatterns(await this.host.getPatterns()); this.rows = v.rows; this.qualifying = v.qualifying; } catch { /* keep */ }
      }
      this.refresh();
      if (!isRunning(this.improve) && !this.isOpen) this.stopPoll();
    }, POLL_MS);
  }

  private stopPoll(): void { window.clearInterval(this.timer); this.timer = undefined; }

  private refresh(): void {
    this.host.onBadge?.(this.qualifying, isRunning(this.improve));
    if (!this.body) return;
    const top = this.body.scrollTop;
    this.body.replaceChildren(...this.sections());
    this.body.scrollTop = top;
  }

  private paintShell(): void {
    const dlg = el('section', 'tv-card pt-card');
    const head = el('div', 'pt-head');
    const h = el('h2', '', 'Patterns'); h.id = 'pt-title';
    head.append(h, el('span', 'tv-sub', 'Recurring trouble across runs, most costly first. The loop closes it: run, mine, apply, rerun.'));
    const acts = el('div', 'pt-acts');
    const spec = el('button', 'btn btn--ghost', 'Write fix spec'); spec.type = 'button'; spec.id = 'pt-spec';
    spec.title = 'Write a Kiro spec folder for the patterns that qualify. Nothing is applied: Kiro does that, with the review step.';
    spec.addEventListener('click', () => void this.writeSpec(spec));
    const imp = el('button', 'btn', '▶ Improve'); imp.type = 'button'; imp.id = 'pt-improve';
    imp.title = 'Run the plan, mine it, apply the cheap fixes as policy, rerun the same plan and compare.';
    imp.addEventListener('click', () => void this.startImprove());
    acts.append(spec, imp);
    head.append(acts);
    this.body = el('div', 'pt-body');
    const foot = el('div', 'tv-foot');
    const close = el('button', 'btn btn--ghost', 'Close'); close.type = 'button';
    close.addEventListener('click', () => this.close());
    foot.append(close);
    dlg.append(head, this.body, foot);
    this.mount(dlg, imp, 'pt-title');
    this.refresh();
  }

  private async writeSpec(btn: HTMLButtonElement): Promise<void> {
    if (this.busy.spec) return;
    this.busy.spec = true; btn.disabled = true;
    try {
      const raw = await this.host.writeSpecs();
      this.spec = specResultOf(raw) ?? this.spec;
      await this.reload(true);
    } catch (e) { this.host.onError(e); }
    this.busy.spec = false; btn.disabled = false;
    this.refresh();
  }

  private async startImprove(): Promise<void> {
    if (this.busy.improve || isRunning(this.improve)) return;
    this.busy.improve = true;
    try {
      const raw = await this.host.startImprove();
      this.improve = parseImprove(raw) ?? { id: 'imp', phase: 'before', startedAt: Date.now(), report: null, spec: null, error: '' };
      this.poll();
    } catch (e) { this.host.onError(e); }
    this.busy.improve = false;
    this.refresh();
  }

  private sections(): HTMLElement[] {
    const out: HTMLElement[] = [this.strip()];
    const rep = this.improve?.report ?? null;
    if (this.improve?.phase === 'error') out.push(el('p', 'pt-err', `The loop stopped: ${this.improve.error || 'unknown error'}`));
    if (rep) out.push(this.compare(rep));
    if (this.spec) out.push(this.specCard(this.spec));
    out.push(this.list(rep));
    const imp = this.dom('pt-improve'); const spec = this.dom('pt-spec');
    const running = isRunning(this.improve);
    if (imp) { (imp as HTMLButtonElement).disabled = running; imp.textContent = running ? 'Improving...' : rep ? '▶ Improve again' : '▶ Improve'; }
    if (spec) (spec as HTMLButtonElement).disabled = this.busy.spec || !this.rows.some((p) => p.qualifies && p.status === 'new');
    return out;
  }

  private dom(id: string): HTMLElement | null { return this.dim?.querySelector<HTMLElement>(`#${id}`) ?? null; }

  /** The loop strip: Run, Mine, Apply, Rerun, Compare, Closed. The running step pulses; the bar fills as phases pass. */
  private strip(): HTMLElement {
    const phase = this.improve?.phase ?? null;
    const idx = phase ? (phase === 'error' ? -1 : PHASES.indexOf(phase)) : -2;
    const wrap = el('div', `pt-strip${phase === 'done' ? ' pt-strip--done' : ''}${isRunning(this.improve) ? ' pt-strip--run' : ''}${this.reduced() ? ' pt-still' : ''}`);
    const steps = el('ol', 'pt-steps'); steps.setAttribute('aria-label', 'Improve loop');
    PHASES.forEach((p, i) => {
      const done = idx > i || phase === 'done';
      const now = idx === i && phase !== 'done';
      const li = el('li', `pt-step${done ? ' done' : ''}${now ? ' now' : ''}`);
      li.setAttribute('aria-current', now ? 'step' : 'false');
      li.append(el('i', '', done ? '✓' : String(i + 1)), el('b', '', PHASE_LABEL[p]));
      steps.append(li);
    });
    const bar = el('div', 'pt-bar'); bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100');
    const pct = phase && phase !== 'error' ? Math.round(phaseProgress(phase) * 100) : 0;
    bar.setAttribute('aria-valuenow', String(pct));
    const fill = el('span'); fill.style.width = `${pct}%`; bar.append(fill);
    const txt = el('p', 'pt-do', phase === null ? 'Not run yet. Improve runs the plan, mines it, applies the cheap fixes and reruns the same plan.' : phase === 'error' ? PHASE_DOES.error : PHASE_DOES[phase]);
    wrap.append(steps, bar, txt);
    return wrap;
  }

  private delta(label: string, d: Delta, kind: 'reliability' | 'score' | 'count', key: 'reliability' | 'score' | 'lost' | 'repeats'): HTMLElement {
    const card = el('div', 'pt-m');
    const b = typeof d.before === 'number' ? d.before : null, a = typeof d.after === 'number' ? d.after : null;
    const better = b !== null && a !== null ? (lowerIsBetter(key) ? a < b : a > b) : false;
    const worse = b !== null && a !== null ? (lowerIsBetter(key) ? a > b : a < b) : false;
    card.append(el('span', 'pt-ml', label));
    const row = el('div', 'pt-mv');
    row.append(el('span', 'pt-from', metricText(kind, d.before)), el('i', '', '→'), el('b', worse ? 'pt-bad' : better ? 'pt-good' : '', metricText(kind, d.after)));
    card.append(row);
    return card;
  }

  /** "Closed 7 of 9 patterns", grade before to after, the four metrics, overlays applied. */
  private compare(rep: CompareReport): HTMLElement {
    const box = el('section', 'pt-cmp'); box.setAttribute('aria-label', 'Compare report');
    const left = el('div', 'pt-closed');
    left.append(el('span', 'pt-cl', 'CLOSED'));
    const big = el('div', 'pt-big'); big.append(el('b', '', String(rep.closed)), el('span', '', `of ${rep.of}`));
    left.append(big, el('span', 'pt-cl', rep.of === 1 ? 'PATTERN' : 'PATTERNS'));
    const ring = el('div', 'pt-meter'); const f = el('span'); f.style.width = `${rep.of > 0 ? Math.round((rep.closed / rep.of) * 100) : 0}%`; ring.append(f); left.append(ring);
    const grade = el('div', 'pt-grade');
    const mv = gradeMove(rep.grade);
    grade.append(el('span', 'pt-cl', 'GRADE'));
    const gr = el('div', 'pt-gv');
    gr.append(el('b', 'pt-g pt-g0', String(rep.grade.before ?? '-')), el('i', '', '→'), el('b', `pt-g pt-g1${mv > 0 ? ' up' : mv < 0 ? ' down' : ''}`, String(rep.grade.after ?? '-')));
    grade.append(gr, el('span', 'pt-gs', mv > 0 ? 'better than the first run' : mv < 0 ? 'worse than the first run' : 'same as the first run'));
    const ms = el('div', 'pt-ms');
    ms.append(this.delta('Reliability', rep.reliability, 'reliability', 'reliability'), this.delta('Score', rep.score, 'score', 'score'), this.delta('Lost orders', rep.lost, 'count', 'lost'), this.delta('Repeats', rep.repeats, 'count', 'repeats'));
    box.append(left, grade, ms);
    if (rep.overlays.length > 0) {
      const ov = el('div', 'pt-ov');
      ov.append(el('b', '', `Policy overlays applied (${rep.overlays.length})`));
      const ul = el('ul');
      for (const o of rep.overlays.slice(0, 6)) ul.append(el('li', o.existing ? 'ex' : '', overlayText(o, this.host.stageLabel)));
      if (rep.overlays.length > 6) ul.append(el('li', 'ex', `+ ${rep.overlays.length - 6} more`));
      ov.append(ul);
      box.append(ov);
    }
    return box;
  }

  private specCard(s: SpecResult): HTMLElement {
    const box = el('section', `pt-spec${s.lintOk === false ? ' bad' : ''}`); box.setAttribute('aria-label', 'Fix spec written');
    const top = el('div', 'pt-spec-top');
    top.append(el('b', '', 'Fix spec written'), el('span', `pt-lint ${s.lintOk === false ? 'bad' : s.lintOk ? 'ok' : ''}`, s.lintOk === null ? 'lint not run' : s.lintOk ? '✓ lint ok' : `⚠ lint: ${s.issues.length} ${s.issues.length === 1 ? 'issue' : 'issues'}`));
    const path = el('div', 'pt-path'); path.append(el('code', '', s.path || s.runId));
    const copy = el('button', 'btn btn--ghost pt-copy', 'Copy path'); copy.type = 'button';
    copy.addEventListener('click', async () => { const ok = await copyText(s.path); copy.textContent = ok ? 'Copied' : 'Copy failed'; window.setTimeout(() => { copy.textContent = 'Copy path'; }, 1600); });
    path.append(copy);
    box.append(top, path);
    box.append(el('p', 'pt-sm', `${s.patterns.length} ${s.patterns.length === 1 ? 'pattern' : 'patterns'} written${s.refused.length ? `, ${s.refused.length} refused (no small patch)` : ''}. Kiro applies it, with the review step.`));
    if (s.issues.length > 0) { const ul = el('ul', 'pt-issues'); for (const i of s.issues.slice(0, 4)) ul.append(el('li', '', i)); box.append(ul); }
    return box;
  }

  /** The pattern list. With a compare report, each row also shows before and after and a closed tick. */
  private list(rep: CompareReport | null): HTMLElement {
    const wrap = el('section', 'pt-list'); wrap.setAttribute('aria-label', 'Patterns');
    const head = el('div', 'pt-lh');
    head.append(el('h3', '', 'Patterns'), el('span', 'tv-sub', this.rows.length ? `${this.rows.length} found, ${this.qualifying} qualify for a fix spec. ${this.thresholds}` : this.loaded ? 'None yet. Run a tournament and the miner reads every round.' : 'Loading...'));
    wrap.append(head);
    if (this.rows.length === 0) return wrap;
    const table = el('div', 'pt-table'); table.setAttribute('role', 'table'); table.setAttribute('aria-label', 'Patterns by cost');
    const hr = el('div', 'pt-row pt-row--h'); hr.setAttribute('role', 'row');
    for (const c of ['Status', 'Pattern and fix', rep ? 'Before → after' : 'Seen', 'Downtime', 'Lost', 'Repeats', 'Lanes', 'Evidence']) { const x = el('span', '', c); x.setAttribute('role', 'columnheader'); hr.append(x); }
    table.append(hr);
    for (const p of this.rows.slice(0, 12)) {
      const cmp = rep?.patterns.find((c) => c.id === p.id || c.signature === p.signature);
      const row = el('div', `pt-row${p.qualifies ? ' q' : ''}${cmp?.closed ? ' closed' : ''}`); row.setAttribute('role', 'row');
      const st = el('span', `pt-chip pt-chip--${cmp?.closed ? 'verified' : p.status}`, `${cmp?.closed ? '✓ ' : ''}${STATUS_WORD[cmp?.closed ? 'verified' : p.status]}`); st.title = STATUS_TIP[cmp?.closed ? 'verified' : p.status]; st.setAttribute('role', 'cell');
      const what = el('span', 'pt-what'); what.setAttribute('role', 'cell');
      what.append(el('b', '', patternTitle(p, this.host.stageLabel)));
      if (p.unknown) { const u = el('i', 'cbk-unk', '? UNKNOWN'); if (p.fingerprint) u.title = p.fingerprint; what.append(u); }
      what.append(el('small', '', plainFix(p)));
      const seen = el('span', 'pt-n'); seen.setAttribute('role', 'cell');
      if (cmp) { seen.append(el('span', 'pt-from', String(cmp.before)), el('i', '', '→'), el('b', cmp.after < cmp.before ? 'pt-good' : cmp.after > cmp.before ? 'pt-bad' : '', String(cmp.after))); seen.title = `Handled by ${HANDLING_WORD[cmp.handling] ?? cmp.handling}`; }
      else seen.textContent = `${p.count}×`;
      const dt = el('span', 'pt-n', p.downtimeMs > 0 ? secText(p.downtimeMs) : '-'); dt.setAttribute('role', 'cell');
      const lost = el('span', `pt-n${p.lostOrders > 0 ? ' pt-bad' : ''}`, p.lostOrders > 0 ? String(p.lostOrders) : '-'); lost.setAttribute('role', 'cell');
      const rep2 = el('span', `pt-n${p.repeats > 0 ? ' pt-bad' : ''}`, p.repeats > 0 ? String(p.repeats) : '-'); rep2.setAttribute('role', 'cell');
      const lanes = el('span', 'pt-lanes', p.lanes.map((n) => this.host.laneTitle(n) || `L${n}`).join(', ') || '-'); lanes.setAttribute('role', 'cell'); lanes.title = lanes.textContent ?? '';
      const ev = el('span', 'pt-n', p.evidence > 0 ? String(p.evidence) : '-'); ev.setAttribute('role', 'cell'); ev.title = 'Event numbers, journal lines and reports behind it';
      row.append(st, what, seen, dt, lost, rep2, lanes, ev);
      table.append(row);
    }
    wrap.append(table);
    if (this.rows.length > 12) wrap.append(el('p', 'cbk-more', `+ ${this.rows.length - 12} cheaper patterns not shown`));
    return wrap;
  }
}
