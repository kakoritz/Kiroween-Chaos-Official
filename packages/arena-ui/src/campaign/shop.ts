// Gear shop (CP-U2): a paper-doll skeleton with one slot per part. Owned gear drags (or keyboard-moves) onto a slot; unowned gear shows its price.
// Opened from the night briefing's "Choose gear and start" button through `gearShopStarter`.
import { gearIconSvg, shopBackdropSvg } from './art';
import { buy, equip, equipAll, equippedParts, loadShop, nextSlot, reset, saveShop, slotsFor, tooltip, unequip, type ShopGear, type ShopState } from './shop-model';

export interface ShopNight { id: number; title: string; finale?: boolean; hint?: string; gearHint?: string[] }
export interface ShopApi {
  getCampaign(): Promise<{ gear?: ShopGear[]; start?: { gear: string[]; credits: number } }>;
  startWave(opts: { campaign: { night: number; parts: string[] } }): Promise<unknown>;
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
/** Slot anchors on the doll (percent of the doll box), head to feet. */
const ANCHOR: Record<string, [number, number]> = { retry: [78, 42], journal: [22, 42], idempotency: [50, 30], breaker: [22, 62], offline_queue: [50, 80] };
const ANCHOR_FALLBACK: [number, number][] = [[78, 42], [22, 42], [50, 30], [22, 62], [50, 80]];

const DOLL = `<svg class="cpshop__doll" viewBox="0 0 200 300" aria-hidden="true" focusable="false">
  <g fill="#efe6d2" stroke="#14101f" stroke-width="4" stroke-linejoin="round" stroke-linecap="round">
    <ellipse cx="100" cy="42" rx="30" ry="32"/><rect x="82" y="68" width="36" height="14" rx="5"/>
    <path d="M70 90 Q100 80 130 90 L124 160 Q100 170 76 160 Z"/>
    <path d="M70 94 L40 150 L30 200 M130 94 L160 150 L170 200" fill="none" stroke-width="12"/>
    <path d="M70 94 L40 150 L30 200 M130 94 L160 150 L170 200" fill="none" stroke="#efe6d2" stroke-width="5"/>
    <rect x="76" y="164" width="48" height="20" rx="8"/>
    <path d="M86 184 L80 245 L66 280 M114 184 L120 245 L134 280" fill="none" stroke-width="13"/>
    <path d="M86 184 L80 245 L66 280 M114 184 L120 245 L134 280" fill="none" stroke="#efe6d2" stroke-width="6"/>
  </g>
  <g fill="#14101f"><circle cx="88" cy="40" r="6"/><circle cx="112" cy="40" r="6"/><path d="M96 54 L100 48 L104 54 Z"/></g>
</svg>`;

export class GearShop {
  private el: HTMLElement;
  private state: ShopState;
  private slots: string[];
  private grab: string | null = null;
  private slotIdx = 0;
  private msg = 'Buy gear, then drop it on its slot. Keyboard: Enter picks up, arrows choose a slot, Enter drops.';
  private starting = false;

  constructor(host: HTMLElement, private night: ShopNight, private gear: ShopGear[], start: { gear: string[]; credits: number },
    private api: Pick<ShopApi, 'startWave'>, private onDone: (started: boolean) => void, private store: Storage | undefined = window.localStorage) {
    this.state = loadShop(store, gear, start);
    this.slots = slotsFor(gear);
    this.el = document.createElement('div');
    this.el.className = 'cpshop';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Gear shop');
    this.el.addEventListener('keydown', (e) => this.onKey(e));
    host.appendChild(this.el);
    this.render('[data-gear]');
  }

  close(started = false): void { this.el.remove(); this.onDone(started); }

  private set(s: ShopState): void { this.state = s; saveShop(this.store, s); }

  private render(focus?: string): void {
    const s = this.state;
    const hint = this.night.gearHint ?? [];
    this.el.innerHTML = `
      <div class="cpshop__bg" aria-hidden="true">${shopBackdropSvg()}</div>
      <div class="cpshop__top"><h1 class="cpshop__title">Gear shop</h1>
        <span class="cpshop__night">${this.night.finale ? 'Finale' : `Night ${this.night.id}`}: ${esc(this.night.title)}</span>
        <span class="cpshop__credits">Credits <b>${s.credits}</b></span></div>
      <div class="cpshop__body">
        <ul class="cpshop__shelf" aria-label="Gear">${this.gear.map((g) => {
          const owned = s.owned.includes(g.id);
          const on = s.equipped[g.part] === g.id;
          const tip = tooltip(g, owned);
          return `<li><button type="button" class="cpgear${owned ? ' cpgear--owned' : ''}${on ? ' cpgear--on' : ''}${this.grab === g.id ? ' cpgear--held' : ''}${hint.includes(g.part) ? ' cpgear--hint' : ''}"
            data-gear="${g.id}" draggable="${owned}" title="${esc(tip)}" aria-label="${esc(tip)}${on ? ' Equipped.' : ''}${hint.includes(g.part) ? ' Suggested for this night.' : ''}">
            <span class="cpgear__badge" aria-hidden="true">${gearIconSvg(g, 44)}</span>
            <span class="cpgear__name">${esc(g.label)}</span>
            <span class="cpgear__price">${owned ? (on ? 'Equipped' : 'Owned') : `${g.cost} credits`}</span>
            <span class="cpgear__fx">${esc(g.effect)}</span></button></li>`;
        }).join('')}</ul>
        <div class="cpshop__dollbox">${DOLL}${this.gear.map((g, i) => {
          const [x, y] = ANCHOR[g.part] ?? ANCHOR_FALLBACK[i % 5];
          const cur = s.equipped[g.part] ? this.gear.find((x2) => x2.id === s.equipped[g.part]) : undefined;
          const label = `${g.label} slot, ${g.part}. ${cur ? `Holds ${cur.label}. Activate to take it off.` : 'Empty.'}`;
          return `<button type="button" class="cpslot${cur ? ' cpslot--full' : ''}${this.grab && this.gear.find((q) => q.id === this.grab)?.part === g.part ? ' cpslot--ok' : ''}" data-slot="${g.part}"
            style="left:${x}%;top:${y}%" aria-label="${esc(label)}" title="${esc(label)}">${cur ? gearIconSvg(cur, 48) : '+'}<span class="cpslot__name">${esc(g.part)}</span></button>`;
        }).join('')}</div>
        <aside class="cpshop__side"><h2>This night</h2><p>${esc(this.night.hint ?? 'Pick the gear that blocks tonight\'s faults.')}</p>
          <p class="cpshop__worn">Wearing: ${equippedParts(s, this.gear).join(', ') || 'nothing (the Rookie)'}</p></aside>
      </div>
      <p class="cpshop__msg" role="status" aria-live="polite">${esc(this.msg)}</p>
      <div class="cpshop__btns">
        <button class="btn" type="button" data-act="start">Start night</button>
        <button class="btn btn--ghost" type="button" data-act="all">Equip all owned</button>
        <button class="btn btn--ghost" type="button" data-act="reset">Reset</button>
        <button class="btn btn--ghost" type="button" data-act="back">Back (Esc)</button></div>`;
    this.wire();
    (this.el.querySelector(focus ?? '[data-act=start]') as HTMLElement | null)?.focus();
  }

  private say(m: string, focus?: string): void { this.msg = m; this.render(focus); }

  private gearClick(id: string): void {
    const g = this.gear.find((x) => x.id === id)!;
    if (!this.state.owned.includes(id)) {
      const r = buy(this.state, this.gear, id);
      if (r.ok) { this.set(r.state); this.say(`Bought the ${g.label} for ${g.cost} credits. Drop it on its slot.`, `[data-gear="${id}"]`); } else this.say(r.reason, `[data-gear="${id}"]`);
      return;
    }
    this.grab = this.grab === id ? null : id;
    this.slotIdx = Math.max(0, this.slots.indexOf(g.part));
    this.say(this.grab ? `Holding the ${g.label}. Use arrow keys to choose a slot, then Enter. Escape cancels.` : 'Put it back.', this.grab ? `[data-slot="${g.part}"]` : `[data-gear="${id}"]`);
  }

  private drop(id: string, slot: string): void {
    const r = equip(this.state, this.gear, id, slot);
    this.grab = null;
    if (r.ok) { this.set(r.state); this.say(`Equipped the ${this.gear.find((g) => g.id === id)!.label}.`, `[data-slot="${slot}"]`); } else this.say(r.reason, `[data-slot="${slot}"]`);
  }

  private slotClick(slot: string): void {
    if (this.grab) { this.drop(this.grab, slot); return; }
    if (this.state.equipped[slot]) { this.set(unequip(this.state, slot)); this.say('Took it off.', `[data-slot="${slot}"]`); } else this.say('Empty slot. Pick up owned gear first.', `[data-slot="${slot}"]`);
  }

  private wire(): void {
    const q = <T extends HTMLElement>(sel: string): NodeListOf<T> => this.el.querySelectorAll<T>(sel);
    q('[data-gear]').forEach((b) => {
      b.addEventListener('click', () => this.gearClick(b.dataset.gear!));
      b.addEventListener('dragstart', (e) => { e.dataTransfer?.setData('text/plain', b.dataset.gear!); this.grab = b.dataset.gear!; });
    });
    q('[data-slot]').forEach((b) => {
      b.addEventListener('click', () => this.slotClick(b.dataset.slot!));
      b.addEventListener('dragover', (e) => e.preventDefault());
      b.addEventListener('drop', (e) => { e.preventDefault(); const id = e.dataTransfer?.getData('text/plain') || this.grab; if (id) this.drop(id, b.dataset.slot!); });
    });
    this.el.querySelector('[data-act=all]')!.addEventListener('click', () => { this.set(equipAll(this.state, this.gear)); this.say('Equipped everything you own.', '[data-act=all]'); });
    this.el.querySelector('[data-act=reset]')!.addEventListener('click', () => { this.grab = null; this.set(reset(this.state)); this.say('Everything is off. Your gear is still yours.', '[data-act=reset]'); });
    this.el.querySelector('[data-act=back]')!.addEventListener('click', () => this.close(false));
    this.el.querySelector('[data-act=start]')!.addEventListener('click', () => void this.start());
  }

  private async start(): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    try {
      await this.api.startWave({ campaign: { night: this.night.id, parts: equippedParts(this.state, this.gear) } });
      this.close(true);
    } catch { this.starting = false; this.say('Could not start the night. Is the arena running?', '[data-act=start]'); }
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (this.grab) { this.grab = null; this.say('Put it back.', '[data-gear]'); } else this.close(false);
      return;
    }
    if (!this.grab) return;
    const next = nextSlot(this.slots, this.slotIdx, e.key);
    if (next !== this.slotIdx || ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      this.slotIdx = next;
      (this.el.querySelector(`[data-slot="${this.slots[next]}"]`) as HTMLElement | null)?.focus();
    }
  }
}

/** Returns the hub's `onStart` handler: opens the shop for the chosen night, then closes the hub once the night starts. */
export function gearShopStarter(stage: HTMLElement, api: ShopApi): (night: ShopNight) => void {
  let open = false;
  return (night) => {
    if (open) return;
    open = true;
    void api.getCampaign().then((c) => {
      const full = (c as { nights?: ShopNight[] }).nights?.find((n) => n.id === night.id) ?? night;
      new GearShop(stage, { ...full }, c.gear ?? [], c.start ?? { gear: [], credits: 0 }, api, (started) => {
        open = false;
        if (started) (document.querySelector('.cphub [data-act=close]') as HTMLElement | null)?.click();
      });
    }).catch(() => { open = false; });
  };
}
