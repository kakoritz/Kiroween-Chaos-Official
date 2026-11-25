// PT-U11: the wrong-order decision popup (ui.md section 10). A pure model (pending decisions, countdown, keys, result captions)
// and a small DOM view. The popup sits over the lane that asked; the other lanes keep running. No clock of its own in the model.

export type Choice = 'refund' | 'discount' | 'redo';
export const CHOICES: readonly Choice[] = ['refund', 'discount', 'redo'];

export interface DecisionCard {
  choice: Choice;
  /** Keyboard key. */
  key: '1' | '2' | '3';
  title: string;
  /** What it costs in credits. */
  cost: string;
  /** What happens to the order and the review. */
  effect: string;
  tone: 'red' | 'amber' | 'green';
}

/** The three cards (ui.md section 10): consequences are in the scoring table (design.md section 5). */
export const DECISION_CARDS: readonly DecisionCard[] = [
  { choice: 'refund', key: '1', title: 'Refund', cost: '-150 credits', effect: 'Order cancelled. The customer leaves 1 star.', tone: 'red' },
  { choice: 'discount', key: '2', title: 'Discount', cost: '-60 credits', effect: 'Order goes on. Stars cap at 3.', tone: 'amber' },
  { choice: 'redo', key: '3', title: 'Redo', cost: 'No credit loss', effect: 'Costs time: the order restarts. Stars cap at 4.', tone: 'green' },
];

export const cardOfChoice = (c: Choice): DecisionCard => DECISION_CARDS.find((x) => x.choice === c)!;

/** Keys 1, 2 and 3 pick a choice; anything else is null. */
export function choiceForKey(key: string): Choice | null {
  return DECISION_CARDS.find((c) => c.key === key)?.choice ?? null;
}

const isChoice = (v: unknown): v is Choice => v === 'refund' || v === 'discount' || v === 'redo';

const STAGE_WORD: Record<string, string> = { confirmation: 'Confirmation', process: 'Process', transit: 'Transit', handoff: 'Handoff' };
/** "WRONG ORDER at Confirmation" for the title. */
export const decisionTitle = (detectedAt: string, label?: (stage: string) => string): string => {
  const w = label ? label(detectedAt) : STAGE_WORD[detectedAt] ?? detectedAt;
  return `WRONG ORDER at ${w}`;
};

export interface PendingDecision {
  lane: number;
  order: string;
  detectedAt: string;
  defaultChoice: Choice;
  /** Real ms the player has to answer. */
  timeoutMs: number;
  /** When the popup opened (caller's clock). */
  shownAt: number;
}

export interface DecisionResult {
  lane: number;
  order: string;
  choice: Choice;
  source: 'user' | 'timeout' | 'default';
  at: number;
}

/** Fixtures and headless runs answer at once (source "default"): the popup still shows this long before the result plays. */
export const MIN_SHOW_MS = 1500;
/** How long the result animation plays before the popup goes. */
export const RESULT_MS = 1800;

export interface CountdownFrame { leftMs: number; frac: number; seconds: number }

export function countdown(p: Pick<PendingDecision, 'shownAt' | 'timeoutMs'>, now: number): CountdownFrame {
  const total = Math.max(1, p.timeoutMs);
  const left = Math.max(0, total - Math.max(0, now - p.shownAt));
  return { leftMs: left, frac: left / total, seconds: Math.ceil(left / 1000) };
}

/** "If you wait: Discount". */
export const waitLine = (c: Choice): string => `If you wait: ${cardOfChoice(c).title}`;

/** The caption played after `decision_made`. */
export function resultCaption(c: Choice, source: DecisionResult['source']): string {
  const by = source === 'user' ? 'You chose' : source === 'timeout' ? 'Time ran out, default' : 'Default';
  switch (c) {
    case 'refund': return `${by}: REFUNDED. The coins go back, the scroll burns.`;
    case 'discount': return `${by}: DISCOUNT. The order goes on with a price tag.`;
    case 'redo': return `${by}: REDO. The scroll rewinds and the courier runs back.`;
  }
}

/** Pending decisions per lane, fed by events. Pure. */
export class DecisionTracker {
  private readonly pending = new Map<number, PendingDecision>();

  /** Returns what changed for the view: an opened decision, a made one, or nothing. */
  onEvent(ev: { type: string; lane?: unknown; detail?: unknown }, now: number): { opened?: PendingDecision; made?: DecisionResult; cleared?: number } {
    const d = (ev.detail && typeof ev.detail === 'object' ? ev.detail : {}) as Record<string, unknown>;
    const lane = typeof ev.lane === 'number' ? ev.lane : -1;
    switch (ev.type) {
      case 'decision_needed': {
        if (lane < 0) return {};
        const p: PendingDecision = {
          lane, order: typeof d.order === 'string' ? d.order : '', detectedAt: typeof d.detectedAt === 'string' ? d.detectedAt : '',
          defaultChoice: isChoice(d.defaultChoice) ? d.defaultChoice : 'refund', timeoutMs: typeof d.timeoutMs === 'number' && d.timeoutMs > 0 ? d.timeoutMs : 6000, shownAt: now,
        };
        this.pending.set(lane, p);
        return { opened: p };
      }
      case 'decision_made': {
        const p = this.pending.get(lane);
        if (!p || !isChoice(d.choice)) return {};
        this.pending.delete(lane);
        const source = d.source === 'user' || d.source === 'timeout' ? d.source : 'default';
        return { made: { lane, order: p.order, choice: d.choice, source, at: now } };
      }
      case 'order_done': case 'order_failed': case 'order_parked': case 'order_quarantined': case 'lane_halted': {
        if (this.pending.delete(lane)) return { cleared: lane };
        return {};
      }
      case 'wave_end': case 'reset': case 'wave_start': {
        const had = this.pending.size > 0;
        this.pending.clear();
        return had ? { cleared: -1 } : {};
      }
      default: return {};
    }
  }

  get(lane: number): PendingDecision | undefined { return this.pending.get(lane); }

  /** The decision a key press answers: the one that runs out first. */
  next(): PendingDecision | undefined {
    let best: PendingDecision | undefined;
    for (const p of this.pending.values()) if (!best || p.shownAt + p.timeoutMs < best.shownAt + best.timeoutMs) best = p;
    return best;
  }

  get size(): number { return this.pending.size; }
}

interface Shown {
  el: HTMLElement;
  p: PendingDecision;
  ring: HTMLElement;
  secs: HTMLElement;
  buttons: HTMLButtonElement[];
  /** Set when the choice was sent: the buttons are locked. */
  locked: boolean;
}

/** The popups, at most one per lane, over the lane box. */
export class DecisionPopupView {
  private readonly shown = new Map<number, Shown>();
  private readonly tracker = new DecisionTracker();
  private timer: ReturnType<typeof setInterval> | null = null;
  /** `decision_made` events that arrived before the popup was up long enough. */
  private readonly later = new Map<number, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly host: HTMLElement,
    private readonly place: (lane: number) => { top: number; h: number } | null,
    private readonly send: (lane: number, order: string, choice: Choice) => Promise<unknown>,
    private readonly stageLabel: (id: string) => string = (s) => s,
    private readonly clock: () => number = () => performance.now(),
    private readonly minShowMs = MIN_SHOW_MS,
  ) {}

  onEvent(ev: { type: string; lane?: unknown; detail?: unknown }): void {
    const now = this.clock();
    const r = this.tracker.onEvent(ev, now);
    if (r.opened) this.open(r.opened);
    if (r.made) this.result(r.made);
    if (r.cleared !== undefined) { if (r.cleared < 0) this.closeAll(); else this.close(r.cleared); }
  }

  /** Keyboard: 1, 2 or 3 answers the decision that runs out first. Returns true when the key was used. */
  key(key: string): boolean {
    const c = choiceForKey(key);
    const p = this.tracker.next();
    if (!c || !p) return false;
    this.choose(p.lane, c);
    return true;
  }

  get open_(): boolean { return this.tracker.size > 0; }

  choose(lane: number, choice: Choice): void {
    const s = this.shown.get(lane);
    const p = this.tracker.get(lane);
    if (!p || (s && s.locked)) return;
    if (s) { s.locked = true; for (const b of s.buttons) b.disabled = true; s.el.classList.add('dp--sent'); s.el.dataset.choice = choice; }
    void this.send(lane, p.order, choice).catch(() => { if (s) { s.locked = false; for (const b of s.buttons) b.disabled = false; s.el.classList.remove('dp--sent'); } });
  }

  private open(p: PendingDecision): void {
    this.close(p.lane);
    const box = this.place(p.lane);
    const el = document.createElement('div');
    el.className = 'dp';
    el.setAttribute('role', 'alertdialog');
    el.setAttribute('aria-label', `${decisionTitle(p.detectedAt, this.stageLabel)}: choose refund, discount or redo`);
    el.style.top = `${box ? Math.max(0, box.top) : 80}px`;
    if (box) el.style.maxHeight = `${Math.max(96, box.h)}px`;
    const head = document.createElement('div'); head.className = 'dp-head';
    const ghost = document.createElement('span'); ghost.className = 'dp-ghost'; ghost.setAttribute('aria-hidden', 'true'); ghost.textContent = 'ಠ_ಠ';
    const title = document.createElement('b'); title.className = 'dp-title'; title.textContent = decisionTitle(p.detectedAt, this.stageLabel);
    const order = document.createElement('span'); order.className = 'dp-order'; order.textContent = `Lane ${p.lane} · ${p.order}`;
    const ring = document.createElement('div'); ring.className = 'dp-ring'; ring.setAttribute('aria-hidden', 'true');
    const secs = document.createElement('span'); secs.className = 'dp-secs'; ring.append(secs);
    const tw = document.createElement('div'); tw.className = 'dp-tw'; tw.append(title, order);
    const wait = document.createElement('div'); wait.className = 'dp-wait'; wait.textContent = `${waitLine(p.defaultChoice)} (${cardOfChoice(p.defaultChoice).cost.toLowerCase()})`;
    head.append(ghost, tw, wait, ring);
    const cards = document.createElement('div'); cards.className = 'dp-cards';
    const buttons: HTMLButtonElement[] = [];
    for (const c of DECISION_CARDS) {
      const b = document.createElement('button'); b.type = 'button'; b.className = `dp-card dp-card--${c.tone}${c.choice === p.defaultChoice ? ' dp-card--default' : ''}`;
      b.dataset.choice = c.choice;
      const k = document.createElement('kbd'); k.textContent = c.key;
      const t = document.createElement('b'); t.textContent = c.title;
      const cost = document.createElement('span'); cost.className = 'dp-cost'; cost.textContent = c.cost;
      const eff = document.createElement('span'); eff.className = 'dp-eff'; eff.textContent = c.effect;
      b.append(k, t, cost, eff);
      b.addEventListener('click', () => this.choose(p.lane, c.choice));
      buttons.push(b); cards.append(b);
    }
    el.append(head, cards);
    this.host.append(el);
    this.shown.set(p.lane, { el, p, ring, secs, buttons, locked: false });
    this.paint();
    this.timer ??= setInterval(() => this.paint(), 100);
  }

  private result(m: DecisionResult): void {
    const s = this.shown.get(m.lane);
    const run = (): void => {
      this.later.delete(m.lane);
      const cur = this.shown.get(m.lane);
      if (!cur) return;
      cur.locked = true; for (const b of cur.buttons) b.disabled = true;
      cur.el.className = `dp dp--result dp--${m.choice}`;
      cur.el.replaceChildren(...this.resultEls(m));
      setTimeout(() => this.close(m.lane, cur.el), RESULT_MS);
    };
    // A decision made by the server's default (fixtures, headless) comes at once: keep the popup up for a moment so it can be read.
    const wait = s && m.source === 'default' ? Math.max(0, this.minShowMs - (m.at - s.p.shownAt)) : 0;
    if (wait > 0) this.later.set(m.lane, setTimeout(run, wait)); else run();
  }

  private resultEls(m: DecisionResult): HTMLElement[] {
    const art = document.createElement('div'); art.className = 'dp-art'; art.setAttribute('aria-hidden', 'true');
    if (m.choice === 'refund') { for (let i = 0; i < 5; i++) { const c = document.createElement('i'); c.className = 'dp-coin'; c.style.animationDelay = `${i * 90}ms`; art.append(c); } const f = document.createElement('u'); f.className = 'dp-scroll dp-scroll--burn'; art.append(f); }
    else if (m.choice === 'discount') { const f = document.createElement('u'); f.className = 'dp-scroll'; const tag = document.createElement('i'); tag.className = 'dp-tag'; tag.textContent = '-60'; art.append(f, tag); }
    else { const f = document.createElement('u'); f.className = 'dp-scroll dp-scroll--rewind'; const a = document.createElement('i'); a.className = 'dp-rewind'; a.textContent = '↺'; art.append(f, a); }
    const cap = document.createElement('div'); cap.className = 'dp-cap'; cap.setAttribute('role', 'status'); cap.textContent = resultCaption(m.choice, m.source);
    return [art, cap];
  }

  private paint(): void {
    const now = this.clock();
    for (const s of this.shown.values()) {
      const f = countdown(s.p, now);
      s.ring.style.setProperty('--frac', String(f.frac));
      s.secs.textContent = `${f.seconds}`;
      s.ring.classList.toggle('dp-ring--low', f.leftMs < 1500);
    }
  }

  close(lane: number, only?: HTMLElement): void {
    const s = this.shown.get(lane);
    if (!s || (only && s.el !== only)) return;
    s.el.remove(); this.shown.delete(lane);
    const t = this.later.get(lane); if (t) { clearTimeout(t); this.later.delete(lane); }
    if (this.shown.size === 0 && this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  closeAll(): void { for (const lane of [...this.shown.keys()]) this.close(lane); }
}
