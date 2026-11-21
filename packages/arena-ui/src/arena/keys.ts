// Keyboard control of Chaos and the color-blind safe state legend (UI-W7).
// Pure helpers: key mapping and legend data are unit tested; main.ts wires them to the DOM.
import type { ChaosMode } from './chaosmode';
import type { ChipState } from './model';

export type KeyAction =
  | { type: 'chaos'; lane?: number }
  | { type: 'mode'; mode: ChaosMode }
  | { type: 'cycle-mode' }
  | { type: 'help' };

export interface KeyLike {
  key: string;
  ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; repeat?: boolean;
  /** tagName of the focused element, upper case, when known. */
  targetTag?: string;
  /** True when the focused element is contenteditable. */
  editable?: boolean;
}

export const KEY_HELP: readonly { keys: string; does: string }[] = [
  { keys: '1-9', does: 'Chaos on that lane' },
  { keys: 'C', does: 'Chaos on a random lane' },
  { keys: 'M', does: 'Cycle Off, Manual, Random' },
  { keys: '?', does: 'Show these keys' },
];

const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** Map a key press to an action, or null. Typing in a field and modifier chords never trigger Chaos. */
export function keyAction(e: KeyLike, laneCount: number): KeyAction | null {
  if (e.ctrlKey || e.altKey || e.metaKey || e.repeat || e.editable) return null;
  if (e.targetTag && TYPING.has(e.targetTag.toUpperCase())) return null;
  if (/^[1-9]$/.test(e.key)) {
    const lane = Number(e.key) - 1;
    return lane < laneCount ? { type: 'chaos', lane } : null;
  }
  switch (e.key.toLowerCase()) {
    case 'c': return { type: 'chaos' };
    case 'm': return { type: 'cycle-mode' };
    case '?': return { type: 'help' };
    default: return null;
  }
}

const ORDER: readonly ChaosMode[] = ['off', 'manual', 'random'];
export function nextMode(m: ChaosMode): ChaosMode {
  return ORDER[(ORDER.indexOf(m) + 1) % ORDER.length]!;
}

/** Screen reader line for a triggered chaos. */
export function chaosAnnouncement(lane: number | undefined, creature?: string): string {
  const where = lane === undefined ? 'a random lane' : `lane ${lane + 1}`;
  return `Chaos sent to ${where}${creature ? `: ${creature}` : ''}`;
}

/** Each state has its own glyph and a word, so color is never the only signal. */
export const STATE_LEGEND: readonly { state: ChipState; icon: string; word: string }[] = [
  { state: 'pending', icon: '\u25CB', word: 'Pending' },
  { state: 'active', icon: '\u25B6', word: 'Active' },
  { state: 'done', icon: '\u2713', word: 'Done' },
  { state: 'replayed', icon: '\u21BA', word: 'Replayed' },
  { state: 'retrying', icon: '\u27F3', word: 'Retrying' },
  { state: 'failed', icon: '\u2717', word: 'Failed' },
  { state: 'dead', icon: '\u2620', word: 'Dead' },
  { state: 'parked', icon: '\u29D6', word: 'Parked' },
  { state: 'quarantined', icon: '\u2623', word: 'Quarantined' },
];

/** The legend as a plain list; the icons are distinct, so it also reads without color. */
export function renderLegend(host: HTMLElement): void {
  host.innerHTML = STATE_LEGEND.map((s) => `<li class="lg-i lg-${s.state}"><span aria-hidden="true">${s.icon}</span> ${s.word}</li>`).join('');
}
