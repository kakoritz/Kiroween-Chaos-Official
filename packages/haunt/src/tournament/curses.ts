// Curses (spec 5.2, V1_2 section 5, TV3-C9): a persistent, per-lane, per-endpoint trait. The provider lies on that endpoint; this module draws curses,
// classifies how a bot reacted to each lie and tabulates "what each lane returned when the API lied".
import { unit } from '../shared/rng';
import { APPS, TIERS, type AppId } from '../shared/catalog';
import { isBuiltinApp } from '../shared/registry';
import { tierOfLane } from './rounds';
import type { Ev } from './rp';

/** Wire names of V1_2 section 5. */
export const CURSE_KINDS = ['404', 'slow', 'flaky500', 'clock_skew', 'rate_limit'] as const;
export type CurseKind = (typeof CURSE_KINDS)[number];
export type CurseClass = 'handled' | 'reported' | 'swallowed' | 'crashed';
export const CURSE_CLASSES: readonly CurseClass[] = ['handled', 'reported', 'swallowed', 'crashed'];

export const CURSE_LABELS: Record<CurseKind, string> = { '404': 'Cursed 404', slow: 'Slow Hand', flaky500: 'Flaky 500', clock_skew: 'Skewed Clock', rate_limit: 'Rate Limited' };
export const CURSE_RESPONSE: Record<CurseKind, string> = {
  '404': 'Do not treat as final; check, retry, or park and report',
  slow: 'Timeout and fallback; do not stack calls',
  flaky500: 'Retry with backoff',
  clock_skew: 'Do not rely on local time for idempotency',
  rate_limit: 'Honour Retry-After',
};

/** The provider endpoints a curse can lie on. */
export const CURSE_ENDPOINTS = ['account', 'order', 'charge', 'email', 'store', 'dispatch', 'notify', 'tracking', 'handoff', 'ticket', 'reply'] as const;

export interface CurseRec { id: string; lane: number; kind: CurseKind; endpoint: string; rate?: number; delayMs?: number; source: 'plan' | 'player' }

/** Spec 5.2 ranges: 404 hits 15 to 40 percent, Slow Hand takes 2 to 8 s, Flaky 500 a random share, Rate Limited bursts. */
export function drawCurse(seed: string | number, lane: number, n: number, kind?: CurseKind, endpoint?: string): { kind: CurseKind; endpoint: string; rate?: number; delayMs?: number } {
  const k = kind ?? CURSE_KINDS[Math.floor(unit(seed, 'curse-kind', lane, n) * CURSE_KINDS.length)]!;
  const e = endpoint ?? CURSE_ENDPOINTS[Math.floor(unit(seed, 'curse-endpoint', lane, n) * CURSE_ENDPOINTS.length)]!;
  const u = unit(seed, 'curse-draw', lane, n);
  if (k === '404') return { kind: k, endpoint: e, rate: Math.round((0.15 + u * 0.25) * 100) / 100 };
  if (k === 'flaky500') return { kind: k, endpoint: e, rate: Math.round((0.2 + u * 0.3) * 100) / 100 };
  if (k === 'rate_limit') return { kind: k, endpoint: e, rate: Math.round((0.2 + u * 0.2) * 100) / 100 };
  if (k === 'slow') return { kind: k, endpoint: e, delayMs: Math.round(2000 + u * 6000) };
  return { kind: k, endpoint: e };
}

/** The stage a call to a provider endpoint belongs to. `index` tells the two store steps and the two notices apart. */
export function stageOfCall(service: string, index?: number, app: AppId = 'orders'): string {
  if (app !== 'orders') {
    // The Stream app calls the store twice (upload, then archive), told apart by index like the orders store steps.
    if (app === 'stream' && service === 'store') return index === 2 ? 'archive' : 'fetch';
    const hit = APPS[app].stages.find((s) => s.effects.some((e) => e.service === service || (service === 'account' && e.kind === 'account_create')));
    if (hit) return hit.id;
    // An app registered from a haunt.yaml has no Orders stage to fall back on: use its own first effect stage, never a foreign id.
    if (!isBuiltinApp(app)) return (APPS[app].stages.find((s) => s.effects.length > 0) ?? APPS[app].stages[0]!).id;
  }
  switch (service) {
    case 'account': return 'account';
    case 'order': return 'submit';
    case 'charge': return 'payment';
    case 'email': return 'confirmation';
    case 'store': return index === 2 ? 'process' : 'receive';
    case 'notify': return 'updates';
    case 'dispatch': return 'ship';
    case 'tracking': return 'transit';
    case 'handoff': return 'handoff';
    case 'ticket': return 'assign';
    case 'reply': return 'notify';
    default: return 'payment';
  }
}

/** Does an `effect` event show that the step the cursed call belonged to really happened? Polls and the handoff leave no ledger row. */
export function effectSeen(effects: readonly { kind: string; key: string }[], service: string, index?: number, app: AppId = 'orders'): boolean | null {
  const stage = APPS[app].stages.find((s) => s.id === stageOfCall(service, index, app));
  if (!stage || stage.effects.length === 0) return null;
  const kinds = app === 'orders' ? [service === 'account' ? 'account_create' : service] : [service, ...stage.effects.map((e) => e.kind)];
  return effects.some((e) => kinds.includes(e.kind) && (index === undefined || (service !== 'store' && service !== 'notify') || e.key.endsWith(`:${service}:${index}`)));
}

export interface OrderTrace { order: string; effects: { kind: string; key: string }[]; failed: boolean; died: boolean }

/**
 * How the bot reacted to a cursed answer once the order ended (spec 5.2):
 * handled = the step happened after all (retry or fallback), reported = the error surfaced and the order was parked or failed,
 * swallowed = the error vanished and the step was skipped, crashed = the process died.
 */
export function classifyHit(end: 'order_done' | 'order_failed' | 'order_parked' | 'order_quarantined' | 'lane_halted', trace: OrderTrace, service: string, index?: number, app: AppId = 'orders'): CurseClass {
  if (trace.died) return 'crashed';
  if (end === 'order_parked' || end === 'order_quarantined') return 'reported';
  if (end === 'order_failed' || end === 'lane_halted') return trace.failed ? 'reported' : 'crashed';
  const seen = effectSeen(trace.effects, service, index, app);
  return seen === false ? 'swallowed' : 'handled';
}

export interface CurseRow { lane: number; tier: string; curse: CurseKind; endpoint: string | null; handled: number; reported: number; swallowed: number; crashed: number; total: number; verdict: string }

/** "What each lane returned when the API lied": one row per (lane, curse) from the `curse_response` events, with the curse's endpoint from `curse_start`. */
export function curseTable(events: readonly Ev[]): CurseRow[] {
  const endpoints = new Map<string, string>();
  for (const e of events) if (e.type === 'curse_start') { const d = (e.detail ?? {}) as Record<string, any>; endpoints.set(`${Number(e.lane)}|${d.kind}`, String(d.endpoint ?? '')); }
  const rows = new Map<string, CurseRow>();
  for (const e of events) {
    if (e.type !== 'curse_response') continue;
    const d = (e.detail ?? {}) as Record<string, any>;
    const lane = Number(e.lane);
    const key = `${lane}|${d.curse}`;
    const row = rows.get(key) ?? { lane, tier: TIERS[tierOfLane(lane)]?.label ?? '', curse: d.curse as CurseKind, endpoint: endpoints.get(key) ?? null, handled: 0, reported: 0, swallowed: 0, crashed: 0, total: 0, verdict: '' };
    if (CURSE_CLASSES.includes(d.class)) row[d.class as CurseClass]++;
    row.total++;
    rows.set(key, row);
  }
  for (const r of rows.values()) r.verdict = r.swallowed > 0 ? 'swallowed errors: the worst answer' : r.crashed > 0 ? 'crashed' : r.reported > 0 ? 'reported, not recovered' : 'handled';
  return [...rows.values()].sort((a, b) => a.lane - b.lane || a.curse.localeCompare(b.curse));
}
