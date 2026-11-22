// Production monkey engine (PK-C4, PK-C5). Decides what may be injected, injects through a proxy-like target, watches the
// steady-state hypothesis and ends everything on a breach, a kill switch, the duration cap or a dead-man timeout.
// No node imports. Spec: .kiro/specs/packs/spec.md section 5.
import type { ProxyFault, ProxyStats } from '../adapters/proxy';
import { inSchedule, NEVER_FAULTS, PROD_CEILING, PROD_SAFE_FAULTS, type Hypothesis, type MonkeyConfig, type PlanItem } from './config';

/** What the monkey needs from the Proxy adapter (startFaultProxy satisfies it). */
export interface InjectionTarget {
  addFault(fault: ProxyFault): number;
  removeFault(id: number): void;
  clearFaults(): void;
  stats(): ProxyStats;
}
export interface Sample { ok: boolean; ms: number }
export type Probe = () => Promise<Sample>;

export interface AuditEntry {
  ts: string;
  who: string;
  mode: string;
  event: 'start' | 'refused' | 'inject' | 'remove' | 'breach' | 'stop' | 'dead_man' | 'duration' | 'end';
  fault?: string;
  endpoint?: string;
  result?: string;
  reason?: string;
  detail?: Record<string, unknown>;
}

export interface DryRunItem {
  fault: string;
  endpoint: string;
  decision: 'inject' | 'refuse' | 'skip';
  reason: string;
  /** Exactly the proxy rule that would be added. Null when nothing would be injected. */
  rule: ProxyFault | null;
}

export type RunStatus = 'completed' | 'aborted' | 'stopped' | 'dead_man' | 'refused';
export interface MonkeyReport {
  mode: string;
  status: RunStatus;
  reason: string;
  injections: number;
  samples: number;
  successRate: number;
  p95Ms: number;
  startedAt: string;
  endedAt: string;
  audit: AuditEntry[];
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
}

/** Judges the sliding window against the hypothesis. Returns a reason string on breach, else null. */
export function judge(h: Hypothesis, window: Sample[]): string | null {
  if (window.length < h.minSamples) return null;
  if (h.sli === 'success_rate') {
    const rate = window.filter((s) => s.ok).length / window.length;
    return rate < h.threshold ? `steady state breached: success_rate ${rate.toFixed(3)} < ${h.threshold}` : null;
  }
  const p95 = percentile(window.map((s) => s.ms), 95);
  return p95 > h.threshold ? `steady state breached: latency_p95_ms ${Math.round(p95)} > ${h.threshold}` : null;
}

function ruleFor(c: MonkeyConfig, p: PlanItem, percent: number | undefined): ProxyFault {
  const base: ProxyFault = {
    kind: p.fault === 'latency' ? 'latency' : p.fault === 'drop' ? 'drop' : 'status',
    pathPrefix: p.endpoint,
    forMs: c.blast.maxDurationMs,
    ...(percent !== undefined ? { percent } : { header: c.syntheticHeader }),
  };
  if (p.fault === 'latency') base.ms = p.ms ?? 150;
  if (p.fault === 'error') base.status = p.status ?? 500;
  if (p.fault === 'dependency_down') base.status = p.status ?? 503;
  return base;
}

/** The dry run: exactly what would be injected and where, and what would be refused and why. Pure. */
export function evaluatePlan(c: MonkeyConfig): DryRunItem[] {
  let accepted = 0;
  return c.plan.map((p): DryRunItem => {
    const refuse = (reason: string): DryRunItem => ({ fault: p.fault, endpoint: p.endpoint, decision: 'refuse', reason, rule: null });
    if (c.mode === 'observe') return { fault: p.fault, endpoint: p.endpoint, decision: 'skip', reason: 'observe mode injects nothing', rule: null };
    if (NEVER_FAULTS.includes(p.fault)) return refuse(`${p.fault} is never injected`);
    if (!c.allow.faults.includes(p.fault)) return refuse(`${p.fault} is not on the allowlist`);
    const prod = c.mode === 'prod-guarded';
    if (prod && !PROD_SAFE_FAULTS.includes(p.fault)) return refuse(`${p.fault} is not allowed in prod-guarded (only ${PROD_SAFE_FAULTS.join(', ')})`);
    if (prod && c.allow.endpoints.length === 0) return refuse('prod-guarded needs an endpoint allowlist');
    if (c.allow.endpoints.length && !c.allow.endpoints.some((e) => p.endpoint.startsWith(e))) return refuse(`endpoint ${p.endpoint} is not on the allowlist`);
    const cap = prod ? Math.min(c.blast.maxPercent, PROD_CEILING.maxPercent) : c.blast.maxPercent;
    if (p.percent !== undefined && p.percent > cap) return refuse(`percent ${p.percent} exceeds the cap ${cap}`);
    if (accepted >= c.blast.maxConcurrent) return refuse(`max concurrent injections (${c.blast.maxConcurrent}) reached`);
    // prod: synthetic-tagged traffic unless an explicit small percent was opted into. staging: capped percent.
    const percent = p.percent ?? (prod ? undefined : cap);
    accepted++;
    return { fault: p.fault, endpoint: p.endpoint, decision: 'inject', reason: percent === undefined ? 'allowed on synthetic-tagged traffic only' : `allowed on ${percent}% of matching traffic`, rule: ruleFor(c, p, percent) };
  });
}

/** Problems that stop the whole run before anything is injected. */
export function runBlockers(c: MonkeyConfig, at: number): string[] {
  const out: string[] = [];
  if (c.mode === 'prod-guarded') {
    if (c.blast.maxPercent > PROD_CEILING.maxPercent) out.push(`blast.maxPercent ${c.blast.maxPercent} exceeds the prod-guarded ceiling ${PROD_CEILING.maxPercent}`);
    if (c.blast.maxConcurrent > PROD_CEILING.maxConcurrent) out.push(`blast.maxConcurrent ${c.blast.maxConcurrent} exceeds the prod-guarded ceiling ${PROD_CEILING.maxConcurrent}`);
    if (c.blast.maxDurationMs > PROD_CEILING.maxDurationMs) out.push(`blast.maxDurationMs ${c.blast.maxDurationMs} exceeds the prod-guarded ceiling ${PROD_CEILING.maxDurationMs}`);
    if (!c.schedule) out.push('prod-guarded needs a schedule window');
  }
  if (c.mode !== 'observe' && !inSchedule(c.schedule, at)) out.push('outside the schedule window');
  return out;
}

export interface MonkeyOptions {
  config: MonkeyConfig;
  target: InjectionTarget;
  /** One steady-state measurement. Omitted means no hypothesis can be judged (not allowed outside observe). */
  probe?: Probe;
  audit?: (e: AuditEntry) => void;
  who?: string;
  now?: () => number;
}

export class Monkey {
  private readonly c: MonkeyConfig;
  private readonly now: () => number;
  private readonly who: string;
  private readonly entries: AuditEntry[] = [];
  private window: Sample[] = [];
  private total = 0;
  private injected = 0;
  private ids: number[] = [];
  private ticker?: ReturnType<typeof setInterval>;
  private durationTimer?: ReturnType<typeof setTimeout>;
  private deadMan?: ReturnType<typeof setTimeout>;
  private ending = false;
  private startedAt = '';
  private resolve!: (r: MonkeyReport) => void;
  private done?: Promise<MonkeyReport>;
  private ticking = false;
  private running = false;

  constructor(private readonly o: MonkeyOptions) {
    this.c = o.config;
    this.now = o.now ?? Date.now;
    this.who = o.who ?? 'haunt-monkey';
  }

  get active(): boolean { return this.running && !this.ending; }

  plan(): DryRunItem[] { return evaluatePlan(this.c); }

  private log(event: AuditEntry['event'], extra: Partial<AuditEntry> = {}): void {
    const e: AuditEntry = { ts: new Date(this.now()).toISOString(), who: this.who, mode: this.c.mode, event, ...extra };
    this.entries.push(e);
    this.o.audit?.(e);
  }

  /** Runs until the duration cap, a breach, a kill switch or the dead-man timer. Resolves with the report. */
  start(): Promise<MonkeyReport> {
    if (this.done) return this.done;
    this.done = new Promise<MonkeyReport>((res) => { this.resolve = res; });
    this.startedAt = new Date(this.now()).toISOString();
    this.running = true;
    this.log('start', { detail: { hypothesis: this.c.hypothesis, blast: this.c.blast, allow: this.c.allow } });
    void this.boot();
    return this.done;
  }

  private async boot(): Promise<void> {
    const blockers = runBlockers(this.c, this.now());
    if (blockers.length) { for (const b of blockers) this.log('refused', { reason: b }); return this.finish('refused', blockers.join('; '), 'refused'); }
    if (this.c.mode !== 'observe' && !this.o.probe) { this.log('refused', { reason: 'no steady-state probe' }); return this.finish('refused', 'no steady-state probe: refusing to inject without a hypothesis', 'refused'); }
    // The hypothesis must hold before anything is injected.
    if (this.o.probe) {
      for (let i = 0; i < this.c.hypothesis.minSamples && !this.ending; i++) this.record(await this.safeProbe());
      const base = judge(this.c.hypothesis, this.window);
      if (base && !this.ending) { this.log('refused', { reason: `baseline: ${base}` }); return this.finish('refused', `baseline not steady: ${base}`, 'refused'); }
    }
    if (this.ending) return;
    for (const item of this.plan()) {
      if (item.decision === 'inject' && item.rule) {
        this.ids.push(this.o.target.addFault(item.rule));
        this.injected++;
        this.log('inject', { fault: item.fault, endpoint: item.endpoint, result: 'applied', detail: { rule: item.rule } });
      } else this.log('refused', { fault: item.fault, endpoint: item.endpoint, reason: item.reason });
    }
    this.durationTimer = setTimeout(() => this.finish('completed', 'duration cap reached', 'duration'), this.c.blast.maxDurationMs);
    this.armDeadMan();
    if (this.o.probe) this.ticker = setInterval(() => { void this.tick(); }, this.c.hypothesis.intervalMs);
  }

  private async safeProbe(): Promise<Sample> {
    try { return await this.o.probe!(); } catch { return { ok: false, ms: 0 }; }
  }
  private record(s: Sample): void {
    this.total++;
    this.window.push(s);
    if (this.window.length > this.c.hypothesis.window) this.window.shift();
  }
  private async tick(): Promise<void> {
    if (this.ticking || this.ending) return;
    this.ticking = true;
    try {
      const s = await this.safeProbe();
      if (this.ending) return;
      this.record(s);
      this.armDeadMan(); // a finished probe round proves the controller is alive
      const breach = judge(this.c.hypothesis, this.window);
      if (breach) { this.log('breach', { reason: breach }); this.finish('aborted', breach, 'end'); }
    } finally { this.ticking = false; }
  }

  private armDeadMan(): void {
    if (this.deadMan) clearTimeout(this.deadMan);
    if (this.ending) return;
    this.deadMan = setTimeout(() => { this.log('dead_man', { reason: `no heartbeat for ${this.c.deadManMs} ms` }); this.finish('dead_man', `dead-man timer: no heartbeat for ${this.c.deadManMs} ms`, 'end'); }, this.c.deadManMs);
  }

  /** An external controller proves it is alive. */
  heartbeat(): void { if (this.active) this.armDeadMan(); }

  /** The kill switch. Synchronous: every rule is removed before this returns. */
  stop(reason = 'kill switch'): MonkeyReport | undefined {
    if (!this.running) return undefined;
    if (!this.ending) this.log('stop', { reason });
    this.finish('stopped', reason, 'end');
    return this.report('stopped', reason);
  }

  private finish(status: RunStatus, reason: string, last: 'refused' | 'duration' | 'end'): void {
    if (this.ending) return;
    this.ending = true;
    if (this.ticker) clearInterval(this.ticker);
    if (this.durationTimer) clearTimeout(this.durationTimer);
    if (this.deadMan) clearTimeout(this.deadMan);
    this.o.target.clearFaults();
    for (const _ of this.ids) this.log('remove', { result: 'restored' });
    this.ids = [];
    if (last === 'duration') this.log('duration', { reason });
    this.log('end', { result: status, reason });
    this.resolve(this.report(status, reason));
  }

  private report(status: RunStatus, reason: string): MonkeyReport {
    const ok = this.window.filter((s) => s.ok).length;
    return {
      mode: this.c.mode, status, reason, injections: this.injected, samples: this.total,
      successRate: this.window.length ? ok / this.window.length : 1, p95Ms: percentile(this.window.map((s) => s.ms), 95),
      startedAt: this.startedAt, endedAt: new Date(this.now()).toISOString(), audit: [...this.entries],
    };
  }
}
