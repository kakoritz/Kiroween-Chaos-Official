// PT-U12 (ui.md section 14, ui-spec section 17): screen reader announcements for key state.
// `announcementFor` is pure; `Announcer` writes to two live regions and rate limits the polite one.
import type { ArenaEvent } from '../api/types';

export interface Announcement { text: string; assertive: boolean }
export interface AnnounceCtx { tier(lane: number): string; stageLabel(id: string): string }

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const fmtStars = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * What a screen reader hears for one event, or null. Order cancelled and boss recovered are announced by ScoreVisuals
 * (they carry the score delta), so they are not repeated here.
 */
export function announcementFor(ev: ArenaEvent, c: AnnounceCtx): Announcement | null {
  const d = (ev.detail ?? {}) as Record<string, unknown>;
  const lane = typeof ev.lane === 'number' ? ev.lane : null;
  const who = lane === null ? '' : `Lane ${lane}${c.tier(lane) ? `, ${c.tier(lane)}` : ''}`;
  const stage = ev.stage ? c.stageLabel(ev.stage) : '';
  switch (ev.type) {
    case 'review': {
      const s = num(d.stars);
      if (s === null || lane === null) return null;
      const t = str(d.text);
      return { text: `Lane ${lane} got ${fmtStars(s)} ${s === 1 ? 'star' : 'stars'}${t ? `: ${t}` : ''}`, assertive: false };
    }
    case 'decision_needed': {
      const at = str(d.detectedAt);
      return { text: `Decision needed${lane === null ? '' : ` on lane ${lane}`}: wrong order${at ? ` found at ${cap(at)}` : ''}. Choose refund, discount or redo.`, assertive: true };
    }
    case 'boss_warning': return { text: `Boss incoming${str(d.name) ? `: ${str(d.name)}` : ''}`, assertive: true };
    case 'stage_fail': return who ? { text: `${who}, ${stage || 'stage'} failed`, assertive: false } : null;
    case 'process_dead': return who ? { text: `${who}, crashed${stage ? ` at ${stage}` : ''}. Recovering.`, assertive: false } : null;
    case 'recover_done': return who ? { text: `${who}, recovered`, assertive: false } : null;
    case 'order_done': return who ? { text: `${who}, order ${str(ev.order)} delivered`.replace('  ', ' '), assertive: false } : null;
    case 'wave_end': return { text: 'Wave over', assertive: false };
    default: return null;
  }
}

export const POLITE_GAP_MS = 1000;
export const MAX_POLITE_QUEUE = 4;

/** Polite messages go out at most once per second (a short queue, oldest dropped); assertive ones go out at once. */
export class Announcer {
  private queue: string[] = [];
  private lastAt = -Infinity;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly polite: { textContent: string | null },
    private readonly assertive: { textContent: string | null },
    private readonly clock: () => number = () => performance.now(),
  ) {}

  say(a: Announcement): void {
    if (a.assertive) { this.assertive.textContent = a.text; return; }
    this.sayPolite(a.text);
  }

  sayPolite(text: string): void {
    this.queue.push(text);
    while (this.queue.length > MAX_POLITE_QUEUE) this.queue.shift();
    this.pump();
  }

  private pump(): void {
    if (this.timer !== null || this.queue.length === 0) return;
    const wait = Math.max(0, this.lastAt + POLITE_GAP_MS - this.clock());
    if (wait === 0) { this.flush(); return; }
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, wait);
  }

  private flush(): void {
    const next = this.queue.shift();
    if (next === undefined) return;
    this.lastAt = this.clock();
    // Clearing first makes a repeated identical message re-announce.
    this.polite.textContent = '';
    this.polite.textContent = next;
    this.pump();
  }
}

/** Canvas `aria-label`: who leads and which creatures are active (ui-spec section 17). */
export function arenaSummary(lanes: readonly { lane: number; tier: string; score: number; creatures?: readonly { id: string; leaving?: unknown }[] }[]): string {
  if (lanes.length === 0) return 'The haunted arena: no lanes yet';
  const lead = lanes.reduce((a, b) => (b.score > a.score ? b : a));
  const active = lanes.flatMap((l) => (l.creatures ?? []).map((c) => c.id));
  const chaos = active.length === 0 ? 'no active chaos' : `active chaos: ${[...new Set(active)].map((x) => x.replace(/_/g, ' ')).join(', ')}`;
  return `The haunted arena, ${lanes.length} lanes. Lane ${lead.lane}, ${lead.tier}, leads with ${lead.score}; ${chaos}.`;
}
