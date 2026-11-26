/** Title splash (ON-U1): logo, tagline, typed hook, four buttons. Pure decisions here, DOM in `Splash`. */

export const SPLASH_HOOK = 'Charged. Charged again.';
export const SPLASH_TAGLINE = 'Chaos engineering for AI agents.';
export const SPLASH_PROBLEM = 'Bots and AI agents crash halfway, then repeat the work: double charges, duplicate emails.';
export const SPLASH_AUTO_MS = 4000;
const TYPE_MS_PER_CHAR = 55;

export type SplashAction = 'demo' | 'campaign' | 'tour' | 'lab' | 'chain';

export interface SplashButton { action: SplashAction; label: string; hero: boolean }

export const SPLASH_BUTTONS: readonly SplashButton[] = [
  { action: 'demo', label: 'Watch the 60-second demo', hero: true },
  { action: 'campaign', label: 'Play the Campaign', hero: false },
  { action: 'tour', label: 'Take the tour', hero: false },
  { action: 'lab', label: 'Test your own workflow', hero: false },
  { action: 'chain', label: 'Build and test a chain', hero: false },
];

export interface SplashDecision {
  show: boolean;
  /** Dismiss on its own after this many ms (a named demo plays under the splash), or null to wait for a click. */
  autoDismissMs: number | null;
}

/** `?splash=0` skips. Capture and deep-link params (present, inspect, perfsink, tour, freeze) skip too. A named demo auto-dismisses. */
export function splashDecision(search: string): SplashDecision {
  const q = new URLSearchParams(search);
  const flag = (q.get('splash') ?? '').toLowerCase();
  if (flag === '0' || flag === 'off' || flag === 'false') return { show: false, autoDismissMs: null };
  for (const k of ['present', 'inspect', 'perfsink', 'tour', 'freeze']) {
    if (q.has(k) && q.get(k) !== '0') return { show: false, autoDismissMs: null };
  }
  const demo = (q.get('demo') ?? '').toLowerCase();
  const named = demo !== '' && !['off', 'none', '0'].includes(demo);
  return { show: true, autoDismissMs: named ? SPLASH_AUTO_MS : null };
}

/** The typed hook after `elapsedMs`; reduced motion shows the whole line at once. */
export function typedHook(elapsedMs: number, reduced: boolean, text: string = SPLASH_HOOK): string {
  if (reduced) return text;
  const n = Math.max(0, Math.min(text.length, Math.floor(elapsedMs / TYPE_MS_PER_CHAR)));
  return text.slice(0, n);
}

/** Where a button goes. `demo` and `tour` stay in the arena; the others are links. */
export function splashTarget(action: SplashAction): string | null {
  if (action === 'lab') return './workflow-lab.html';
  if (action === 'chain') return './chain.html';
  return null;
}

export interface SplashHandlers {
  onAction: (action: SplashAction) => void;
  onDismiss: () => void;
}

export class Splash {
  private el: HTMLElement;
  private hookEl: HTMLElement;
  private timers: number[] = [];
  private done = false;
  private onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') this.dismiss(); };

  constructor(parent: HTMLElement, private h: SplashHandlers, private opts: { reduced: boolean; autoDismissMs: number | null }) {
    this.el = document.createElement('section');
    this.el.className = 'splash';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Kiroween Chaos title');
    this.el.innerHTML = `
      <div class="splash__box">
        <h1 class="splash__logo">KIROWEEN CHAOS</h1>
        <p class="splash__tag">${SPLASH_TAGLINE}</p>
        <p class="splash__hook" aria-label="${SPLASH_HOOK}"><span id="splash-hook"></span><span class="splash__caret" aria-hidden="true"></span></p>
        <p class="splash__problem">${SPLASH_PROBLEM}</p>
        <div class="splash__btns">${SPLASH_BUTTONS.map((b) =>
          `<button type="button" class="btn splash__btn${b.hero ? ' splash__btn--hero' : ''}" data-action="${b.action}">${b.label}</button>`).join('')}</div>
        <button type="button" class="splash__skip" id="splash-skip">Skip</button>
      </div>`;
    parent.appendChild(this.el);
    this.hookEl = this.el.querySelector('#splash-hook') as HTMLElement;
    this.el.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((b) => {
      b.addEventListener('click', () => { this.h.onAction(b.dataset.action as SplashAction); this.dismiss(); });
    });
    this.el.querySelector('#splash-skip')!.addEventListener('click', () => this.dismiss());
    window.addEventListener('keydown', this.onKey);
    this.typeIn();
    if (opts.autoDismissMs !== null) this.timers.push(window.setTimeout(() => this.dismiss(), opts.autoDismissMs));
    (this.el.querySelector('.splash__btn--hero') as HTMLElement).focus();
  }

  private typeIn() {
    const t0 = performance.now();
    this.hookEl.textContent = typedHook(0, this.opts.reduced);
    if (this.opts.reduced) return;
    const tick = () => {
      if (this.done) return;
      const text = typedHook(performance.now() - t0, false);
      this.hookEl.textContent = text;
      if (text.length < SPLASH_HOOK.length) this.timers.push(window.setTimeout(tick, TYPE_MS_PER_CHAR));
    };
    tick();
  }

  dismiss() {
    if (this.done) return;
    this.done = true;
    for (const t of this.timers) window.clearTimeout(t);
    window.removeEventListener('keydown', this.onKey);
    this.el.remove();
    this.h.onDismiss();
  }
}
