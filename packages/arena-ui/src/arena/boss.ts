// Boss banner (UI-B5, ui-spec sections 3, 5 and 7). The pure helpers carry the logic and are unit
// tested; BossBar only mirrors them in DOM. The countdown is cosmetic: it counts down from the
// `startsInMs` of boss_warning, scaled by wave speed (PROTOCOL rule 21), and never decides anything.
import type { ArenaEvent, ArenaState } from '../api/types';
import { drawCreature } from '../creatures/draw';
import type { CreatureId } from '../creatures/defs';

export type BossPhase = 'none' | 'warning' | 'active';
export interface BossVM {
  phase: BossPhase;
  /** Fault id, for example boss_power_outage. */
  fault: string;
  /** Cosmetic start of the countdown (ms clock of the caller) and its real length in ms. */
  warnedAt: number;
  warnMs: number;
}

export const emptyBoss = (): BossVM => ({ phase: 'none', fault: '', warnedAt: 0, warnMs: 0 });

export interface BossInfo { name: string; sprite: CreatureId | null; line: string }
const BOSSES: Record<string, BossInfo> = {
  boss_power_outage: { name: 'Lich', sprite: 'lich', line: 'Power Outage' },
  boss_internet_outage: { name: 'Banshee Queen', sprite: 'banshee_queen', line: 'Internet Outage' },
  boss_hazard_storm: { name: 'Headless Horseman', sprite: 'horseman', line: 'Hazard Storm' },
};
export const bossInfo = (fault: string): BossInfo =>
  BOSSES[fault] ?? { name: fault.replace(/^boss_/, '').replace(/_/g, ' ') || 'Boss', sprite: null, line: 'Boss' };

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Real milliseconds of a boss warning at the given wave speed. */
export const warnRealMs = (startsInMs: number, speed: number): number => Math.max(0, startsInMs) / (speed > 0 ? speed : 1);

/** Apply a boss_* event. Returns true when the event ended a boss (so the caller can flash lanes). */
export function applyBossEvent(b: BossVM, ev: ArenaEvent, now: number, speed: number): 'warning' | 'start' | 'end' | null {
  const d = (ev.detail ?? {}) as Record<string, unknown>;
  const fault = typeof d.boss === 'string' ? d.boss : b.fault;
  if (ev.type === 'boss_warning') {
    b.phase = 'warning'; b.fault = fault; b.warnedAt = now; b.warnMs = warnRealMs(num(d.startsInMs, 8000), speed);
    return 'warning';
  }
  if (ev.type === 'boss_start') { b.phase = 'active'; b.fault = fault; return 'start'; }
  if (ev.type === 'boss_end') { b.phase = 'none'; b.fault = fault; return 'end'; }
  return null;
}

/** Rebuild from GET /api/state on load and reconnect. `next` names the boss in play. */
export function loadBoss(b: BossVM, s: ArenaState, now: number, speed: number): void {
  const sb = s.boss;
  b.phase = 'none'; b.warnMs = 0;
  if (!sb) return;
  if (sb.active) { b.phase = 'active'; b.fault = sb.next ?? b.fault; return; }
  if (sb.next && typeof sb.startsInMs === 'number') {
    b.phase = 'warning'; b.fault = sb.next; b.warnedAt = now; b.warnMs = warnRealMs(sb.startsInMs, speed);
  }
}

/** Whole seconds left, never below 0. */
export const secondsLeft = (b: BossVM, now: number): number => Math.max(0, Math.ceil((b.warnMs - (now - b.warnedAt)) / 1000));

export interface BossView { visible: boolean; active: boolean; name: string; line: string; status: string; sprite: CreatureId | null; fault: string }
export function bossView(b: BossVM, now: number): BossView {
  const info = bossInfo(b.fault);
  const visible = b.phase !== 'none';
  const status = b.phase === 'active' ? 'ACTIVE' : b.phase === 'warning' ? `arrives in ${secondsLeft(b, now)}` : '';
  return { visible, active: b.phase === 'active', name: info.name, line: info.line, status, sprite: info.sprite, fault: b.fault };
}

/** Text for the assertive live region (ui-spec section 15). */
export function bossAnnouncement(kind: 'warning' | 'start' | 'end', b: BossVM): string {
  const i = bossInfo(b.fault);
  if (kind === 'warning') return `Boss warning: ${i.name}, ${i.line}, arrives in ${Math.round(b.warnMs / 1000)} seconds.`;
  if (kind === 'start') return `${i.name} is here. Every lane is hit.`;
  return `${i.name} has left.`;
}

/** How long the per-lane "Survived" flash lasts (ms, real time). */
export const SURVIVED_MS = 1600;

export class BossBar {
  private readonly canvas: HTMLCanvasElement;
  private readonly nameEl: HTMLElement;
  private readonly lineEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private last = '';
  constructor(private readonly el: HTMLElement) {
    el.innerHTML = '<canvas class="boss-sprite" width="96" height="96" aria-hidden="true"></canvas>'
      + '<span class="boss-tag">BOSS</span><span class="boss-name"></span><span class="boss-line"></span><span class="boss-status"></span>';
    this.canvas = el.querySelector('canvas')!;
    this.nameEl = el.querySelector('.boss-name')!;
    this.lineEl = el.querySelector('.boss-line')!;
    this.statusEl = el.querySelector('.boss-status')!;
  }

  update(b: BossVM, now: number, reduced: boolean): void {
    const v = bossView(b, now);
    const key = `${v.visible}|${v.active}|${v.name}|${v.status}`;
    this.el.classList.toggle('boss--in', v.visible);
    this.el.classList.toggle('boss--active', v.active);
    this.el.classList.toggle('boss--still', reduced);
    this.el.setAttribute('aria-hidden', v.visible ? 'false' : 'true');
    if (!v.visible) { this.last = ''; return; }
    if (key !== this.last) {
      this.last = key;
      this.nameEl.textContent = v.name; this.lineEl.textContent = v.line; this.statusEl.textContent = v.status;
    }
    this.paintSprite(v, now, reduced);
  }

  private paintSprite(v: BossView, now: number, reduced: boolean): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 96, 96);
    ctx.save();
    ctx.translate(48, 48);
    if (v.sprite) {
      const p = reduced ? 0 : (now % 3000) / 3000;
      drawCreature(ctx, v.sprite, 'idle', p, { silhouette: false, size: 84 });
    } else {
      // Banshee Queen and Headless Horseman are drawn with the rest of the boss art (UI-B6).
      ctx.fillStyle = '#9b6bff'; ctx.font = '700 56px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(v.fault === 'boss_internet_outage' ? '\u2655' : '\u2605', 0, 4);
    }
    ctx.restore();
  }
}

/** 0..1 progress of a lane's Survived flash, or null when it is not showing. */
export const survivedAge = (l: { survivedAt: number }, now: number): number | null => {
  if (!l.survivedAt) return null;
  const a = (now - l.survivedAt) / SURVIVED_MS;
  return a >= 0 && a < 1 ? a : null;
};
