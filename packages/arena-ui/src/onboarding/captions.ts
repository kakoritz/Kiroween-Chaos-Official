/** Captions and callouts (ON-U2). Pure timing and matching in `CaptionPlayer`; DOM in `CaptionOverlay`. Spec: onboarding spec.md section 4. */
import type { ArenaEvent, Caption } from '../api/types';
import { laneBoxes } from '../arena/scene';

export const FREEZE_MS = 2000;
export const CALLOUT_MS = 2500;
export const CC_KEY = 'haunt.cc';

export interface Callout {
  /** Fires on the first matching event, once per script start. */
  when: { event: string; lane?: number };
  text: string;
  /** 1-based lane the arrow points at. */
  lane: number;
  /** Name for `?freeze=<name>`. */
  freeze?: string;
}

/** The hero beat: the same crash, then the ledger result. Only the hero script has callouts. */
export const CALLOUTS: Record<string, Callout[]> = {
  hero: [
    { when: { event: 'recover_start', lane: 1 }, text: 'SAME CRASH', lane: 1, freeze: 'hero-crash' },
    { when: { event: 'order_done', lane: 1 }, text: 'Rookie: 2 charges', lane: 1 },
    { when: { event: 'order_done', lane: 5 }, text: 'Phoenix: 1 charge', lane: 5 },
  ],
};

type Fields = { event?: string; lane?: number; stage?: string; order?: string; attempt?: number };

/** True when every field the trigger names equals the event's. */
export function matches(at: Fields, ev: ArenaEvent): boolean {
  if (at.event === undefined || ev.type !== at.event) return false;
  if (at.lane !== undefined && ev.lane !== at.lane) return false;
  if (at.stage !== undefined && ev.stage !== at.stage) return false;
  if (at.order !== undefined && ev.order !== at.order) return false;
  if (at.attempt !== undefined && ev.attempt !== at.attempt) return false;
  return true;
}

/** `?freeze=<beat>` value, or null. */
export function freezeFromQuery(search: string): string | null {
  const v = new URLSearchParams(search).get('freeze');
  return v && /^[a-z0-9-]{1,32}$/i.test(v) ? v.toLowerCase() : null;
}

/** Captions on by default in demo mode, off in normal play; a saved CC choice wins. */
export function ccDefault(saved: string | null, demoRunning: boolean): boolean {
  if (saved === '1') return true;
  if (saved === '0') return false;
  return demoRunning;
}

export interface ActiveCallout { text: string; lane: number; until: number }

/** Never touches the event stream: it only reads events and the clock. */
export class CaptionPlayer {
  private track: Caption[] = [];
  private callouts: Callout[] = [];
  private fired = new Set<number>();
  private firedCallouts = new Set<number>();
  private t0 = 0;
  private line: { text: string; until: number } | null = null;
  private callout: ActiveCallout | null = null;
  private freezeUntil = 0;
  running = false;

  constructor(private freezeName: string | null = null) {}

  start(script: string, track: Caption[], now: number): void {
    this.track = track;
    this.callouts = CALLOUTS[script] ?? [];
    this.fired.clear(); this.firedCallouts.clear();
    this.t0 = now; this.line = null; this.callout = null; this.freezeUntil = 0;
    this.running = true;
  }

  stop(): void { this.running = false; this.line = null; this.callout = null; }

  private show(c: Caption, now: number) {
    // One line at a time: a newer caption replaces the old one.
    this.line = { text: c.text, until: now + c.ms };
  }

  event(ev: ArenaEvent, now: number): void {
    if (!this.running) return;
    this.track.forEach((c, i) => {
      if (this.fired.has(i) || c.at.event === undefined) return;
      if (matches(c.at as Fields, ev)) { this.fired.add(i); this.show(c, now); }
    });
    this.callouts.forEach((c, i) => {
      if (this.firedCallouts.has(i)) return;
      if (!matches(c.when, ev)) return;
      this.firedCallouts.add(i);
      this.callout = { text: c.text, lane: c.lane, until: now + CALLOUT_MS };
      if (c.freeze && this.freezeName === c.freeze) this.freezeUntil = now + FREEZE_MS;
    });
  }

  /** Advance the clock: fires time-offset captions and expires old lines. Returns the current line and callout. */
  tick(now: number): { caption: string | null; callout: ActiveCallout | null } {
    if (this.running) {
      this.track.forEach((c, i) => {
        if (!this.fired.has(i) && c.at.ms !== undefined && now - this.t0 >= c.at.ms) { this.fired.add(i); this.show(c, now); }
      });
    }
    if (this.line && now >= this.line.until) this.line = null;
    if (this.callout && now >= this.callout.until) this.callout = null;
    return { caption: this.line?.text ?? null, callout: this.callout };
  }

  /** True while the UI should hold its drawing (capture mode only). Events keep queueing. */
  frozen(now: number): boolean { return now < this.freezeUntil; }
}

export class CaptionOverlay {
  private strip: HTMLElement;
  private arrow: HTMLElement;
  private cc: HTMLButtonElement;
  private on: boolean;
  private lastLine: string | null = null;
  private lastCallout: ActiveCallout | null = null;

  constructor(parent: HTMLElement, private player: CaptionPlayer, opts: { demoRunning: boolean }) {
    let saved: string | null = null;
    try { saved = window.localStorage.getItem(CC_KEY); } catch { /* storage may be blocked */ }
    this.on = ccDefault(saved, opts.demoRunning);
    this.strip = document.createElement('div');
    this.strip.className = 'cap-strip';
    this.strip.setAttribute('role', 'status');
    this.strip.setAttribute('aria-live', 'polite');
    this.arrow = document.createElement('div');
    this.arrow.className = 'cap-callout hidden';
    this.arrow.setAttribute('aria-hidden', 'true');
    this.cc = document.createElement('button');
    this.cc.type = 'button';
    this.cc.className = 'btn btn--ghost cap-cc';
    this.cc.title = 'Captions on or off';
    this.cc.addEventListener('click', () => this.setOn(!this.on, true));
    parent.append(this.strip, this.arrow, this.cc);
    this.paintCc();
  }

  get enabled(): boolean { return this.on; }

  private paintCc() {
    this.cc.textContent = this.on ? 'CC on' : 'CC off';
    this.cc.setAttribute('aria-pressed', String(this.on));
    if (!this.on) { this.strip.textContent = ''; this.arrow.classList.add('hidden'); this.lastLine = null; this.lastCallout = null; }
  }

  setOn(v: boolean, persist: boolean) {
    this.on = v;
    if (persist) { try { window.localStorage.setItem(CC_KEY, v ? '1' : '0'); } catch { /* ignore */ } }
    this.paintCc();
  }

  /** Call once per animation frame. */
  update(now: number): void {
    if (!this.on) return;
    const { caption, callout } = this.player.tick(now);
    if (caption !== this.lastLine) { this.strip.textContent = caption ?? ''; this.lastLine = caption; }
    if (callout !== this.lastCallout) {
      this.lastCallout = callout;
      if (!callout) this.arrow.classList.add('hidden');
      else {
        const box = laneBoxes(5)[callout.lane - 1];
        this.arrow.textContent = `\u25C0 ${callout.text}`;
        this.arrow.style.top = `${(box ? box.top + box.h / 2 : 400) - 28}px`;
        this.arrow.classList.remove('hidden');
      }
    }
  }
}
