// `haunt watch` (PK-C6): non-stop chaos. Rounds of chaos run back to back at a chosen speed (1x to 100x in test modes, 1x only in
// prod-guarded). Each round's events go through the pattern miner into `.haunt/patterns.json`; when a pattern qualifies a fix spec is
// written with the same writer the tournament uses. A rolling report is rewritten after every round. Stops cleanly on stop() or SIGINT.
// Node only (file output). Spec: .kiro/specs/packs/spec.md section 5, guard rail 7.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { minePatterns, PatternStore, qualifies, type Pattern } from '../miner/patterns';
import { writeFixSpec } from '../miner/specs';
import type { Ev } from '../tournament/rp';
import type { MonkeyMode } from './config';
import type { RunStatus } from './monkey';

export const WATCH_SPEED = { min: 1, max: 100 } as const;
/** Milliseconds between rounds at 1x. A round at speed N waits roundMs / N. */
export const WATCH_ROUND_MS = 5_000;

/** Null when the mode and speed may run; otherwise why not. prod-guarded is 1x only: speeding up real-environment chaos is never allowed. */
export function checkWatch(mode: MonkeyMode, speed: number): string | null {
  if (!Number.isFinite(speed) || speed < WATCH_SPEED.min || speed > WATCH_SPEED.max) return `speed ${speed} is outside ${WATCH_SPEED.min}x to ${WATCH_SPEED.max}x`;
  if (mode === 'prod-guarded' && speed !== 1) return `prod-guarded runs at 1x only (asked for ${speed}x)`;
  return null;
}

export interface RoundResult {
  /** Events this round left behind, in the shape the pattern miner reads. */
  events: Ev[];
  status?: RunStatus;
  reason?: string;
  injections?: number;
  samples?: number;
  successRate?: number;
}
export interface RoundContext { index: number; speed: number; mode: MonkeyMode; signal: AbortSignal }
export type RoundRunner = (ctx: RoundContext) => Promise<RoundResult>;

export interface RoundSummary { round: number; at: string; status: string; injections: number; samples: number; successRate: number; newPatterns: number; reason?: string }
export interface WatchReport {
  mode: MonkeyMode;
  speed: number;
  runId: string;
  startedAt: string;
  updatedAt: string;
  running: boolean;
  rounds: number;
  errors: number;
  injections: number;
  samples: number;
  /** Success rate over the rolling window of rounds (samples weighted). */
  rollingSuccessRate: number;
  patterns: { total: number; qualifying: number };
  specs: string[];
  recent: RoundSummary[];
  stopReason?: string;
}

export interface WatchOptions {
  mode: MonkeyMode;
  speed?: number;
  round: RoundRunner;
  store: PatternStore;
  /** Where fix specs go (`.kiro/specs`). Omit to mine without writing specs. */
  specsDir?: string;
  /** Rolling report file (JSON), rewritten every round. */
  reportFile?: string;
  runId?: string;
  roundMs?: number;
  /** Stop by itself after this many rounds (tests, CI). */
  maxRounds?: number;
  /** Rounds kept in the rolling window. */
  windowRounds?: number;
  log?: (line: string) => void;
}

const stamp = (ms: number): string => new Date(ms).toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);

export class Watch {
  private readonly speed: number;
  private readonly roundMs: number;
  private readonly runId: string;
  private readonly abort = new AbortController();
  private readonly recent: RoundSummary[] = [];
  private readonly specs: string[] = [];
  private readonly specced = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;
  private wake?: () => void;
  private stopping = false;
  private stopReason = '';
  private done?: Promise<WatchReport>;
  private startedAt = '';
  private rounds = 0;
  private errors = 0;
  private injections = 0;
  private samples = 0;
  private running = false;

  constructor(private readonly o: WatchOptions) {
    this.speed = o.speed ?? 1;
    const bad = checkWatch(o.mode, this.speed);
    if (bad) throw new Error(bad);
    this.roundMs = o.roundMs ?? WATCH_ROUND_MS;
    this.runId = o.runId ?? `watch-${stamp(Date.now())}`;
  }

  get active(): boolean { return this.running && !this.stopping; }

  /** Runs rounds until stop() or maxRounds. Resolves with the final report. */
  start(): Promise<WatchReport> {
    if (!this.done) {
      this.startedAt = new Date().toISOString();
      this.running = true;
      this.done = this.loop();
    }
    return this.done;
  }

  /** The kill switch of the watch: aborts the round in flight (its monkey removes every injection) and ends the loop. */
  stop(reason = 'stopped'): void {
    if (this.stopping) return;
    this.stopping = true;
    this.stopReason = reason;
    this.abort.abort();
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    this.wake?.();
  }

  heartbeat(): void { /* the watch loop is its own controller */ }

  report(): WatchReport {
    const ps = this.o.store.list();
    const win = this.recent.filter((r) => r.samples > 0);
    const n = win.reduce((s, r) => s + r.samples, 0);
    return {
      mode: this.o.mode, speed: this.speed, runId: this.runId, startedAt: this.startedAt, updatedAt: new Date().toISOString(), running: this.active,
      rounds: this.rounds, errors: this.errors, injections: this.injections, samples: this.samples,
      rollingSuccessRate: n ? win.reduce((s, r) => s + r.successRate * r.samples, 0) / n : 1,
      patterns: { total: ps.length, qualifying: ps.filter(qualifies).length },
      specs: [...this.specs], recent: [...this.recent],
      ...(this.stopReason ? { stopReason: this.stopReason } : {}),
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise<void>((res) => {
      this.wake = res;
      this.timer = setTimeout(() => { this.timer = undefined; res(); }, ms);
    });
  }

  private async loop(): Promise<WatchReport> {
    const max = this.o.maxRounds ?? Infinity;
    const log = this.o.log ?? ((): void => {});
    log(`watch ${this.o.mode} at ${this.speed}x: a round every ${Math.max(1, Math.round(this.roundMs / this.speed))} ms (run ${this.runId})`);
    try {
      while (!this.stopping && this.rounds < max) {
        await this.oneRound(log);
        if (this.stopping || this.rounds >= max) break;
        await this.sleep(Math.max(1, Math.round(this.roundMs / this.speed)));
      }
    } finally {
      if (this.timer) clearTimeout(this.timer);
      this.timer = undefined;
      if (!this.stopReason) this.stopReason = `reached ${max} rounds`;
      this.running = false;
      this.write();
    }
    return this.report();
  }

  private async oneRound(log: (s: string) => void): Promise<void> {
    const index = this.rounds + 1;
    let res: RoundResult;
    try {
      res = await this.o.round({ index, speed: this.speed, mode: this.o.mode, signal: this.abort.signal });
    } catch (e) {
      this.errors++; this.rounds++;
      log(`round ${index} failed: ${(e as Error).message}`);
      this.recent.push({ round: index, at: new Date().toISOString(), status: 'error', injections: 0, samples: 0, successRate: 1, newPatterns: 0, reason: (e as Error).message });
      this.trim(); this.write();
      return;
    }
    this.rounds++;
    this.injections += res.injections ?? 0;
    this.samples += res.samples ?? 0;
    const runKey = `${this.runId}#${index}`;
    const changes = this.o.store.ingest(minePatterns({ run: this.runId, round: index, events: res.events }), runKey);
    this.recent.push({
      round: index, at: new Date().toISOString(), status: res.status ?? 'completed', injections: res.injections ?? 0, samples: res.samples ?? 0,
      successRate: res.successRate ?? 1, newPatterns: changes.filter((c) => c.kind === 'new' || c.kind === 'regressed').length, ...(res.reason ? { reason: res.reason } : {}),
    });
    this.trim();
    this.writeSpecs(log);
    this.write();
  }

  private trim(): void { const w = this.o.windowRounds ?? 50; while (this.recent.length > w) this.recent.shift(); }

  /** A spec for patterns that qualify and have not been specced yet (or that regressed: status back to new after a verify). */
  private writeSpecs(log: (s: string) => void): void {
    if (!this.o.specsDir) return;
    const all = this.o.store.list();
    for (const p of all) if (p.status !== 'new') this.specced.delete(p.id);
    const fresh: Pattern[] = all.filter((p) => qualifies(p) && p.status === 'new' && !this.specced.has(p.id));
    if (!fresh.length) return;
    const n = this.specs.length + 1;
    const w = writeFixSpec(this.o.specsDir, { runId: `${this.runId}-${n}`, patterns: fresh, plan: `haunt watch --mode ${this.o.mode} --speed ${this.speed}` });
    for (const p of fresh) this.specced.add(p.id);
    this.o.store.setStatuses(w.included.map((p) => p.id), 'suggested');
    this.specs.push(w.dir);
    log(`spec written: ${w.dir} (${w.included.length} fix${w.included.length === 1 ? '' : 'es'}${w.refused.length ? `, ${w.refused.length} not proposed` : ''}${w.lint.ok ? '' : ', LINT FAILED'})`);
  }

  private write(): void {
    if (!this.o.reportFile) return;
    mkdirSync(dirname(this.o.reportFile), { recursive: true });
    writeFileSync(this.o.reportFile, JSON.stringify(this.report(), null, 2) + '\n');
  }
}
