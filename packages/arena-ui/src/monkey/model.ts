// PK-U3: pure view model for the chaos monkey panel. No DOM, no network: unit tested. The wire shape is the `/api/monkey` answer of the
// live server (packages/haunt/src/monkey/host.ts); anything missing or odd falls back to a calm default so a half-answer never crashes the panel.
export type MonkeyMode = 'observe' | 'staging' | 'prod-guarded';
export const MODES: readonly MonkeyMode[] = ['observe', 'staging', 'prod-guarded'];

export const MODE_LABEL: Record<MonkeyMode, string> = { observe: 'Observe', staging: 'Staging', 'prod-guarded': 'Prod-guarded' };
export const MODE_NOTE: Record<MonkeyMode, string> = {
  observe: 'Injects nothing. Only measures the steady state.',
  staging: 'The full fault list on allowlisted endpoints, capped by the blast radius.',
  'prod-guarded': 'Only latency, a small error rate and one dependency down, on tagged synthetic traffic, in a schedule window.',
};

export interface AuditRow { ts: string; who: string; mode: string; event: string; fault?: string; endpoint?: string; result?: string; reason?: string }
export interface MonkeyView {
  mode: MonkeyMode;
  running: boolean;
  status: string;
  reason: string;
  injections: number;
  guardLines: string[];
  steady: { sli: string; threshold: number; value: number | null; held: boolean | null; samples: number; recent: number[] };
  audit: AuditRow[];
  lastStopMs: number | null;
  demoOnly: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);

export function parseMonkey(raw: unknown): MonkeyView | null {
  if (!isObj(raw)) return null;
  const mode = MODES.includes(raw.mode as MonkeyMode) ? (raw.mode as MonkeyMode) : 'observe';
  const g = isObj(raw.guard) ? raw.guard : {};
  const s = isObj(raw.steady) ? raw.steady : {};
  return {
    mode, running: raw.running === true, status: str(raw.status, 'idle'), reason: str(raw.reason), injections: num(raw.injections),
    guardLines: Array.isArray(g.lines) ? g.lines.map(String) : [],
    steady: {
      sli: str(s.sli, 'success_rate'), threshold: num(s.threshold, 0.95), value: typeof s.value === 'number' ? s.value : null,
      held: typeof s.held === 'boolean' ? s.held : null, samples: num(s.samples), recent: Array.isArray(s.recent) ? s.recent.map((x) => (x ? 1 : 0)) : [],
    },
    audit: Array.isArray(raw.audit) ? raw.audit.filter(isObj).map((a) => ({
      ts: str(a.ts), who: str(a.who), mode: str(a.mode), event: str(a.event), ...(a.fault ? { fault: str(a.fault) } : {}),
      ...(a.endpoint ? { endpoint: str(a.endpoint) } : {}), ...(a.result ? { result: str(a.result) } : {}), ...(a.reason ? { reason: str(a.reason) } : {}),
    })) : [],
    lastStopMs: typeof raw.lastStopMs === 'number' ? raw.lastStopMs : null,
    demoOnly: raw.demoOnly !== false,
  };
}

export type MeterTone = 'idle' | 'ok' | 'bad';
export interface MeterView {
  /** Fill from 0 to 100. */
  fill: number;
  /** Where the threshold sits, 0 to 100 (success rate), or null for latency (the scale is set by the larger of value and threshold). */
  marker: number;
  tone: MeterTone;
  text: string;
  label: string;
}

/** The steady-state meter: how the measured SLI sits against its threshold. */
export function meterView(v: MonkeyView): MeterView {
  const s = v.steady;
  const latency = s.sli === 'latency_p95_ms';
  const label = latency ? 'p95 latency' : 'Success rate';
  if (s.value === null) return { fill: 0, marker: latency ? 50 : s.threshold * 100, tone: 'idle', text: 'No samples yet', label };
  if (latency) {
    const top = Math.max(s.value, s.threshold) * 1.25 || 1;
    return { fill: Math.min(100, (s.value / top) * 100), marker: (s.threshold / top) * 100, tone: s.held === false ? 'bad' : s.held === true ? 'ok' : 'idle', text: `${Math.round(s.value)} ms (limit ${Math.round(s.threshold)} ms)`, label };
  }
  return { fill: Math.max(0, Math.min(100, s.value * 100)), marker: s.threshold * 100, tone: s.held === false ? 'bad' : s.held === true ? 'ok' : 'idle', text: `${(s.value * 100).toFixed(0)}% (needs ${(s.threshold * 100).toFixed(0)}%)`, label };
}

/** One line of the audit tail: time, what, where, why. */
export function auditLine(a: AuditRow): string {
  const t = a.ts.length >= 19 ? a.ts.slice(11, 19) : a.ts;
  const what = [a.event.toUpperCase(), a.fault, a.endpoint].filter(Boolean).join(' ');
  const tail = a.reason ?? a.result;
  return `${t}  ${what}${tail ? `  ${tail}` : ''}`;
}

export const STATUS_WORD: Record<string, string> = {
  idle: 'Idle', running: 'Running', completed: 'Finished: duration cap reached', aborted: 'ABORTED: steady state breached', stopped: 'STOPPED: kill switch', dead_man: 'STOPPED: dead-man timer', refused: 'Refused',
};
export const statusWord = (v: MonkeyView): string => STATUS_WORD[v.status] ?? v.status;

/** What to say about the kill switch: it is always the loudest control, and it says what it did. */
export function killNote(v: MonkeyView): string {
  if (v.running) return 'Ends every injection at once and restores normal behaviour.';
  if (v.lastStopMs !== null && v.status === 'stopped') return `Last stop restored normal behaviour in ${v.lastStopMs} ms.`;
  return 'Nothing is being injected.';
}
