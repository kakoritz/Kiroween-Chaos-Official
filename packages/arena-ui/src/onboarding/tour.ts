/** Guided tour (ON-U3): six steps, a spotlight and a caption bubble. Pure step logic here, DOM in `Tour`. */

export interface Rect { x: number; y: number; w: number; h: number }

export type TourAction = 'legend' | 'chaos' | 'report';

export interface TourStep {
  id: string;
  title: string;
  text: string;
  /** CSS selector of the element to light up (first match wins), or null to use `rect`. */
  selector: string | null;
  /** Design-pixel rectangle (1920x1080 stage) used for canvas areas and as the fallback. */
  rect: Rect;
  /** Side effect fired when the step is shown. */
  action?: TourAction;
}

export const TOUR_STEPS: readonly TourStep[] = [
  { id: 'race', title: 'The race', text: 'Five bots process the same orders. Each has more protection.', selector: null, rect: { x: 0, y: 72, w: 1920, h: 768 } },
  { id: 'gear', title: 'The gear', text: 'These letters are their protections.', selector: null, rect: { x: 0, y: 72, w: 260, h: 768 }, action: 'legend' },
  { id: 'stages', title: 'The stages', text: 'Green passed, yellow in trouble, red failed. The flag counts problems.', selector: null, rect: { x: 260, y: 72, w: 1340, h: 40 } },
  { id: 'chaos', title: 'Chaos', text: 'Press a skull to throw a monster at a bot.', selector: '#chaos-mode', rect: { x: 300, y: 8, w: 520, h: 56 }, action: 'chaos' },
  { id: 'ledger', title: 'The ledger', text: "The provider's own record. This is the truth.", selector: '#ledger', rect: { x: 646, y: 840, w: 628, h: 200 } },
  { id: 'report', title: 'The report', text: 'After a wave, get a grade and fixes.', selector: '#report-btn', rect: { x: 1286, y: 840, w: 626, h: 200 }, action: 'report' },
];

export const TOUR_PAD = 8;

/** `?tour=1` starts the tour. Anything else, including `?tour=0`, does not. */
export function tourRequested(search: string): boolean {
  const v = (new URLSearchParams(search).get('tour') ?? '').toLowerCase();
  return v !== '' && !['0', 'off', 'false', 'no'].includes(v);
}

/** Next step index after a move, clamped; `null` means the tour is finished (Next on the last step). */
export function stepAfter(index: number, dir: 1 | -1, count: number = TOUR_STEPS.length): number | null {
  const n = index + dir;
  if (n >= count) return null;
  return Math.max(0, n);
}

export function nextLabel(index: number, count: number = TOUR_STEPS.length): string {
  return index >= count - 1 ? 'Done' : 'Next';
}

export function progressLabel(index: number, count: number = TOUR_STEPS.length): string {
  return `${index + 1} / ${count}`;
}

export function padRect(r: Rect, pad: number = TOUR_PAD, bounds: { w: number; h: number } = { w: 1920, h: 1080 }): Rect {
  const x = Math.max(0, r.x - pad);
  const y = Math.max(0, r.y - pad);
  return { x, y, w: Math.min(bounds.w, r.x + r.w + pad) - x, h: Math.min(bounds.h, r.y + r.h + pad) - y };
}

/** Where the bubble sits: below the spotlight when there is room, otherwise above. Always inside the stage. */
export function bubblePosition(r: Rect, bubble: { w: number; h: number } = { w: 560, h: 190 }, bounds: { w: number; h: number } = { w: 1920, h: 1080 }): { x: number; y: number } {
  const gap = 20;
  const below = r.y + r.h + gap;
  const y = below + bubble.h <= bounds.h - 70 ? below : Math.max(80, r.y - gap - bubble.h);
  const cx = r.x + r.w / 2 - bubble.w / 2;
  const x = Math.max(16, Math.min(bounds.w - bubble.w - 16, cx));
  return { x, y: Math.max(16, Math.min(bounds.h - bubble.h - 70, y)) };
}

export interface TourHandlers {
  onAction?: (action: TourAction, step: TourStep) => void;
  onEnd: (completed: boolean) => void;
}

export class Tour {
  private el: HTMLElement;
  private hole: HTMLElement;
  private bubble: HTMLElement;
  private index = 0;
  private done = false;
  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.end(false); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); this.move(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); this.move(-1); }
  };

  constructor(private stage: HTMLElement, private h: TourHandlers) {
    this.el = document.createElement('div');
    this.el.className = 'tour';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Guided tour');
    this.el.innerHTML = `
      <div class="tour__hole" id="tour-hole"></div>
      <div class="tour__bubble" id="tour-bubble">
        <div class="tour__step" id="tour-step"></div>
        <h2 class="tour__title" id="tour-title"></h2>
        <p class="tour__text" id="tour-text"></p>
        <div class="tour__btns">
          <button type="button" class="btn btn--ghost" id="tour-back">Back</button>
          <button type="button" class="btn" id="tour-next">Next</button>
          <button type="button" class="tour__skip" id="tour-end">End tour (Esc)</button>
        </div>
      </div>`;
    stage.appendChild(this.el);
    this.hole = this.el.querySelector('#tour-hole') as HTMLElement;
    this.bubble = this.el.querySelector('#tour-bubble') as HTMLElement;
    this.el.querySelector('#tour-back')!.addEventListener('click', () => this.move(-1));
    this.el.querySelector('#tour-next')!.addEventListener('click', () => this.move(1));
    this.el.querySelector('#tour-end')!.addEventListener('click', () => this.end(false));
    window.addEventListener('keydown', this.onKey, true);
    this.show(0);
  }

  private targetRect(step: TourStep): Rect {
    if (step.selector) {
      const t = this.stage.querySelector(step.selector) as HTMLElement | null;
      const sr = this.stage.getBoundingClientRect();
      const tr = t?.getBoundingClientRect();
      if (t && tr && tr.width > 0 && sr.width > 0 && !t.classList.contains('hidden')) {
        const k = 1920 / sr.width;
        return { x: (tr.left - sr.left) * k, y: (tr.top - sr.top) * k, w: tr.width * k, h: tr.height * k };
      }
    }
    return step.rect;
  }

  private show(i: number) {
    this.index = i;
    const step = TOUR_STEPS[i]!;
    const r = padRect(this.targetRect(step));
    this.hole.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`;
    const p = bubblePosition(r);
    this.bubble.style.left = `${p.x}px`;
    this.bubble.style.top = `${p.y}px`;
    (this.el.querySelector('#tour-step') as HTMLElement).textContent = `Step ${progressLabel(i)}`;
    (this.el.querySelector('#tour-title') as HTMLElement).textContent = step.title;
    (this.el.querySelector('#tour-text') as HTMLElement).textContent = step.text;
    (this.el.querySelector('#tour-next') as HTMLElement).textContent = nextLabel(i);
    (this.el.querySelector('#tour-back') as HTMLButtonElement).disabled = i === 0;
    if (step.action) this.h.onAction?.(step.action, step);
    (this.el.querySelector('#tour-next') as HTMLElement).focus();
  }

  private move(dir: 1 | -1) {
    if (this.done) return;
    const n = stepAfter(this.index, dir);
    if (n === null) this.end(true);
    else if (n !== this.index) this.show(n);
  }

  end(completed: boolean) {
    if (this.done) return;
    this.done = true;
    window.removeEventListener('keydown', this.onKey, true);
    this.el.remove();
    this.h.onEnd(completed);
  }
}
