// TV3-U8: the DOM side of the tournament: the header round indicator, the standings card at round end, the champion
// podium at tournament end. The model is tournament.ts; these classes only paint it. Cards open on events and close on the
// next round. The Next button in the header (#next-btn, keys N and Space) stays the one control for `awaiting_next`.
import { TIE_BREAK_RULE, applyTournamentEvent, dropReason, emptyTournament, podiumOf, roundLabel, type Award, type RoundResult, type TournamentVM } from './tournament';
import type { ArenaEvent } from '../api/types';
import { frameFor } from '../rig/skeleton';
import { drawSkeleton } from '../rig/draw';
import { TIER_IDS, type Tier } from '../rig/dress';

export interface TournamentHost {
  laneTitle(lane: number): string;
  laneTier(lane: number): string;
  stageLabel(id: string): string;
  next(): void;
  startTournament(): void;
  reducedMotion(): boolean;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Header pill: "Round 2 of 4, 4 lanes" with one pip per round; a calm tint and "Review" while the show waits for Next. */
export class RoundIndicator {
  constructor(private readonly root: HTMLElement) {
    root.classList.add('rnd', 'hidden');
    root.setAttribute('role', 'status');
  }

  update(t: Pick<TournamentVM, 'active' | 'round' | 'total' | 'live' | 'phase' | 'champion'>): void {
    const label = roundLabel(t);
    this.root.classList.toggle('hidden', !label);
    if (!label) return;
    const review = t.phase === 'review';
    const ended = t.phase === 'ended';
    this.root.classList.toggle('rnd--review', review);
    this.root.classList.toggle('rnd--ended', ended);
    const key = `${label}|${t.phase}|${t.total}`;
    if (this.root.dataset.key === key) return;
    this.root.dataset.key = key;
    this.root.textContent = '';
    const pips = el('span', 'rnd-pips');
    pips.setAttribute('aria-hidden', 'true');
    for (let i = 1; i <= Math.max(t.total, t.round); i++) pips.append(el('i', i < t.round || ended ? 'done' : i === t.round ? 'now' : ''));
    this.root.append(pips, el('span', 'rnd-t', ended ? 'Tournament over' : label));
    if (review && !ended) this.root.append(el('span', 'rnd-tag', 'REVIEW'));
    this.root.title = review ? 'The round is over. Read the standings, then press Next (N or Space).' : 'The worst lane drops each round. The last one standing is the champion.';
  }
}

/** Shared modal frame: dim, dialog, focus trap, Escape. */
abstract class Card {
  protected dim: HTMLElement | null = null;
  private returnFocus: HTMLElement | null = null;
  constructor(protected readonly stage: HTMLElement) {}
  get isOpen(): boolean { return this.dim !== null; }

  close(): void {
    this.dim?.remove();
    this.dim = null;
    this.onClose();
    this.returnFocus?.focus?.();
    this.returnFocus = null;
  }
  protected onClose(): void { /* hook */ }

  protected mount(dlg: HTMLElement, focus: HTMLElement | null, titleId: string): void {
    this.dim?.remove();
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dim = el('div', 'tv-dim');
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-labelledby', titleId);
    dim.append(dlg);
    dim.addEventListener('mousedown', (e) => { if (e.target === dim) this.close(); });
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); this.close(); return; }
      if (e.key !== 'Tab') return;
      const f = Array.from(dlg.querySelectorAll<HTMLElement>('a[href], button'));
      if (f.length === 0) return;
      const first = f[0]!; const last = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    this.stage.append(dim);
    this.dim = dim;
    focus?.focus();
  }
}

/** Standings card at round end: who drops and why, with the tie-break rule line. */
export class RoundCard extends Card {
  private t: TournamentVM = emptyTournament();
  /** Extra sections (lessons, Casebook) added by the Casebook view. */
  extra: ((r: RoundResult) => HTMLElement | null) | null = null;

  constructor(stage: HTMLElement, private readonly host: TournamentHost) { super(stage); }

  onEvent(ev: ArenaEvent): void {
    applyTournamentEvent(this.t, ev as never);
    if (ev.type === 'reset' || ev.type === 'round_start' || ev.type === 'wave_start' || ev.type === 'tournament_end') { if (this.isOpen) this.close(); return; }
    if (ev.type === 'round_end') {
      const r = this.t.results[this.t.results.length - 1];
      if (r) this.paint(r);
    }
  }

  /** A page that loads mid-review shows the card for the last round again. */
  adopt(t: TournamentVM): void {
    this.t = { ...t, results: [...t.results] };
    const r = t.results[t.results.length - 1];
    if (t.phase === 'review' && r) this.paint(r);
  }

  private title(lane: number): string { return this.host.laneTitle(lane) || `Lane ${lane}`; }

  private paint(r: RoundResult): void {
    const dlg = el('section', 'tv-card');
    const total = this.t.total;
    const last = total > 0 && r.round >= total;
    const head = el('div', 'tv-head');
    const h = el('h2', '', `Round ${r.round}${total > 0 ? ` of ${total}` : ''} is over`); h.id = 'tv-title';
    const drops = r.eliminated.length;
    head.append(h, el('span', 'tv-sub', drops > 0 ? `${r.standings.length} lanes fought. ${drops === 1 ? 'One drops' : `${drops} drop`}.` : `${r.standings.length} lanes fought.`));
    dlg.append(head);

    const table = el('div', 'tv-stand');
    table.setAttribute('role', 'table');
    table.setAttribute('aria-label', 'Standings');
    const hdr = el('div', 'tv-row tv-row--h'); hdr.setAttribute('role', 'row');
    for (const c of ['#', 'Lane', 'Points', 'Issues', '']) { const x = el('span', '', c); x.setAttribute('role', 'columnheader'); hdr.append(x); }
    table.append(hdr);
    for (const s of r.standings) {
      const dropped = s.eliminated || r.eliminated.some((e) => e.lane === s.lane);
      const row = el('div', `tv-row${dropped ? ' tv-row--drop' : ''}`); row.setAttribute('role', 'row');
      const rank = el('span', 'tv-rank', String(s.rank));
      const name = el('span', 'tv-name', this.title(s.lane)); name.append(el('i', '', ` lane ${s.lane}`));
      const pts = el('b', `tv-pts${s.rp < 0 ? ' neg' : ''}`, String(s.rp));
      const iss = el('span', 'tv-iss', s.issues === null ? '-' : String(s.issues));
      const st = el('span', `tv-st ${dropped ? 'tv-st--drop' : 'tv-st--safe'}`, dropped ? '☠ DROPS' : last ? '★ FINALIST' : 'SAFE');
      for (const c of [rank, name, pts, iss, st]) c.setAttribute('role', 'cell');
      row.append(rank, name, pts, iss, st);
      table.append(row);
      if (dropped) {
        const why = el('div', 'tv-why');
        why.append(el('b', '', `${this.title(s.lane)} drops: `), document.createTextNode(dropReason(r, s.lane, (n) => this.title(n))));
        const e = r.eliminated.find((x) => x.lane === s.lane);
        if (e?.epitaph) why.append(el('em', '', ` "${e.epitaph}"`));
        table.append(why);
      }
    }
    dlg.append(table);
    dlg.append(el('p', 'tv-rule', `Tie-break: ${TIE_BREAK_RULE}`));
    const more = this.extra?.(r);
    if (more) dlg.append(more);

    const foot = el('div', 'tv-foot');
    const close = el('button', 'btn btn--ghost', 'Browse the logs'); close.type = 'button';
    close.title = 'Close this card. The logs and lane popups stay open. Press N or Space for the next round.';
    close.addEventListener('click', () => this.close());
    const next = el('button', 'btn', last ? 'Final round done' : 'Next round'); next.type = 'button'; next.id = 'tv-next';
    next.title = 'Same as the Next button in the header (N or Space).';
    next.addEventListener('click', () => { this.close(); this.host.next(); });
    foot.append(close, next);
    dlg.append(foot);
    this.mount(dlg, next, 'tv-title');
  }
}

const tierOf = (id: string): Tier | undefined => (TIER_IDS.includes(id as Tier) ? (id as Tier) : undefined);

/** A little canvas with a tier skeleton for the podium. Cheering for the champion, standing for the others. Still when motion is reduced. */
function skeletonCanvas(tier: string, anim: string, size: number, reduced: boolean, running: { stop: boolean }): HTMLCanvasElement {
  const cv = el('canvas', 'tv-skel');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(size * 1.3 * dpr); cv.height = Math.round(size * 1.15 * dpr);
  cv.style.width = `${Math.round(size * 1.3)}px`; cv.style.height = `${Math.round(size * 1.15)}px`;
  const ctx = cv.getContext('2d');
  if (!ctx) return cv;
  const draw = (now: number) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.save();
    ctx.translate(size * 0.65, size * 1.15 - size / 2 - 4);
    const p = reduced ? 0.25 : (now % (anim === 'cheer' ? 800 : 1800)) / (anim === 'cheer' ? 800 : 1800);
    drawSkeleton(ctx, frameFor(anim, p), { silhouette: false, size }, tierOf(tier), tier === 'phoenix' ? ['retry', 'journal', 'idempotency', 'breaker', 'offline_queue'] : []);
    ctx.restore();
  };
  draw(0);
  if (!reduced) {
    const loop = (now: number) => { if (running.stop || !cv.isConnected) return; draw(now); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  return cv;
}

/** The final screen: champion podium first, then awards and the Casebook (added by the Casebook view through `sections`). */
export class FinalScreen extends Card {
  private t: TournamentVM = emptyTournament();
  private anim = { stop: false };
  /** Sections after the podium, in order: awards, Casebook. */
  sections: Array<(t: TournamentVM) => HTMLElement | null> = [];

  constructor(stage: HTMLElement, private readonly host: TournamentHost) { super(stage); }

  /** Read-only view of what the screen was told (shared with the Casebook view). */
  get state(): TournamentVM { return this.t; }

  onEvent(ev: ArenaEvent): void {
    applyTournamentEvent(this.t, ev as never);
    if (ev.type === 'reset' || ev.type === 'round_start' || ev.type === 'wave_start') { if (this.isOpen) this.close(); return; }
    if (ev.type === 'tournament_end') this.paint();
  }

  protected override onClose(): void { this.anim.stop = true; }

  /** A page that loads after the end shows the final screen again. */
  adopt(t: TournamentVM): void {
    this.t = { ...t, results: [...t.results] };
    if (t.phase === 'ended') this.paint();
  }

  /** Re-open the final screen (from the header pill after it was closed). */
  reopen(): void { if (this.t.phase === 'ended') this.paint(); }

  private title(lane: number): string { return this.host.laneTitle(lane) || `Lane ${lane}`; }

  private paint(): void {
    this.anim = { stop: false };
    const reduced = this.host.reducedMotion();
    const dlg = el('section', 'tv-card tv-final');
    const order = podiumOf(this.t);
    const champ = order[0] ?? null;
    const head = el('div', 'tv-head');
    const h = el('h2', '', champ !== null ? `${this.title(champ)} is the champion` : 'The tournament is over'); h.id = 'tv-title';
    head.append(h, el('span', 'tv-sub', `${this.t.total || this.t.results.length} rounds. One lane left standing.`));
    dlg.append(head);

    const pod = el('div', `tv-podium${reduced ? ' still' : ''}`);
    pod.setAttribute('role', 'list');
    pod.setAttribute('aria-label', 'Podium');
    const spots: Array<{ place: 1 | 2 | 3; lane: number | undefined }> = [{ place: 2, lane: order[1] }, { place: 1, lane: order[0] }, { place: 3, lane: order[2] }];
    for (const s of spots) {
      if (s.lane === undefined) continue;
      const col = el('div', `tv-col tv-col--${s.place}`); col.setAttribute('role', 'listitem');
      const win = s.place === 1;
      const fig = el('div', 'tv-fig');
      if (win) fig.append(el('div', 'tv-crown', '\u{1F451}'));
      fig.append(skeletonCanvas(this.host.laneTier(s.lane), win ? 'cheer' : 'idle', win ? 104 : 80, reduced, this.anim));
      const block = el('div', 'tv-block');
      block.append(el('b', 'tv-place', String(s.place)), el('span', 'tv-who', this.title(s.lane)));
      const f = this.t.fallen[s.lane];
      block.append(el('span', 'tv-note', win ? 'CHAMPION' : f ? `fell in round ${f.round}` : ''));
      col.append(fig, block);
      pod.append(col);
    }
    dlg.append(pod);
    if (!reduced) {
      const conf = el('div', 'tv-confetti'); conf.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < 18; i++) { const c = el('i'); c.style.left = `${(i * 53) % 100}%`; c.style.animationDelay = `${(i % 7) * 0.35}s`; c.dataset.k = String(i % 4); conf.append(c); }
      dlg.append(conf);
    }

    const body = el('div', 'tv-body');
    for (const s of this.sections) { const x = s(this.t); if (x) body.append(x); }
    if (body.childElementCount > 0) dlg.append(body);

    const foot = el('div', 'tv-foot');
    const close = el('button', 'btn btn--ghost', 'Close'); close.type = 'button';
    close.addEventListener('click', () => this.close());
    const again = el('button', 'btn', 'New tournament'); again.type = 'button'; again.id = 'tv-again';
    again.addEventListener('click', () => { this.close(); this.host.startTournament(); });
    foot.append(close, again);
    dlg.append(foot);
    this.mount(dlg, again, 'tv-title');
  }
}

export type { Award };
