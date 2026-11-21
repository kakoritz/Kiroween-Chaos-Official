// Legend modal (PT-U9, ui.md section 9): what the gear letters R J I B Q mean, plus chip states.
import { STATE_LEGEND } from './keys';

export interface GearPart { letter: 'R' | 'J' | 'I' | 'B' | 'Q'; name: string; does: string; example: string; needs: string }
export const GEAR_PARTS: readonly GearPart[] = [
  { letter: 'R', name: 'Retry', does: 'tries again', example: 'A timeout hits step 3, so it runs step 3 again.', needs: 'a flaky step' },
  { letter: 'J', name: 'Journal', does: 'remembers progress', example: 'After a crash, finished steps are replayed, not redone.', needs: 'a crash' },
  { letter: 'I', name: 'Idempotency', does: 'never repeats a charge', example: 'A retried payment is recognised and charged once.', needs: 'a duplicate request' },
  { letter: 'B', name: 'Breaker', does: 'backs off, protects', example: 'A provider is failing, so calls pause instead of piling on.', needs: 'a failing provider' },
  { letter: 'Q', name: 'Queue', does: 'parks and resumes', example: 'A slow dependency parks the order, then it resumes later.', needs: 'a slow dependency' },
];

/** Tooltip for a gear letter: part name, what it does, and whether this tier has it. */
export function gearTip(p: GearPart, has: boolean): string {
  return `${p.letter} ${p.name}: ${p.does}. ${has ? 'This tier has it.' : `Add this part to survive ${p.needs}.`}`;
}

export function legendHtml(): string {
  return `<h2>Gear</h2><ul class="lgm-gear">${GEAR_PARTS.map((p) =>
    `<li title="${gearTip(p, true)}"><b class="lgm-l">${p.letter}</b> <b>${p.name}</b> (${p.does}). <span class="lgm-ex">${p.example}</span></li>`).join('')}</ul>
    <h2>Chips</h2><ul class="lg-list">${STATE_LEGEND.map((s) => `<li class="lg-i lg-${s.state}"><span aria-hidden="true">${s.icon}</span> ${s.word}</li>`).join('')}</ul>`;
}

export class LegendModal {
  private readonly el: HTMLElement;
  constructor(parent: HTMLElement, private readonly opener: HTMLButtonElement) {
    this.el = document.createElement('div');
    this.el.className = 'lgm hidden';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-label', 'Legend');
    this.el.innerHTML = `<div class="lgm-card"><button type="button" class="btn btn--ghost lgm-x" aria-label="Close legend">&times;</button>${legendHtml()}</div>`;
    parent.append(this.el);
    opener.addEventListener('click', () => this.toggle());
    this.el.addEventListener('click', (e) => { if (e.target === this.el || (e.target as HTMLElement).closest('.lgm-x')) this.toggle(false); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.isOpen()) this.toggle(false); });
  }
  isOpen(): boolean { return !this.el.classList.contains('hidden'); }
  toggle(force?: boolean): void {
    const open = force ?? !this.isOpen();
    this.el.classList.toggle('hidden', !open);
    this.opener.setAttribute('aria-expanded', String(open));
    if (open) this.el.querySelector<HTMLButtonElement>('.lgm-x')!.focus(); else this.opener.focus();
  }
}
