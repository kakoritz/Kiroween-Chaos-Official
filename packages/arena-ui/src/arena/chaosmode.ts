// Chaos mode selector, frequency slider and seed (UI-B4, ui-spec sections 5 and 9).
// The pure helpers carry the logic and are unit tested; ChaosModeControl only mirrors them in DOM.
import type { ChaosModeOptions } from '../api/types';

export type ChaosMode = 'off' | 'manual' | 'random';
export const MODES: readonly { id: ChaosMode; label: string; icon: string }[] = [
  { id: 'off', label: 'Off', icon: '\u2205' },
  { id: 'manual', label: 'Manual', icon: '\u261D' },
  { id: 'random', label: 'Random', icon: '\u2684' },
];
export const FREQ_STEP = 0.05;
export const SEED_MAX = 2147483647;
export const SEND_DELAY_MS = 250;

/** Clamp to 0..1 and snap to the 0.05 step (NaN falls back to 0.3, the server default). */
export function snapFrequency(v: number): number {
  if (!Number.isFinite(v)) return 0.3;
  return Math.round(Math.min(1, Math.max(0, v)) * 20) / 20;
}

/** Words next to the slider so the number never stands alone. */
export function frequencyWord(f: number): string {
  if (f < 0.2) return 'Calm';
  if (f < 0.45) return 'Uneasy';
  if (f < 0.75) return 'Haunted';
  return 'Storm';
}

/** Integer seed from text, or null when empty or invalid. */
export function parseSeed(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,10}$/.test(t)) return null;
  const n = Number(t);
  return n <= SEED_MAX ? n : null;
}

export function randomSeed(rnd: () => number = Math.random): number {
  return Math.floor(rnd() * 1_000_000);
}

/** Body of POST /api/chaos/mode. Frequency and seed only travel with Random. */
export function modeRequest(mode: ChaosMode, frequency: number, seed: number | null): ChaosModeOptions {
  if (mode !== 'random') return { mode };
  return seed === null ? { mode, frequency: snapFrequency(frequency) } : { mode, frequency: snapFrequency(frequency), seed };
}

export interface ChaosModeState { mode: ChaosMode; frequency: number; seed: number }

export function readChaosState(s: { chaos?: { mode?: string; frequency?: number; seed?: number } | null }): ChaosModeState | null {
  const c = s.chaos;
  if (!c || (c.mode !== 'off' && c.mode !== 'manual' && c.mode !== 'random')) return null;
  return { mode: c.mode, frequency: snapFrequency(typeof c.frequency === 'number' ? c.frequency : 0.3), seed: typeof c.seed === 'number' ? c.seed : 0 };
}

export interface ChaosModeHost {
  setChaosMode(o: ChaosModeOptions): Promise<unknown>;
  onError(e: unknown): void;
}

/** DOM-free state and debounce logic. Mode changes post at once; slider and seed edits are debounced. */
export class ChaosModeModel {
  mode: ChaosMode = 'manual';
  frequency = 0.3;
  seed: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly host: ChaosModeHost, private readonly onChange: () => void, private readonly onFail: (msg: string) => void, rnd: () => number = Math.random) {
    this.seed = randomSeed(rnd);
  }
  adopt(s: ChaosModeState): void {
    this.mode = s.mode; this.frequency = s.frequency;
    if (s.mode === 'random') this.seed = s.seed;
    this.onChange();
  }
  choose(m: ChaosMode): void { this.mode = m; this.onChange(); this.send(); }
  setFrequency(v: number): void { this.frequency = snapFrequency(v); this.onChange(); this.schedule(); }
  /** Returns false when the text is not a valid seed. */
  setSeedText(text: string): boolean {
    const s = parseSeed(text);
    if (s === null) return false;
    this.seed = s; this.schedule();
    return true;
  }
  reroll(rnd: () => number = Math.random): void { this.seed = randomSeed(rnd); this.onChange(); this.schedule(); }
  private schedule(): void {
    if (this.mode !== 'random') return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.send(), SEND_DELAY_MS);
  }
  send(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.host.setChaosMode(modeRequest(this.mode, this.frequency, this.seed)).then(
      () => this.onFail(''),
      (e: unknown) => { this.onFail(e instanceof Error ? e.message : String(e)); this.host.onError(e); });
  }
}

export class ChaosModeControl {
  readonly model: ChaosModeModel;
  private readonly btns = new Map<ChaosMode, HTMLButtonElement>();
  private readonly pop: HTMLElement;
  private readonly slider: HTMLInputElement;
  private readonly word: HTMLElement;
  private readonly seedIn: HTMLInputElement;
  private readonly errEl: HTMLElement;

  constructor(root: HTMLElement, host: ChaosModeHost) {
    this.model = new ChaosModeModel(host, () => this.paint(), (m) => { this.errEl.textContent = m; });
    root.classList.add('cm');
    root.innerHTML = `
      <span class="cm-label" id="cm-label">Chaos</span>
      <div class="seg" role="radiogroup" aria-labelledby="cm-label">${MODES.map((m) =>
        `<button type="button" class="seg-b" role="radio" data-mode="${m.id}" aria-checked="false"><span aria-hidden="true">${m.icon}</span> ${m.label}</button>`).join('')}</div>
      <div class="cm-pop hidden" id="cm-pop" role="group" aria-label="Random chaos settings">
        <label class="cm-row" for="cm-freq"><span>Frequency</span><output id="cm-word" for="cm-freq"></output></label>
        <div class="cm-slide"><span class="cm-end">Calm</span>
          <input id="cm-freq" type="range" min="0" max="1" step="${FREQ_STEP}" aria-label="Chaos frequency, calm to storm">
          <span class="cm-end">Storm</span></div>
        <label class="cm-row" for="cm-seed"><span>Chaos seed</span></label>
        <div class="cm-seed"><input id="cm-seed" type="text" inputmode="numeric" maxlength="10" autocomplete="off" aria-label="Chaos seed">
          <button type="button" class="btn btn--ghost cm-dice" id="cm-dice" title="New random seed" aria-label="New random seed">\u2684</button></div>
        <div class="cm-err" id="cm-err" role="alert"></div>
      </div>`;
    for (const b of Array.from(root.querySelectorAll<HTMLButtonElement>('.seg-b'))) {
      this.btns.set(b.dataset.mode as ChaosMode, b);
      b.addEventListener('click', () => this.model.choose(b.dataset.mode as ChaosMode));
    }
    this.pop = root.querySelector('#cm-pop')!;
    this.slider = root.querySelector('#cm-freq')!;
    this.word = root.querySelector('#cm-word')!;
    this.seedIn = root.querySelector('#cm-seed')!;
    this.errEl = root.querySelector('#cm-err')!;
    this.slider.addEventListener('input', () => this.model.setFrequency(Number(this.slider.value)));
    this.seedIn.addEventListener('input', () => this.seedIn.setAttribute('aria-invalid', String(!this.model.setSeedText(this.seedIn.value))));
    root.querySelector('#cm-dice')!.addEventListener('click', () => this.model.reroll());
    this.paint();
  }

  adopt(s: ChaosModeState): void { this.model.adopt(s); }

  private paint(): void {
    const m = this.model;
    for (const [id, b] of this.btns) {
      b.setAttribute('aria-checked', String(id === m.mode));
      b.classList.toggle('seg-b--on', id === m.mode);
    }
    this.pop.classList.toggle('hidden', m.mode !== 'random');
    if (this.slider.value !== String(m.frequency)) this.slider.value = String(m.frequency);
    this.word.textContent = `${frequencyWord(m.frequency)} ${m.frequency.toFixed(2)}`;
    if (document.activeElement !== this.seedIn) { this.seedIn.value = String(m.seed); this.seedIn.removeAttribute('aria-invalid'); }
  }
}
