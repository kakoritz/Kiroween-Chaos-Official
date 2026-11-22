// Production monkey config (PK-C4): modes, allowlist, blast radius, schedule window, steady-state hypothesis.
// No node imports. Spec: .kiro/specs/packs/spec.md section 5. Unsafe defaults never ship: every limit has a low default
// and prod-guarded has hard ceilings that a config cannot raise.
import { parseYaml } from '../config/yaml';

export type MonkeyMode = 'observe' | 'staging' | 'prod-guarded';
export const MONKEY_MODES: readonly MonkeyMode[] = ['observe', 'staging', 'prod-guarded'];

/** Fault kinds the monkey knows. `data_corruption` exists only so it can be refused in every mode. */
export type MonkeyFault = 'latency' | 'error' | 'dependency_down' | 'drop' | 'data_corruption';
export const PROD_SAFE_FAULTS: readonly MonkeyFault[] = ['latency', 'error', 'dependency_down'];
/** Never injected, in any mode. */
export const NEVER_FAULTS: readonly MonkeyFault[] = ['data_corruption'];

export interface PlanItem {
  fault: MonkeyFault;
  /** Path prefix the injection applies to. */
  endpoint: string;
  /** latency: added milliseconds. */
  ms?: number;
  /** error: the status to answer with (default 500). dependency_down: 503. */
  status?: number;
  /** Percent of matching traffic. In prod-guarded, omit it to inject on synthetic (tagged) traffic only. */
  percent?: number;
}

export interface Hypothesis {
  sli: 'success_rate' | 'latency_p95_ms';
  /** success_rate: minimum (0 to 1). latency_p95_ms: maximum. */
  threshold: number;
  /** Samples in the sliding window. */
  window: number;
  /** Samples needed before the hypothesis is judged. */
  minSamples: number;
  /** Milliseconds between probes. */
  intervalMs: number;
}

export interface Blast {
  maxPercent: number;
  maxConcurrent: number;
  maxDurationMs: number;
}

export interface Schedule {
  /** UTC hours, start inclusive, end exclusive. start > end wraps midnight. */
  startHourUtc: number;
  endHourUtc: number;
}

export interface MonkeyConfig {
  mode: MonkeyMode;
  hypothesis: Hypothesis;
  allow: { faults: MonkeyFault[]; endpoints: string[] };
  blast: Blast;
  schedule?: Schedule;
  /** Header that tags synthetic traffic. */
  syntheticHeader: string;
  /** Ends every injection when no heartbeat or healthy probe arrived for this long. */
  deadManMs: number;
  plan: PlanItem[];
}

/** Ceilings prod-guarded enforces whatever the file says. */
export const PROD_CEILING: Blast = { maxPercent: 10, maxConcurrent: 3, maxDurationMs: 15 * 60_000 };

export const DEFAULT_HYPOTHESIS: Hypothesis = { sli: 'success_rate', threshold: 0.95, window: 20, minSamples: 5, intervalMs: 250 };

export function defaultConfig(mode: MonkeyMode): MonkeyConfig {
  const prod = mode === 'prod-guarded';
  return {
    mode,
    hypothesis: { ...DEFAULT_HYPOTHESIS },
    allow: { faults: prod ? [...PROD_SAFE_FAULTS] : ['latency', 'error', 'dependency_down', 'drop'], endpoints: ['/api/'] },
    blast: prod ? { maxPercent: 5, maxConcurrent: 1, maxDurationMs: 60_000 } : { maxPercent: 50, maxConcurrent: 4, maxDurationMs: 5 * 60_000 },
    syntheticHeader: 'x-haunt-synthetic',
    deadManMs: 5_000,
    plan: [{ fault: 'latency', endpoint: '/api/', ms: 150 }],
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const FAULTS: readonly string[] = ['latency', 'error', 'dependency_down', 'drop', 'data_corruption'];

export type ConfigResult = { ok: true; config: MonkeyConfig } | { ok: false; errors: string[] };

/** Parses yaml or json text, merges it over the mode defaults, and validates it. */
export function parseMonkeyConfig(text: string, modeOverride?: MonkeyMode): ConfigResult {
  let raw: unknown;
  try { raw = text.trimStart().startsWith('{') ? JSON.parse(text) : parseYaml(text); } catch (e) { return { ok: false, errors: [(e as Error).message] }; }
  if (!isObj(raw)) return { ok: false, errors: ['config: expected a map'] };
  return buildMonkeyConfig(raw, modeOverride);
}

export function buildMonkeyConfig(raw: Record<string, unknown>, modeOverride?: MonkeyMode): ConfigResult {
  const errors: string[] = [];
  const mode = (modeOverride ?? raw.mode ?? 'observe') as MonkeyMode;
  if (!MONKEY_MODES.includes(mode)) return { ok: false, errors: [`mode: one of ${MONKEY_MODES.join(' | ')}`] };
  const d = defaultConfig(mode);
  const num = (v: unknown, path: string, dflt: number, min = 0): number => {
    if (v === undefined) return dflt;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min) { errors.push(`${path}: a number >= ${min}`); return dflt; }
    return v;
  };
  const h = isObj(raw.hypothesis) ? raw.hypothesis : {};
  const sli = (h.sli ?? d.hypothesis.sli) as Hypothesis['sli'];
  if (sli !== 'success_rate' && sli !== 'latency_p95_ms') errors.push('hypothesis.sli: success_rate | latency_p95_ms');
  const hypothesis: Hypothesis = {
    sli,
    threshold: num(h.threshold, 'hypothesis.threshold', sli === 'latency_p95_ms' ? 500 : d.hypothesis.threshold),
    window: num(h.window, 'hypothesis.window', d.hypothesis.window, 1),
    minSamples: num(h.minSamples, 'hypothesis.minSamples', d.hypothesis.minSamples, 1),
    intervalMs: num(h.intervalMs, 'hypothesis.intervalMs', d.hypothesis.intervalMs, 10),
  };
  if (sli === 'success_rate' && hypothesis.threshold > 1) errors.push('hypothesis.threshold: success_rate is a fraction from 0 to 1');
  const a = isObj(raw.allow) ? raw.allow : {};
  const faults = (a.faults ?? d.allow.faults) as unknown;
  const endpoints = (a.endpoints ?? d.allow.endpoints) as unknown;
  if (!Array.isArray(faults) || !faults.every((f) => FAULTS.includes(String(f)))) errors.push(`allow.faults: list of ${FAULTS.join(' | ')}`);
  if (!Array.isArray(endpoints) || !endpoints.every((e) => typeof e === 'string' && e.startsWith('/'))) errors.push('allow.endpoints: list of path prefixes starting with /');
  const b = isObj(raw.blast) ? raw.blast : {};
  const blast: Blast = {
    maxPercent: num(b.maxPercent, 'blast.maxPercent', d.blast.maxPercent),
    maxConcurrent: num(b.maxConcurrent, 'blast.maxConcurrent', d.blast.maxConcurrent, 1),
    maxDurationMs: num(b.maxDurationMs, 'blast.maxDurationMs', d.blast.maxDurationMs, 1),
  };
  if (blast.maxPercent > 100) errors.push('blast.maxPercent: at most 100');
  let schedule: Schedule | undefined;
  if (raw.schedule !== undefined) {
    const s = raw.schedule;
    if (!isObj(s) || typeof s.startHourUtc !== 'number' || typeof s.endHourUtc !== 'number' || [s.startHourUtc, s.endHourUtc].some((x) => (x as number) < 0 || (x as number) > 24)) errors.push('schedule: { startHourUtc, endHourUtc } with hours 0 to 24');
    else schedule = { startHourUtc: s.startHourUtc, endHourUtc: s.endHourUtc };
  }
  const plan: PlanItem[] = [];
  const rawPlan = raw.plan === undefined ? d.plan : raw.plan;
  if (!Array.isArray(rawPlan)) errors.push('plan: expected a list');
  else rawPlan.forEach((p, i) => {
    const path = `plan[${i}]`;
    if (!isObj(p) || !FAULTS.includes(String(p.fault))) { errors.push(`${path}.fault: one of ${FAULTS.join(' | ')}`); return; }
    if (typeof p.endpoint !== 'string' || !p.endpoint.startsWith('/')) { errors.push(`${path}.endpoint: a path prefix starting with /`); return; }
    plan.push({
      fault: p.fault as MonkeyFault, endpoint: p.endpoint,
      ...(p.ms !== undefined ? { ms: num(p.ms, `${path}.ms`, 0) } : {}),
      ...(p.status !== undefined ? { status: num(p.status, `${path}.status`, 100) } : {}),
      ...(p.percent !== undefined ? { percent: num(p.percent, `${path}.percent`, 0) } : {}),
    });
  });
  if (mode === 'prod-guarded' && !schedule) errors.push('schedule: prod-guarded needs a schedule window');
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    config: {
      mode, hypothesis,
      allow: { faults: (faults as string[]) as MonkeyFault[], endpoints: endpoints as string[] },
      blast, ...(schedule ? { schedule } : {}),
      syntheticHeader: typeof raw.syntheticHeader === 'string' ? raw.syntheticHeader.toLowerCase() : d.syntheticHeader,
      deadManMs: num(raw.deadManMs, 'deadManMs', d.deadManMs, 100),
      plan,
    },
  };
}

export function inSchedule(s: Schedule | undefined, at: number): boolean {
  if (!s) return true;
  const h = new Date(at).getUTCHours() + new Date(at).getUTCMinutes() / 60;
  return s.startHourUtc <= s.endHourUtc ? h >= s.startHourUtc && h < s.endHourUtc : h >= s.startHourUtc || h < s.endHourUtc;
}
