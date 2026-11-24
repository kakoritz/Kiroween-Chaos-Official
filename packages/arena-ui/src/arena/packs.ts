// PK-U1: scenario packs in the app switcher. Labels, creature names and the review name come from the pack, not from code.
// Packs come from the server (`getPacks`, a Core endpoint) when it has one, otherwise from the bundled pack data, so the switcher
// works offline, in the hosted demo and against a server that predates the endpoint.
import { EMBEDDED_PACKS } from '../../../haunt/src/packs/embedded';
import { parsePack } from '../../../haunt/src/packs/pack';

export interface PackCreature { name: string; stage: string }
export interface PackChoice {
  id: string;
  title: string;
  /** Results come from rules over declared protections, not real code. Shown as a "model-based" tag. */
  modelBased: boolean;
  stageLabels: string[];
  creatures: PackCreature[];
  reviewLabel: string;
  /** App id that runs this pack for real, when the server has one (ticketing runs on the inbox app). */
  appId: string | null;
}

export const MODEL_TAG = 'model-based';
export const PREVIEW_TAG = 'preview';
/** Packs that also have a real runnable app. */
export const PACK_APP: Readonly<Record<string, string>> = { ticketing: 'inbox' };

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Normalise a packs list: the shape of GET /api/packs (when it exists) or the parsed pack data. Junk entries are dropped. */
export function packChoices(raw: unknown): PackChoice[] {
  if (!Array.isArray(raw)) return [];
  const out: PackChoice[] = [];
  const seen = new Set<string>();
  for (const e of raw) {
    const p = obj(e);
    const id = str(p.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const stages = Array.isArray(p.stages) ? p.stages : [];
    const faults = Array.isArray(p.faults) ? p.faults : [];
    const seenNames = new Set<string>();
    const creatures: PackCreature[] = [];
    for (const f of faults) {
      const fo = obj(f);
      const name = str(fo.creature);
      if (!name || seenNames.has(name)) continue;
      seenNames.add(name);
      creatures.push({ name, stage: str(fo.stage) });
    }
    out.push({
      id, title: str(p.title) || id, modelBased: p.modelBased !== false,
      stageLabels: stages.map((s) => (typeof s === 'string' ? s : str(obj(s).label) || str(obj(s).id))).filter(Boolean),
      creatures, reviewLabel: str(obj(p.reviews).label), appId: PACK_APP[id] ?? null,
    });
  }
  return out;
}

/** The packs shipped inside the bundle. A pack that fails to parse is skipped. */
export function bundledPackChoices(): PackChoice[] {
  const parsed: unknown[] = [];
  for (const text of Object.values(EMBEDDED_PACKS)) {
    const r = parsePack(text);
    if (r.ok) parsed.push(r.pack);
  }
  return packChoices(parsed);
}

/** Server list first; the bundled data when the endpoint is missing, fails or returns nothing. */
export async function loadPackChoices(getPacks?: () => Promise<unknown>): Promise<PackChoice[]> {
  if (getPacks) {
    try {
      const fromServer = packChoices(await getPacks());
      if (fromServer.length) return fromServer;
    } catch { /* no endpoint on this server: use the bundled packs */ }
  }
  return bundledPackChoices();
}

export const packTitle = (c: PackChoice): string => c.title;

/** Tooltip: the words the arena will use for this pack. */
export function packTip(c: PackChoice): string {
  const lines = [`${c.title}${c.modelBased ? ` (${MODEL_TAG})` : ''}`];
  if (c.stageLabels.length) lines.push(`Stages: ${c.stageLabels.join(', ')}`);
  if (c.creatures.length) lines.push(`Creatures: ${c.creatures.map((x) => x.name).join(', ')}`);
  if (c.reviewLabel) lines.push(`Reviews: ${c.reviewLabel}`);
  return lines.join('\n');
}

export interface PackHost {
  getPacks?(): Promise<unknown>;
  /** Server-side pack selection, when the server supports it. */
  setPack?(id: string): Promise<unknown>;
  getApps(): Promise<unknown>;
  setApp(app: string): Promise<unknown>;
  stopRunning(): Promise<void>;
  reload(): Promise<void>;
  /** Called with the chosen pack (or null for the default apps) so the page can show its labels when nothing server-side changed. */
  onPick?(pack: PackChoice | null): void;
  onError(e: unknown): void;
}

export class PackSwitcher {
  private choices: PackChoice[] = [];
  private apps = new Set<string>();
  private active: string | null = null;
  private busy = false;
  private readonly btns = new Map<string, HTMLButtonElement>();
  private readonly info: HTMLElement;

  constructor(private readonly root: HTMLElement, private readonly host: PackHost) {
    root.classList.add('pk', 'hidden');
    root.innerHTML = '<span class="as-label sr-only" id="pk-label">Pack</span><div class="seg" role="radiogroup" aria-labelledby="pk-label"></div>';
    this.info = document.createElement('span');
    this.info.className = 'pk-info';
    this.info.setAttribute('aria-live', 'polite');
    root.appendChild(this.info);
  }

  async load(): Promise<void> {
    this.choices = await loadPackChoices(this.host.getPacks);
    try { this.apps = new Set(((await this.host.getApps()) as { id?: string }[]).map((a) => String(a?.id))); } catch { this.apps = new Set(); }
    this.paint();
  }

  private switchable(c: PackChoice): boolean { return !!(this.host.setPack || (c.appId && this.apps.has(c.appId))); }

  get current(): PackChoice | null { return this.choices.find((c) => c.id === this.active) ?? null; }

  async choose(id: string | null): Promise<void> {
    if (this.busy || id === this.active) return;
    const pack = id === null ? null : this.choices.find((c) => c.id === id) ?? null;
    if (id !== null && !pack) return;
    this.busy = true; this.paint();
    try {
      if (pack && this.switchable(pack)) {
        await this.host.stopRunning();
        if (this.host.setPack) await this.host.setPack(pack.id);
        else await this.host.setApp(pack.appId!);
        await this.host.reload();
      }
      this.active = pack ? pack.id : null;
      this.host.onPick?.(pack);
    } catch (e) { this.host.onError(e); }
    this.busy = false;
    this.paint();
  }

  private paint(): void {
    this.root.classList.toggle('hidden', this.choices.length === 0);
    const seg = this.root.querySelector('.seg')!;
    if (this.btns.size !== this.choices.length + 1) {
      seg.innerHTML = '';
      this.btns.clear();
      const add = (key: string, label: string, tip: string, onClick: () => void): void => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'seg-b'; b.setAttribute('role', 'radio'); b.dataset.pack = key;
        b.textContent = label; b.title = tip;
        b.addEventListener('click', onClick);
        seg.appendChild(b); this.btns.set(key, b);
      };
      add('', 'Default', 'The built-in apps', () => { void this.choose(null); });
      for (const c of this.choices) add(c.id, packTitle(c).replace(/^haunted\s+/i, ''), packTip(c), () => { void this.choose(c.id); });
    }
    for (const [key, b] of this.btns) {
      const on = (key || null) === this.active;
      b.setAttribute('aria-checked', String(on));
      b.classList.toggle('seg-b--on', on);
      b.disabled = this.busy;
    }
    const cur = this.current;
    this.info.textContent = cur ? `${this.switchable(cur) ? '' : `${PREVIEW_TAG} · `}${cur.title}${cur.modelBased ? ` · ${MODEL_TAG}` : ''}${cur.reviewLabel ? ` · ${cur.reviewLabel}` : ''}` : '';
    this.info.title = cur ? `${this.switchable(cur) ? '' : 'Preview only: the lanes keep the Orders stages until this pack has a runnable app.\n'}${packTip(cur)}` : '';
    this.info.classList.toggle('pk-info--model', !!cur?.modelBased);
  }
}
