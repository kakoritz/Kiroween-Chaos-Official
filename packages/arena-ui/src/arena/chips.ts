// Stage chips v2 (PT-U3, playtest-v2 ui.md section 3). `chipState` is a pure function of one lane's events
// for the current order. Issue events are defined once in contract/V1_1.md section 3. No DOM, no clock.
import type { ArenaEvent } from '../api/types';

export type ChipV2State =
  | 'pending' | 'next' | 'active' | 'trouble' | 'passed' | 'healed'
  | 'failed' | 'replayed' | 'parked' | 'quarantined' | 'dead';

export interface ChipInfo {
  state: ChipV2State;
  /** Issue events at this stage for the current order. */
  issues: number;
  attempts: number;
  /** Recovery and dead time so far, in ms (open spans end at the last event). */
  downtimeMs: number;
}

export const CHIP_WORD: Record<ChipV2State, string> = {
  pending: 'Not reached', next: 'Next up', active: 'In progress', trouble: 'In trouble', passed: 'Passed',
  healed: 'Passed after trouble', failed: 'Failed', replayed: 'Replayed', parked: 'Parked',
  quarantined: 'Quarantined', dead: 'Process dead',
};

/** Icon per state; colour is added by the renderer, and the label by the tooltip (colour-blind safe). */
export const CHIP_ICON: Record<ChipV2State, string> = {
  pending: '\u25CB', next: '\u25B6', active: '\u25CF', trouble: '\u26A0', passed: '\u2713', healed: '\u2713',
  failed: '\u2715', replayed: '\u21BB', parked: '\u26B0', quarantined: '\u2697', dead: '\u2620',
};

const dnum = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Is this event an issue (contract/V1_1.md section 3)? `chaos_absorbed` is not. */
export function isIssue(ev: ArenaEvent): boolean {
  const d = (ev.detail ?? {}) as Record<string, unknown>;
  switch (ev.type) {
    case 'stage_fail': case 'process_dead': case 'repeat': case 'order_parked': return true;
    case 'breaker': return d.state === 'open';
    // The floor-rule gremlin counts as an issue (contract V1_2 section 5, TV3-C3).
    case 'chaos': return d.source === 'gremlin' || d.fault === 'gremlin';
    default: return false;
  }
}

export function chipState(events: readonly ArenaEvent[], stageIds: readonly string[]): ChipInfo[] {
  const n = stageIds.length;
  const idx = new Map(stageIds.map((s, i) => [s, i] as const));
  const issues = Array<number>(n).fill(0);
  const attempts = Array<number>(n).fill(0);
  const down = Array<number>(n).fill(0);
  const started = Array<boolean>(n).fill(false);
  const done = Array<boolean>(n).fill(false);
  const skipped = Array<boolean>(n).fill(false);
  const failedFlag = Array<boolean>(n).fill(false);
  const degraded = Array<boolean>(n).fill(false);
  const terminal: Array<ChipV2State | null> = Array<ChipV2State | null>(n).fill(null);
  let open = -1;
  let begun = false;
  let ended = false;
  let recoverAt: number | null = null;
  let deadAt: number | null = null;
  let dead = false;
  let recovering = false;
  let breakerOpen = false;
  let last = 0;

  const at = (ev: ArenaEvent): number => {
    const s = ev.stage ? idx.get(ev.stage) : undefined;
    return s !== undefined ? s : open;
  };
  const closeSpans = (ts: number): void => {
    if (open >= 0 && recoverAt !== null) down[open]! += Math.max(0, ts - recoverAt);
    if (open >= 0 && deadAt !== null) down[open]! += Math.max(0, ts - deadAt);
    recoverAt = null; deadAt = null;
  };

  for (const ev of events) {
    const d = (ev.detail ?? {}) as Record<string, unknown>;
    last = Math.max(last, dnum(ev.ts));
    const si = at(ev);
    switch (ev.type) {
      case 'order_start': begun = true; ended = false; break;
      case 'stage_start':
        begun = true;
        if (si >= 0) {
          if (done[si] || skipped[si]) for (let i = si; i < n; i++) { done[i] = false; skipped[i] = false; started[i] = false; }
          open = si; started[si] = true;
          attempts[si] = Math.max(attempts[si]!, dnum(d.attempt, attempts[si]! + 1));
          failedFlag[si] = false; degraded[si] = false; recovering = false;
        }
        break;
      case 'stage_done':
        if (si >= 0) {
          done[si] = true; started[si] = true; skipped[si] = d.skipped === true; failedFlag[si] = false;
          if (attempts[si] === 0) attempts[si] = 1;
          closeSpans(dnum(ev.ts)); recovering = false;
        }
        break;
      case 'stage_fail':
        if (si >= 0) {
          issues[si]!++; failedFlag[si] = true;
          if (d.degraded === true) degraded[si] = true;
        }
        break;
      case 'recover_start': if (open >= 0) { recovering = true; closeSpans(dnum(ev.ts)); recoverAt = dnum(ev.ts); } break;
      case 'recover_done': if (open >= 0) { recovering = false; failedFlag[open] = false; closeSpans(dnum(ev.ts)); } break;
      case 'breaker':
        if (d.state === 'open') { breakerOpen = true; if (si >= 0) issues[si]!++; } else breakerOpen = false;
        break;
      case 'process_dead': if (open >= 0) { issues[open]!++; closeSpans(dnum(ev.ts)); deadAt = dnum(ev.ts); } dead = true; break;
      case 'process_up': closeSpans(dnum(ev.ts)); dead = false; break;
      case 'repeat': if (si >= 0) issues[si]!++; break;
      case 'order_parked': if (si >= 0) { issues[si]!++; terminal[si] = 'parked'; } ended = true; break;
      case 'order_quarantined': if (si >= 0) terminal[si] = 'quarantined'; ended = true; break;
      case 'order_failed': {
        const fi = typeof d.stage === 'string' ? idx.get(d.stage) ?? si : si;
        if (fi >= 0) terminal[fi] = 'failed';
        ended = true; break;
      }
      case 'order_done': ended = true; break;
      default: break;
    }
  }
  closeSpans(last);

  let next = -1;
  if (begun && !ended && (open < 0 || done[open] || skipped[open])) {
    next = started.findIndex((s, i) => !s && !done[i]);
  }
  return stageIds.map((_, i): ChipInfo => {
    let state: ChipV2State;
    const isOpen = i === open && started[i] && !done[i] && !skipped[i];
    if (terminal[i]) state = terminal[i]!;
    else if (isOpen && dead) state = 'dead';
    else if (skipped[i]) state = 'replayed';
    else if (done[i]) state = issues[i]! > 0 ? 'healed' : 'passed';
    else if (isOpen && !ended && (failedFlag[i] || recovering || breakerOpen || degraded[i])) state = 'trouble';
    else if (isOpen && !ended) state = 'active';
    else if (started[i] && degraded[i] && !isOpen) state = 'healed';
    else if (i === next) state = 'next';
    else state = 'pending';
    return { state, issues: issues[i]!, attempts: attempts[i]!, downtimeMs: down[i]! };
  });
}

/** Wave-wide issue counters behind the heat strip, folded in as each order ends. */
export interface Heat { issues: number[]; orders: number[] }
export const newHeat = (n: number): Heat => ({ issues: Array<number>(n).fill(0), orders: Array<number>(n).fill(0) });

/** Add one finished order. `orders` counts orders that had at least one issue at the stage. */
export function foldHeat(heat: Heat, info: readonly ChipInfo[]): void {
  info.forEach((c, i) => {
    if (i >= heat.issues.length || c.issues <= 0) return;
    heat.issues[i]! += c.issues; heat.orders[i]! += 1;
  });
}

export function heatAt(heat: Heat | undefined, info: readonly ChipInfo[] | undefined, folded: boolean | undefined, i: number): { issues: number; orders: number } {
  const cur = !folded ? info?.[i]?.issues ?? 0 : 0;
  return { issues: (heat?.issues[i] ?? 0) + cur, orders: (heat?.orders[i] ?? 0) + (cur > 0 ? 1 : 0) };
}

/** Heat strip opacity, 0 to 0.9: one issue is visible, four or more is full strength. */
export const heatAlpha = (issues: number): number => (issues <= 0 ? 0 : Math.min(0.9, 0.25 + 0.15 * issues));

const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`;

/** `Payment: 4 issues over 3 orders` (wave totals including the order in flight). */
export function heatTip(label: string, issues: number, orders: number): string {
  return issues > 0 ? `${label}: ${plural(issues, 'issue')} over ${plural(orders, 'order')}` : `${label}: no issues this wave`;
}

/** Chip tooltip: label, state in words, attempts so far, issues, downtime so far. */
export function chipTip(label: string, c: ChipInfo): string {
  return `${label}: ${CHIP_WORD[c.state]}. Attempts ${c.attempts}, issues ${c.issues}, downtime ${(c.downtimeMs / 1000).toFixed(1)} s`;
}

/** Fallback for lanes restored from a snapshot, which carry no events: map the legacy chip. */
export function fromLegacy(state: string, attempts: number): ChipInfo {
  const m: Record<string, ChipV2State> = {
    pending: 'pending', active: 'active', done: 'passed', replayed: 'replayed', retrying: 'trouble',
    failed: 'failed', dead: 'dead', parked: 'parked', quarantined: 'quarantined',
  };
  return { state: m[state] ?? 'pending', issues: 0, attempts, downtimeMs: 0 };
}
