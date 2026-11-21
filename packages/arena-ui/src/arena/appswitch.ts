// UI-W3: app switcher. App ids, labels and stage names come from the server (/api/apps and
// /api/state); nothing about Haunted Orders or Haunted Inbox is hard-coded here.
import type { AppInfo, ArenaState } from '../api/types';

export interface AppChoice { id: string; label: string; stageLabels: string[] }

/** Normalise GET /api/apps. Stage entries may be objects or plain strings; unknown fields are ignored. */
export function appChoices(apps: unknown): AppChoice[] {
  if (!Array.isArray(apps)) return [];
  const out: AppChoice[] = [];
  for (const a of apps as AppInfo[]) {
    if (!a || typeof a.id !== 'string' || !a.id) continue;
    const stages = Array.isArray(a.stages) ? a.stages : [];
    out.push({
      id: a.id,
      label: typeof a.label === 'string' && a.label ? a.label : a.id,
      stageLabels: stages.map((s) => (typeof s === 'string' ? s : String((s as { label?: unknown; id?: unknown }).label ?? (s as { id?: unknown }).id ?? ''))),
    });
  }
  return out;
}

/** The app title shown on the switcher, e.g. "Haunted Orders". */
export const appTitle = (c: AppChoice): string => (/^haunted\b/i.test(c.label) ? c.label : `Haunted ${c.label}`);

export const currentApp = (s: Pick<ArenaState, 'app'> | null | undefined): string => (s && typeof s.app === 'string' ? s.app : '');

export interface SwitchHost {
  getApps(): Promise<unknown>;
  setApp(app: string): Promise<unknown>;
  /** Stop a running demo and wave first (the server refuses an app change mid-wave). */
  stopRunning(): Promise<void>;
  /** Reload /api/state after the change so stages and lanes follow the new app. */
  reload(): Promise<void>;
  onError(e: unknown): void;
}

export class AppSwitcher {
  private choices: AppChoice[] = [];
  private active = '';
  private busy = false;
  private readonly btns = new Map<string, HTMLButtonElement>();
  private readonly detail: HTMLElement;

  constructor(private readonly root: HTMLElement, private readonly host: SwitchHost) {
    root.classList.add('as');
    root.innerHTML = '<span class="as-label" id="as-label">App</span><div class="seg" role="radiogroup" aria-labelledby="as-label"></div>';
    this.detail = document.createElement('span');
    this.detail.className = 'sr-only';
    this.detail.setAttribute('aria-live', 'polite');
    root.appendChild(this.detail);
    root.classList.add('hidden');
  }

  async load(active: string): Promise<void> {
    try { this.choices = appChoices(await this.host.getApps()); } catch (e) { this.host.onError(e); }
    this.active = active;
    this.paint();
  }

  setActive(id: string): void { if (id !== this.active) { this.active = id; this.paint(); } }

  async choose(id: string): Promise<void> {
    if (this.busy || id === this.active || !this.choices.some((c) => c.id === id)) return;
    this.busy = true; this.paint();
    try {
      await this.host.stopRunning();
      await this.host.setApp(id);
      this.active = id;
      await this.host.reload();
    } catch (e) { this.host.onError(e); }
    this.busy = false;
    this.paint();
  }

  private paint(): void {
    this.root.classList.toggle('hidden', this.choices.length < 2);
    const seg = this.root.querySelector('.seg')!;
    if (this.btns.size !== this.choices.length) {
      seg.innerHTML = '';
      this.btns.clear();
      for (const c of this.choices) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'seg-b'; b.setAttribute('role', 'radio'); b.dataset.app = c.id;
        b.textContent = appTitle(c);
        b.title = c.stageLabels.length ? `Stages: ${c.stageLabels.join(', ')}` : appTitle(c);
        b.addEventListener('click', () => { void this.choose(c.id); });
        seg.appendChild(b); this.btns.set(c.id, b);
      }
    }
    for (const [id, b] of this.btns) {
      const on = id === this.active;
      b.setAttribute('aria-checked', String(on));
      b.classList.toggle('seg-b--on', on);
      b.disabled = this.busy;
    }
    const cur = this.choices.find((c) => c.id === this.active);
    this.detail.textContent = cur ? `${appTitle(cur)} selected` : '';
  }
}
