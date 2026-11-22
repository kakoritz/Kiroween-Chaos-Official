// Header gear menu (PT-U9, ui.md sections 9 and 12). Pure helpers carry the logic; GearMenu mirrors them in DOM.
export type Pace = 'normal' | 'show' | 'slow';
export const PACES: readonly { id: Pace; label: string }[] = [
  { id: 'normal', label: 'Normal' },
  { id: 'show', label: 'Show' },
  { id: 'slow', label: 'Slow' },
];
export const DEFAULT_PACE: Pace = 'slow';
export const SPEEDS: readonly (0.5 | 1 | 2 | 4)[] = [0.5, 1, 2, 4];
export const BADGE_TIP = 'MOCK = recorded replay. LIVE = real engine. BROWSER = runs in your tab.';

/** Tooltip for the mode badge: the live status line, then the three-mode key. */
export function badgeTitle(base: string): string {
  return base ? `${base} ${BADGE_TIP}` : BADGE_TIP;
}

/** The SLOW tag shows in the header while the slow pace is active. */
export function paceTag(p: Pace): string { return p === 'slow' ? 'SLOW' : ''; }

export interface CloseEvent { kind: 'select' | 'outside' | 'key'; key?: string; insideMenu: boolean; control?: 'radio' | 'button' | 'slider' | 'text' | 'other' }

/** Close after a radio or button selection, an outside click or Esc. Slider and seed edits keep it open. */
export function shouldClose(e: CloseEvent): boolean {
  if (e.kind === 'key') return e.key === 'Escape';
  if (e.kind === 'outside') return !e.insideMenu;
  return e.control === 'radio' || e.control === 'button';
}

export interface GearHost {
  setPace(p: Pace): void;
  setSpeed(s: number): void;
  toggleSound(): void;
  setReducedMotion(on: boolean): void;
  /** TV3-U8: start a five-lane tournament (POST /api/tournament/start). */
  startTournament?(): void;
  /** TV3-U9: clear every lane's lessons (DELETE /api/lessons). */
  resetLessons?(): void;
}

export class GearMenu {
  pace: Pace = DEFAULT_PACE;
  speed = 1;
  private readonly pop: HTMLElement;
  private readonly tag: HTMLElement;

  constructor(private readonly btn: HTMLButtonElement, slot: HTMLElement, tag: HTMLElement, private readonly host: GearHost, chaosEl: HTMLElement) {
    this.tag = tag;
    this.pop = document.createElement('div');
    this.pop.className = 'gear-pop hidden';
    this.pop.id = 'gear-pop';
    this.pop.setAttribute('role', 'dialog');
    this.pop.setAttribute('aria-label', 'Settings');
    this.pop.innerHTML = `
      <div class="gp-sec" id="gp-chaos"></div>
      <div class="gp-sec"><span class="gp-l" id="gp-pace-l">Pace</span><div class="seg" role="radiogroup" aria-labelledby="gp-pace-l">${PACES.map((p) =>
        `<button type="button" class="seg-b" role="radio" data-pace="${p.id}" aria-checked="false">${p.label}${p.id === DEFAULT_PACE ? ' (default)' : ''}</button>`).join('')}</div></div>
      <div class="gp-sec"><span class="gp-l" id="gp-speed-l">Speed</span><div class="seg" role="radiogroup" aria-labelledby="gp-speed-l">${SPEEDS.map((s) =>
        `<button type="button" class="seg-b" role="radio" data-speed="${s}" aria-checked="false">${s}x</button>`).join('')}</div></div>
      <div class="gp-sec"><span class="gp-l">Tournament</span><button type="button" class="btn btn--ghost" id="gp-tour" title="Five lanes race. The worst drops each round. The last one standing is the champion.">Start tournament</button> <button type="button" class="btn btn--ghost" id="gp-lessons" title="Forget what the lanes have learned">Reset lessons</button></div>
      <div class="gp-sec"><span class="gp-l">Sound</span><button type="button" class="btn btn--ghost" id="gp-sound">Toggle sound</button></div>
      <div class="gp-sec"><label class="gp-l"><input type="checkbox" id="gp-motion"> Reduced motion</label></div>`;
    slot.append(this.pop);
    this.pop.querySelector('#gp-chaos')!.append(chaosEl);
    this.btn.setAttribute('aria-expanded', 'false');
    this.btn.setAttribute('aria-controls', 'gear-pop');
    this.btn.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(); });
    this.pop.addEventListener('click', (e) => {
      e.stopPropagation();
      const t = e.target as HTMLElement;
      const b = t.closest('button') as HTMLButtonElement | null;
      if (!b) return;
      const control = b.getAttribute('role') === 'radio' ? 'radio' : 'button';
      if (b.dataset.pace) this.setPace(b.dataset.pace as Pace);
      else if (b.dataset.speed) { this.speed = Number(b.dataset.speed); this.host.setSpeed(this.speed); this.paint(); }
      else if (b.id === 'gp-sound') this.host.toggleSound();
      else if (b.id === 'gp-tour') this.host.startTournament?.();
      else if (b.id === 'gp-lessons') this.host.resetLessons?.();
      if (b.classList.contains('cm-dice')) return;
      if (shouldClose({ kind: 'select', insideMenu: true, control })) this.toggle(false);
    });
    this.pop.querySelector<HTMLInputElement>('#gp-motion')!.addEventListener('change', (e) => this.host.setReducedMotion((e.target as HTMLInputElement).checked));
    document.addEventListener('click', (e) => { if (shouldClose({ kind: 'outside', insideMenu: this.pop.contains(e.target as Node) })) this.toggle(false); });
    window.addEventListener('keydown', (e) => { if (!this.pop.classList.contains('hidden') && shouldClose({ kind: 'key', key: e.key, insideMenu: true })) { this.toggle(false); this.btn.focus(); } });
    this.paint();
  }

  setPace(p: Pace): void { this.pace = p; this.host.setPace(p); this.paint(); }
  isOpen(): boolean { return !this.pop.classList.contains('hidden'); }
  toggle(force?: boolean): void {
    const open = force ?? !this.isOpen();
    this.pop.classList.toggle('hidden', !open);
    this.btn.setAttribute('aria-expanded', String(open));
  }
  private paint(): void {
    for (const b of Array.from(this.pop.querySelectorAll<HTMLButtonElement>('[data-pace]'))) { const on = b.dataset.pace === this.pace; b.setAttribute('aria-checked', String(on)); b.classList.toggle('seg-b--on', on); }
    for (const b of Array.from(this.pop.querySelectorAll<HTMLButtonElement>('[data-speed]'))) { const on = Number(b.dataset.speed) === this.speed; b.setAttribute('aria-checked', String(on)); b.classList.toggle('seg-b--on', on); }
    this.tag.textContent = paceTag(this.pace);
    this.tag.classList.toggle('hidden', !paceTag(this.pace));
  }
}
