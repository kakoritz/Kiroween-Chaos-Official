// TV3-U6: the intensity dial (tournament-v3 spec section 5.1, contract V1_2 section 5).
// Pure helpers carry the logic and are unit tested; IntensityDial mirrors them in the header.
export const DIAL_MIN = 1;
export const DIAL_MAX = 10;
export const DIAL_OVERRIDE = 11;
export const DIAL_DEFAULT = 3;
export const SEND_DELAY_MS = 140;

export interface DialState { level: number; autoRamp: boolean; everyN: number; max: number; source: 'player' | 'ramp' | 'plan' | 'server' }

export const defaultDial = (): DialState => ({ level: DIAL_DEFAULT, autoRamp: false, everyN: 4, max: DIAL_OVERRIDE, source: 'server' });

/** Whole level 1..11; anything else falls back to the calm default. */
export function snapLevel(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return DIAL_DEFAULT;
  return Math.min(DIAL_OVERRIDE, Math.max(DIAL_MIN, Math.round(n)));
}

/** The per-level rows of the spec table: faults per order, simultaneous faults, unknown share, curses, longest random outage. */
const ROWS: readonly { rate: string; sim: number; unknown: number; curses: number; outage: number; word: string }[] = [
  { rate: '0.3', sim: 1, unknown: 0, curses: 0, outage: 5, word: 'Whisper' },
  { rate: '0.5', sim: 1, unknown: 0, curses: 0, outage: 8, word: 'Quiet' },
  { rate: '0.7', sim: 1, unknown: 5, curses: 0, outage: 10, word: 'Calm' },
  { rate: '0.9', sim: 1, unknown: 10, curses: 1, outage: 12, word: 'Uneasy' },
  { rate: '1.1', sim: 2, unknown: 15, curses: 1, outage: 15, word: 'Rough' },
  { rate: '1.4', sim: 2, unknown: 20, curses: 1, outage: 18, word: 'Rougher' },
  { rate: '1.7', sim: 2, unknown: 25, curses: 2, outage: 22, word: 'Brutal' },
  { rate: '2.0', sim: 3, unknown: 30, curses: 2, outage: 25, word: 'Savage' },
  { rate: '2.5', sim: 3, unknown: 35, curses: 2, outage: 28, word: 'Merciless' },
  { rate: '3.0', sim: 4, unknown: 40, curses: 3, outage: 30, word: 'Maximum' },
];

export const isOverride = (level: number): boolean => snapLevel(level) === DIAL_OVERRIDE;

/** Short word shown next to the number, so the number never stands alone. */
export function levelWord(level: number): string {
  const l = snapLevel(level);
  return l === DIAL_OVERRIDE ? 'THROW EVERYTHING' : ROWS[l - 1]!.word;
}

/** Spoken value for aria-valuetext. */
export function valueText(level: number, autoRamp = false): string {
  const l = snapLevel(level);
  const ramp = autoRamp ? ', auto-ramp on' : '';
  return l === DIAL_OVERRIDE ? `Level 11, override: throw everything${ramp}` : `Level ${l} of 10, ${levelWord(l).toLowerCase()}${ramp}`;
}

/** Tooltip: what this level does to the storm. */
export function levelTip(level: number): string {
  const l = snapLevel(level);
  if (l === DIAL_OVERRIDE) return 'Level 11 override: a fault at every stage of every order, all faults at once, half of them unknown, outages that overlap. A stress test, graded as survived or not.';
  const r = ROWS[l - 1]!;
  return `Level ${l} (${r.word.toLowerCase()}): about ${r.rate} faults per order, ${r.sim} at a time, ${r.unknown} percent unknown, ${r.curses} curse${r.curses === 1 ? '' : 's'} per lane, outages up to ${r.outage} s.`;
}

export const rampTip = (everyN: number, max: number): string =>
  `Auto-ramp: raise the dial by one every ${everyN} finished orders, up to ${max}, so the storm keeps growing.`;

/** Read `state.intensity` (also tolerates an older server that has none). */
export function readDial(s: { intensity?: Partial<DialState> | null }): DialState | null {
  const i = s.intensity;
  if (!i || typeof i.level !== 'number') return null;
  return {
    level: snapLevel(i.level), autoRamp: i.autoRamp === true,
    everyN: typeof i.everyN === 'number' && i.everyN > 0 ? Math.round(i.everyN) : 4,
    max: typeof i.max === 'number' ? snapLevel(i.max) : DIAL_OVERRIDE, source: 'server',
  };
}

/** Fold a global `intensity {level, source, autoRamp}` event into the dial. Returns false when the event is malformed. */
export function applyIntensity(d: DialState, detail: Record<string, unknown> | undefined): boolean {
  if (!detail || typeof detail.level !== 'number') return false;
  d.level = snapLevel(detail.level);
  if (typeof detail.autoRamp === 'boolean') d.autoRamp = detail.autoRamp;
  d.source = detail.source === 'ramp' || detail.source === 'plan' ? detail.source : 'player';
  return true;
}

export interface DialHost {
  setIntensity(level: number, opts?: { autoRamp?: boolean }): Promise<unknown>;
  onError(e: unknown): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Header knob: a 1 to 11 slider, a word for the level, an auto-ramp toggle. Keyboard: arrows, Home, End, PageUp, PageDown. */
export class IntensityDial {
  state: DialState = defaultDial();
  private readonly slider: HTMLInputElement;
  private readonly num: HTMLElement;
  private readonly word: HTMLElement;
  private readonly ramp: HTMLButtonElement;
  private readonly flash: HTMLElement;
  private timer: number | undefined;
  private dragging = false;

  constructor(private readonly root: HTMLElement, private readonly host: DialHost) {
    root.classList.add('dial');
    root.id ||= 'dial';
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Intensity dial');
    const top = el('div', 'dial-top');
    const lab = el('label', 'dial-l', 'INTENSITY'); lab.htmlFor = 'dial-range';
    this.num = el('b', 'dial-n'); this.word = el('span', 'dial-w');
    this.flash = el('span', 'dial-f'); this.flash.setAttribute('aria-hidden', 'true');
    top.append(lab, this.num, this.word, this.flash);
    this.slider = el('input', 'dial-range');
    this.slider.type = 'range'; this.slider.id = 'dial-range';
    this.slider.min = String(DIAL_MIN); this.slider.max = String(DIAL_OVERRIDE); this.slider.step = '1';
    const body = el('div', 'dial-body');
    this.ramp = el('button', 'dial-ramp', 'RAMP'); this.ramp.type = 'button'; this.ramp.id = 'dial-ramp';
    body.append(this.slider, this.ramp);
    root.append(top, body);
    this.slider.addEventListener('input', () => {
      this.state = { ...this.state, level: snapLevel(this.slider.value), source: 'player' };
      this.paint();
      this.schedule();
    });
    this.slider.addEventListener('pointerdown', () => { this.dragging = true; });
    window.addEventListener('pointerup', () => { this.dragging = false; });
    this.ramp.addEventListener('click', () => {
      this.state = { ...this.state, autoRamp: !this.state.autoRamp };
      this.paint();
      this.send();
    });
    this.paint();
  }

  /** The server's truth: state on load and `intensity` events. A drag or a pending send is not interrupted. */
  adopt(next: Partial<DialState>): void {
    if (this.dragging || this.timer !== undefined) return;
    const before = this.state.level;
    this.state = { ...this.state, ...next };
    this.paint();
    if (next.source === 'ramp' && next.level !== undefined && next.level !== before) this.pulse('ramp +' + Math.max(1, next.level - before));
  }

  private pulse(text: string): void {
    this.flash.textContent = text;
    this.flash.classList.remove('on'); void this.flash.offsetWidth; this.flash.classList.add('on');
  }

  private schedule(): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { this.timer = undefined; this.send(); }, SEND_DELAY_MS);
  }

  private send(): void {
    window.clearTimeout(this.timer); this.timer = undefined;
    const { level, autoRamp } = this.state;
    void this.host.setIntensity(level, { autoRamp }).catch((e) => this.host.onError(e));
  }

  private paint(): void {
    const { level, autoRamp, everyN, max } = this.state;
    const over = isOverride(level);
    this.slider.value = String(level);
    this.slider.setAttribute('aria-valuetext', valueText(level, autoRamp));
    this.slider.title = levelTip(level);
    this.num.textContent = String(level);
    this.word.textContent = levelWord(level);
    this.root.classList.toggle('dial--max', over);
    this.root.classList.toggle('dial--hot', level >= 7 && !over);
    this.slider.style.setProperty('--dial-fill', `${((level - DIAL_MIN) / (DIAL_OVERRIDE - DIAL_MIN)) * 100}%`);
    this.ramp.setAttribute('aria-pressed', String(autoRamp));
    this.ramp.title = rampTip(everyN, max);
    this.ramp.classList.toggle('on', autoRamp);
    document.body.classList.toggle('dial-max', over);
  }
}
