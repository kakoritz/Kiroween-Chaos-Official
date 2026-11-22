// Monkey host (PK-U3 backend) and the round runner behind `haunt watch`. Node only, 127.0.0.1 only.
// The host owns a built-in demo target behind the fault proxy and runs one monkey at a time, so the arena panel can start it in a mode,
// read the guard rails, the steady-state meter and the audit tail, and pull the kill switch. It never touches a third-party system.
import { startFaultProxy, type FaultProxy } from '../adapters/proxy';
import type { Ev } from '../tournament/rp';
import { defaultConfig, MONKEY_MODES, PROD_CEILING, type Blast, type Hypothesis, type MonkeyConfig, type MonkeyMode } from './config';
import { httpProbe, startDemoTarget, type DemoTarget } from './demo';
import { evaluatePlan, Monkey, type AuditEntry, type DryRunItem, type InjectionTarget, type Probe, type RunStatus, type Sample } from './monkey';
import type { RoundContext, RoundResult, RoundRunner } from './watch';

export interface GuardSummary {
  mode: MonkeyMode;
  /** Faults this mode lets through the allowlist (prod-guarded narrows it further). */
  allowFaults: string[];
  endpoints: string[];
  blast: Blast;
  /** prod-guarded ceilings a config cannot raise; null in the other modes. */
  ceiling: Blast | null;
  deadManMs: number;
  syntheticHeader: string;
  schedule: MonkeyConfig['schedule'] | null;
  hypothesis: Hypothesis;
  plan: DryRunItem[];
  /** One plain line per rail, for the panel. */
  lines: string[];
}

export interface SteadyState {
  sli: Hypothesis['sli'];
  threshold: number;
  /** Current value of the SLI over the window, or null before any probe. */
  value: number | null;
  /** True while the hypothesis holds, false on a breach, null until it can be judged. */
  held: boolean | null;
  samples: number;
  /** Recent probe results, oldest first: 1 ok, 0 failed. */
  recent: (0 | 1)[];
}

export interface MonkeyPanelState {
  /** The panel only ever drives the built-in demo target. */
  demoOnly: true;
  modes: readonly MonkeyMode[];
  mode: MonkeyMode;
  running: boolean;
  status: 'idle' | 'running' | RunStatus;
  reason: string;
  injections: number;
  guard: GuardSummary;
  steady: SteadyState;
  audit: AuditEntry[];
  /** Milliseconds the last kill switch took to restore normal behaviour, when one was pulled. */
  lastStopMs: number | null;
}

/** The demo config per mode. Low blast radius and a short duration: this is a demonstration, not a soak. */
export function panelConfig(mode: MonkeyMode): MonkeyConfig {
  const base = defaultConfig(mode);
  const cfg: MonkeyConfig = { ...base, blast: { ...base.blast, maxDurationMs: 60_000 }, hypothesis: { ...base.hypothesis, threshold: 0.8, window: 20, minSamples: 5, intervalMs: 250 } };
  if (mode === 'staging') cfg.plan = [{ fault: 'latency', endpoint: '/api/', ms: 200 }, { fault: 'error', endpoint: '/api/items', status: 500, percent: 10 }];
  if (mode === 'prod-guarded') {
    cfg.schedule = { startHourUtc: 0, endHourUtc: 24 };
    cfg.hypothesis = { ...cfg.hypothesis, threshold: 0.95 };
    cfg.plan = [{ fault: 'latency', endpoint: '/api/', ms: 120 }];
  }
  return cfg;
}

export function guardSummary(c: MonkeyConfig): GuardSummary {
  const prod = c.mode === 'prod-guarded';
  const h = c.hypothesis;
  const lines = [
    c.mode === 'observe' ? 'Observe: nothing is injected, only the steady state is measured.' : `Allowed faults: ${c.allow.faults.join(', ')}${prod ? ' (never data corruption)' : ''}.`,
    `Endpoints: ${c.allow.endpoints.join(', ') || 'none'}.`,
    `Blast radius: up to ${c.blast.maxPercent}% of traffic, ${c.blast.maxConcurrent} injection${c.blast.maxConcurrent === 1 ? '' : 's'} at once, ${Math.round(c.blast.maxDurationMs / 1000)} s.`,
    prod ? `Synthetic traffic only unless a percent is opted into (header ${c.syntheticHeader}); ceilings ${PROD_CEILING.maxPercent}%, ${PROD_CEILING.maxConcurrent} injections, ${PROD_CEILING.maxDurationMs / 60_000} min.` : 'Real traffic share is capped by the blast radius.',
    `Steady state: ${h.sli === 'success_rate' ? `success rate stays at or above ${Math.round(h.threshold * 100)}%` : `p95 latency stays at or below ${h.threshold} ms`}; a breach removes every injection.`,
    `Dead-man timer: ${Math.round(c.deadManMs / 1000)} s without a heartbeat removes every injection.`,
    'Runs against the built-in demo target only.',
  ];
  return { mode: c.mode, allowFaults: [...c.allow.faults], endpoints: [...c.allow.endpoints], blast: { ...c.blast }, ceiling: prod ? { ...PROD_CEILING } : null, deadManMs: c.deadManMs, syntheticHeader: c.syntheticHeader, schedule: c.schedule ?? null, hypothesis: { ...h }, plan: evaluatePlan(c), lines };
}

const steadyOf = (c: MonkeyConfig, window: Sample[], breach: string | null): SteadyState => {
  const h = c.hypothesis;
  let value: number | null = null;
  if (window.length) {
    if (h.sli === 'success_rate') value = window.filter((s) => s.ok).length / window.length;
    else { const ms = window.map((s) => s.ms).sort((a, b) => a - b); value = ms[Math.min(ms.length - 1, Math.ceil(0.95 * ms.length) - 1)]!; }
  }
  return { sli: h.sli, threshold: h.threshold, value, held: window.length < h.minSamples ? null : breach === null, samples: window.length, recent: window.map((s) => (s.ok ? 1 : 0)) };
};

export class MonkeyHost {
  private demo?: DemoTarget;
  private proxy?: FaultProxy;
  private monkey?: Monkey;
  private config: MonkeyConfig = panelConfig('observe');
  private audit: AuditEntry[] = [];
  private lastStopMs: number | null = null;
  private starting = false;
  private closed = false;

  constructor(private readonly who = 'arena-panel') {}

  private async ensureTarget(): Promise<FaultProxy> {
    if (!this.proxy) {
      this.demo = await startDemoTarget();
      this.proxy = await startFaultProxy({ upstream: this.demo.url });
    }
    return this.proxy;
  }

  get running(): boolean { return this.monkey?.active ?? false; }

  state(auditTail = 20): MonkeyPanelState {
    const snap = this.monkey?.snapshot(auditTail);
    return {
      demoOnly: true, modes: MONKEY_MODES, mode: this.config.mode, running: snap?.running ?? false, status: snap?.status ?? 'idle', reason: snap?.reason ?? '',
      injections: snap?.injections ?? 0, guard: guardSummary(this.config), steady: steadyOf(this.config, snap?.window ?? [], snap?.breach ?? null),
      audit: this.audit.slice(-auditTail), lastStopMs: this.lastStopMs,
    };
  }

  /** Previews a mode without running it: the guard rails and the dry-run plan. */
  preview(mode: MonkeyMode): GuardSummary { return guardSummary(panelConfig(mode)); }

  async start(mode: MonkeyMode): Promise<MonkeyPanelState> {
    if (this.closed) throw new Error('monkey host is closed');
    if (!MONKEY_MODES.includes(mode)) throw new Error(`mode: one of ${MONKEY_MODES.join(' | ')}`);
    if (this.running || this.starting) throw new Error('a monkey run is already active: pull the kill switch first');
    this.starting = true;
    try {
      const proxy = await this.ensureTarget();
      proxy.clearFaults();
      this.config = panelConfig(mode);
      const m = new Monkey({
        config: this.config, target: proxy, probe: httpProbe(`${proxy.url}/api/items`, this.config.syntheticHeader, 1500), who: this.who,
        audit: (e) => { this.audit.push(e); if (this.audit.length > 500) this.audit.splice(0, this.audit.length - 500); },
      });
      this.monkey = m;
      void m.start();
    } finally { this.starting = false; }
    return this.state();
  }

  /** The kill switch: every injection is removed before this returns. Idle is not an error. */
  stop(reason = 'kill switch: arena panel'): MonkeyPanelState {
    if (this.monkey?.active) {
      const t0 = Date.now();
      this.monkey.stop(reason);
      this.lastStopMs = Date.now() - t0;
    }
    return this.state();
  }

  async close(): Promise<void> {
    this.closed = true;
    this.monkey?.stop('host closed');
    await this.proxy?.close();
    await this.demo?.close();
    this.proxy = undefined; this.demo = undefined;
  }
}

// ---------------------------------------------------------------------------------------------------------------- watch rounds

export interface RoundRunnerOptions {
  base: MonkeyConfig;
  target: InjectionTarget;
  probe: Probe;
  /** Path the probe hits; it becomes the stage name in the mined events. */
  probePath: string;
  audit?: (e: AuditEntry) => void;
  who?: string;
}

/** Scales a config to a watch speed: probes and the round both run N times faster (1x leaves it untouched). */
export function scaleConfig(c: MonkeyConfig, speed: number): MonkeyConfig {
  if (speed === 1) return c;
  return { ...c, hypothesis: { ...c.hypothesis, intervalMs: Math.max(10, Math.round(c.hypothesis.intervalMs / speed)) }, blast: { ...c.blast, maxDurationMs: Math.max(100, Math.round(c.blast.maxDurationMs / speed)) } };
}

/** One watch round = one monkey run; its probe results become events the pattern miner reads (stage starts, failures, outage windows). */
export function monkeyRoundRunner(o: RoundRunnerOptions): RoundRunner {
  return async (ctx: RoundContext): Promise<RoundResult> => {
    const samples: Sample[] = [];
    const probe: Probe = async () => { const s = await o.probe(); samples.push(s); return s; };
    const monkey = new Monkey({ config: scaleConfig(o.base, ctx.speed), target: o.target, probe, ...(o.audit ? { audit: o.audit } : {}), who: o.who ?? 'haunt-watch' });
    const onAbort = (): void => { monkey.stop('watch stopped'); };
    if (ctx.signal.aborted) onAbort(); else ctx.signal.addEventListener('abort', onAbort, { once: true });
    const t0 = Date.now();
    let report;
    try { report = await monkey.start(); } finally { ctx.signal.removeEventListener('abort', onAbort); }
    const events: Ev[] = [];
    let seq = 0;
    samples.forEach((s, i) => {
      const order = `r${ctx.index}-${i + 1}`;
      events.push({ seq: ++seq, type: 'stage_start', lane: 1, order, stage: o.probePath, ts: t0 + i });
      if (!s.ok) events.push({ seq: ++seq, type: 'stage_fail', lane: 1, order, stage: o.probePath, detail: { error: 'steady-state probe failed', retryable: true }, ts: t0 + i });
    });
    if (report.status === 'aborted') {
      const fault = report.audit.find((a) => a.event === 'inject')?.fault ?? 'endpoint_down';
      events.push({ seq: ++seq, type: 'outage', lane: 1, stage: o.probePath, detail: { fault, outageMs: Math.max(0, Date.now() - t0) } });
    }
    return { events, status: report.status, reason: report.reason, injections: report.injections, samples: samples.length, successRate: report.successRate };
  };
}
