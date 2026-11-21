// Campaign hub and briefing (CP-U1): crypt map with seven tombstone doors, locks, medals and credits.
// Mounted on the `haunt:splash` window event (action 'campaign'). Starting a night is handled by the shop (CP-U2) through `onStart`.
import { doorSvg, lockSvg, medalSvg } from './art';
import { openSaveDialog } from './results';
import { buildDoors, loadProgress, moveFocus, type HubNight, type CampaignProgress } from './hub-model';

export interface HubHandlers { onStart?: (night: HubNight) => void; onClose?: () => void }
export interface HubApi { getCampaign(): Promise<{ nights: HubNight[] }> }

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

export class CampaignHub {
  private el: HTMLElement;
  private nights: HubNight[] = [];
  private progress: CampaignProgress;
  private focus = 0;
  private brief: HTMLElement | null = null;

  constructor(host: HTMLElement, api: HubApi, private handlers: HubHandlers = {}, private store?: Pick<Storage, 'getItem'>) {
    this.progress = loadProgress(store);
    this.el = document.createElement('div');
    this.el.className = 'cphub';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Campaign map');
    this.el.addEventListener('keydown', (e) => this.onKey(e));
    host.appendChild(this.el);
    this.el.innerHTML = '<p class="cphub__sub">Loading the crypt...</p>';
    void api.getCampaign().then((c) => { this.nights = c.nights ?? []; this.render(); }).catch(() => { this.el.innerHTML = '<p class="cphub__sub">The crypt is closed. Could not load the campaign.</p>'; });
  }

  refresh(): void { this.progress = loadProgress(this.store); this.render(); }

  close(): void { this.el.remove(); this.handlers.onClose?.(); }

  private render(): void {
    const doors = buildDoors(this.nights, this.progress);
    this.el.innerHTML = `
      <div class="cphub__top"><h1 class="cphub__title">The Crypt</h1>
        <span class="cphub__credits">Credits <b>${this.progress.credits}</b></span>
        <button class="btn btn--ghost cphub__close" type="button" data-act="sandbox">Sandbox</button>
        <button class="btn btn--ghost cphub__close" type="button" data-act="save">Save data</button>
        <button class="btn btn--ghost cphub__close" type="button" data-act="close">Close (Esc)</button></div>
      <p class="cphub__sub">Pick a tombstone door. Beat a night with a bronze medal to open the next one.</p>
      <div class="cphub__map" role="list">${doors.map((d, i) => `
        <button class="cpdoor cpdoor--${d.state}" type="button" role="listitem" data-i="${i}" tabindex="${i === this.focus ? 0 : -1}" aria-label="${esc(d.label)}" ${d.locked ? 'aria-disabled="true"' : ''}>
          <span class="cpdoor__art">${doorSvg(d.state, d.id, d.finale)}</span>
          <span class="cpdoor__n">${d.finale ? 'Finale' : `Night ${d.id}`}</span>
          <span class="cpdoor__t">${esc(d.title)}</span>
          ${d.locked ? `<span class="cpdoor__lock" aria-hidden="true">${lockSvg(36)}</span>` : `<span class="cpdoor__medal cpdoor__medal--${d.medal ?? 'none'}" aria-hidden="true">${medalSvg(d.medal, 40)}</span>`}
          ${d.best ? `<span class="cpdoor__best">Best ${d.best}</span>` : ''}
        </button>`).join('')}</div>`;
    this.el.querySelector('[data-act=close]')!.addEventListener('click', () => this.close());
    this.el.querySelector('[data-act=sandbox]')!.addEventListener('click', () => window.dispatchEvent(new CustomEvent('haunt:sandbox')));
    this.el.querySelector('[data-act=save]')!.addEventListener('click', () => openSaveDialog(this.el, window.localStorage, () => this.refresh()));
    this.el.querySelectorAll<HTMLButtonElement>('.cpdoor').forEach((b) => b.addEventListener('click', () => this.open(Number(b.dataset.i))));
    (this.el.querySelector(`.cpdoor[data-i="${this.focus}"]`) as HTMLElement | null)?.focus();
  }

  private open(i: number): void {
    const n = this.nights[i];
    const door = buildDoors(this.nights, this.progress)[i];
    if (!n || door.locked) { this.focus = i; return; }
    this.brief?.remove();
    const b = document.createElement('div');
    b.className = 'cpbrief';
    b.innerHTML = `<div class="cpbrief__card" role="dialog" aria-label="Night ${n.id} briefing">
      <h2>${n.finale ? 'Finale' : `Night ${n.id}`}: ${esc(n.title)}</h2>
      <p>${esc(n.briefing)}</p>
      <ol class="cpbrief__lesson">${n.lesson.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>
      <div class="cpbrief__hint"><b>Hint:</b> ${esc(n.hint)}</div>
      <div class="cpbrief__medals">Medals at ${n.medals.bronze.credits} / ${n.medals.silver.credits} / ${n.medals.gold.credits} credits (bronze, silver, gold). ${n.orders} orders.</div>
      <div class="cpbrief__btns"><button class="btn" type="button" data-act="go">Choose gear and start</button><button class="btn btn--ghost" type="button" data-act="back">Back (Esc)</button></div></div>`;
    b.querySelector('[data-act=back]')!.addEventListener('click', () => this.closeBrief());
    b.querySelector('[data-act=go]')!.addEventListener('click', () => { this.handlers.onStart?.(n); this.closeBrief(); });
    this.el.appendChild(b);
    this.brief = b;
    (b.querySelector('[data-act=go]') as HTMLElement).focus();
  }

  private closeBrief(): void { this.brief?.remove(); this.brief = null; (this.el.querySelector(`.cpdoor[data-i="${this.focus}"]`) as HTMLElement | null)?.focus(); }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.stopPropagation(); if (this.brief) this.closeBrief(); else this.close(); return; }
    if (this.brief) return;
    const next = moveFocus(this.focus, e.key, this.nights.length);
    if (next !== this.focus) { e.preventDefault(); this.focus = next; this.render(); }
  }
}

/** Mounts the hub when the splash "Play the Campaign" button fires `haunt:splash`. */
export function mountCampaignHub(stage: HTMLElement, api: HubApi, handlers: HubHandlers = {}): void {
  let hub: CampaignHub | null = null;
  window.addEventListener('haunt:splash', (e) => {
    if ((e as CustomEvent).detail?.action !== 'campaign' || hub) return;
    hub = new CampaignHub(stage, api, { ...handlers, onClose: () => { hub = null; handlers.onClose?.(); } }, window.localStorage);
  });
}
