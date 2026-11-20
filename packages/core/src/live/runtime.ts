// Live runtime: ties the runner pieces to the live server. Per-lane bot spawning, demo script playback, the wave
// clock, the ledger endpoint payload and the hardening spec reader. Spec: runtime.md sections 4, 16, 19; PROTOCOL.md.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HauntEvent } from '../../../haunt/src/score/score';
import { RunnerEngine, type EngineWaveSettings, type RunnerEngineOptions } from '../../../haunt/src/runner/engine';
import { prepareLane, tiersForLanes } from '../../../haunt/src/runner/lanes';
import { runLane, type LaneLoopOptions, type LaneLoopResult } from '../../../haunt/src/runner/loop';
import { BOSS_DURATION_MS, WaveClock } from '../../../haunt/src/runner/live';
import { RepeatDetector } from '../../../haunt/src/runner/provider';
import type { BossId } from '../../../haunt/src/chaos/catalog';
import type { LedgerRow } from '../provider';
import { loadDemo, type DemoScript } from './demo';
import type { LiveEngine } from './server';

export const HARDENING_FILES = ['requirements.md', 'design.md', 'tasks.md'] as const;

// ---- per-lane bot spawning ----

export interface BotCommand { command: string; args: string[]; env?: Record<string, string> }
export interface SpawnerOptions {
  engine: RunnerEngine;
  /** Command for the bot of a lane. Return undefined to leave a lane unspawned (for example no bot is built yet). */
  botCommand: (lane: string, wave: number, settings: EngineWaveSettings) => BotCommand | undefined;
  run?: (o: LaneLoopOptions) => Promise<LaneLoopResult>;
  onLaneExit?: (lane: string, result: LaneLoopResult) => void;
  onLaneError?: (lane: string, err: unknown) => void;
  /** Called once when every spawned lane loop has ended on its own. Not called after `stop` or when no lane was spawned. */
  onWaveDone?: (wave: number) => void;
  /** Bot event lines and runner process events for a lane, before the envelope. */
  onEvent?: (lane: string, ev: Record<string, unknown>) => void;
}

/** Starts `runLane` for every lane of a wave and aborts them all on stop. */
export class LaneSpawner {
  private ctl?: AbortController;
  private readonly senders = new Map<string, (m: Record<string, unknown>) => void>();
  /** Push a control line (for example a crash arm) to the lane's running bot. No-op when none runs. */
  send = (lane: string, m: Record<string, unknown>): void => { this.senders.get(lane)?.(m); };
  /** Settles when every lane loop of the current wave has ended. */
  done: Promise<void> = Promise.resolve();

  constructor(private readonly o: SpawnerOptions) {}

  start = (wave: number, settings: EngineWaveSettings, lanes: string[]): void => {
    this.stop();
    this.senders.clear();
    const ctl = new AbortController();
    this.ctl = ctl;
    const run = this.o.run ?? runLane;
    const loops: Promise<void>[] = [];
    const failed = (lane: string, e: unknown) => { this.o.onLaneError?.(lane, e); };
    for (const lane of lanes) {
      const cmd = this.o.botCommand(lane, wave, settings);
      if (!cmd) continue;
      loops.push(
        run({
          lane, director: this.o.engine.director, command: cmd.command, args: cmd.args, env: cmd.env, signal: ctl.signal,
          onEvent: (ev) => this.o.onEvent?.(lane, ev),
          onProcess: (send) => { this.senders.set(lane, send); },
          onKilled: (k) => this.o.onEvent?.(lane, { type: 'process_dead', detail: { reason: k.fired.fault, restartInMs: k.fired.restartMs } }),
          onStart: (n) => { if (n > 1) this.o.onEvent?.(lane, { type: 'process_up', detail: { attempt: n } }); },
        })
          .then((r) => this.o.onLaneExit?.(lane, r))
          .catch((e) => failed(lane, e)),
      );
    }
    this.done = Promise.all(loops).then(() => {
      if (loops.length > 0 && !ctl.signal.aborted) {
        this.ctl = undefined;
        this.o.onWaveDone?.(wave);
      }
    });
  };

  stop = (): void => {
    this.ctl?.abort();
    this.ctl = undefined;
  };
}

/** Bot command for a lane: process.execPath <botsDir>/<tier>.js with the runtime.md section 2 env. Undefined when that bot is not built. */
export interface BotCommandOptions { root: string; runDir: string; providerUrl: string; botsDir?: string }
export function makeBotCommand(o: BotCommandOptions): SpawnerOptions['botCommand'] {
  const botsDir = o.botsDir ?? join(o.root, 'dist', 'bots');
  const attempts = new Map<string, number>();
  return (lane, _wave, settings) => {
    const tier = tiersForLanes(settings.lanes, settings.tiers)[Number(lane) - 1];
    if (!tier) return undefined;
    const file = join(botsDir, `${tier.id}.js`);
    if (!existsSync(file)) return undefined;
    const { paths } = prepareLane(o.runDir, Number(lane), settings.seed, settings.orders);
    const attempt = (attempts.get(lane) ?? 0) + 1;
    attempts.set(lane, attempt);
    return {
      command: process.execPath,
      args: [file],
      env: {
        HAUNT_RUN_DIR: o.runDir, HAUNT_LANE: lane, HAUNT_TIER: tier.id, HAUNT_SEED: String(settings.seed),
        HAUNT_PROVIDER: o.providerUrl, HAUNT_ORDERS_DIR: paths.orders, HAUNT_SPEED: String(settings.speed),
        HAUNT_ATTEMPT: String(attempt), HAUNT_APP: settings.app,
      },
    };
  };
}

// ---- demo playback ----

/** Plays a demo script against the engine. Stepped with elapsed real ms; `start` attaches it to a timer. */
export class DemoPlayer {
  private next = 0;
  private phase: 'idle' | 'warned' | 'live' | 'done' = 'idle';
  private timer: ReturnType<typeof setInterval> | undefined;
  finished = false;

  constructor(
    private readonly engine: RunnerEngine,
    private readonly record: (ev: HauntEvent) => void,
    readonly script: DemoScript,
    private readonly speed = 1,
  ) {}

  /** Fire every press and boss phase due at `elapsedMs` real ms since playback start. Script times are 1x. */
  step(elapsedMs: number): void {
    const t = elapsedMs * this.speed;
    const { presses, boss } = this.script;
    while (this.next < presses.length && presses[this.next]!.atMs <= t) {
      const p = presses[this.next++]!;
      try {
        this.engine.chaos({ lane: p.lane, fault: p.fault, creature: p.creature, scope: p.scope, point: p.point });
      } catch { /* lane at the depth limit or not in the wave: a press is best effort */ }
    }
    if (boss) {
      if (this.phase === 'idle' && t >= boss.warnAtMs) {
        this.phase = 'warned';
        this.record({ type: 'boss_warning', detail: { boss: boss.id, startsInMs: Math.round((boss.startAtMs - boss.warnAtMs) / this.speed) } });
      }
      if (this.phase === 'warned' && t >= boss.startAtMs) {
        this.phase = 'live';
        this.record({ type: 'boss_start', detail: { boss: boss.id } });
        const lanes = Object.fromEntries(this.engine.lanes.map((l) => [l, { state: 'working' as const, stage: 'dispatch' }]));
        for (const { lane, req } of this.engine.director.bossArms(boss.id as BossId, lanes)) {
          try { this.engine.chaos({ lane: Number(lane), fault: req.fault, point: req.point, forMs: req.forMs, source: 'boss' }); } catch { /* depth limit */ }
        }
      }
      if (this.phase === 'live' && t >= boss.startAtMs + BOSS_DURATION_MS) {
        this.phase = 'done';
        this.record({ type: 'boss_end', detail: { boss: boss.id, durationMs: Math.round(BOSS_DURATION_MS / this.speed) } });
      }
    }
    this.finished = this.next >= presses.length && (!boss || this.phase === 'done');
  }

  start(now: () => number = Date.now): void {
    if (this.timer) return;
    const t0 = now();
    this.timer = setInterval(() => { this.step(now() - t0); if (this.finished) this.stop(); }, 50);
    (this.timer as { unref?: () => void }).unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}

// ---- ledger and hardening payloads ----

/** `GET /api/ledger` body: per lane, rows by kind with repeat counts (PROTOCOL.md). */
export function buildLedger(lanes: readonly string[], rowsOf: (lane: string) => LedgerRow[]): { lanes: unknown[] } {
  return {
    lanes: lanes.map((lane) => {
      const rows = rowsOf(lane);
      const det = new RepeatDetector();
      const repeatsByKind: Record<string, number> = {};
      const byKind: Record<string, { rows: number; repeats: number }> = {};
      for (const r of rows) {
        const e = (byKind[r.kind] ??= { rows: 0, repeats: 0 });
        e.rows++;
        const rep = det.add(r);
        if (rep) { e.repeats++; repeatsByKind[r.kind] = (repeatsByKind[r.kind] ?? 0) + 1; }
      }
      return { lane: Number(lane), byKind, rows };
    }),
  };
}

export interface HardeningBody { spec: string; title: string; files: { path: string; content: string }[] }

/**
 * Reads `<specsDir>/hardening-<run>/` for a run id, or the newest `hardening-*` folder when `run` is omitted.
 * Returns undefined when nothing is there yet, which the server maps to 404 not_ready.
 */
export function readHardening(specsDir: string, run?: string): HardeningBody | undefined {
  if (!existsSync(specsDir)) return undefined;
  const names = readdirSync(specsDir).filter((n) => /^hardening-[A-Za-z0-9._-]+$/.test(n)).sort();
  const spec = run ? names.find((n) => n === `hardening-${run}`) : names.at(-1);
  if (!spec) return undefined;
  const files = HARDENING_FILES.filter((f) => existsSync(join(specsDir, spec, f)))
    .map((f) => ({ path: `.kiro/specs/${spec}/${f}`, content: readFileSync(join(specsDir, spec, f), 'utf8') }));
  if (files.length === 0) return undefined;
  const heading = /^#\s+(.+)$/m.exec(files[0]!.content);
  return { spec, title: heading?.[1]?.trim() ?? spec, files };
}

// ---- composition ----

export interface LiveRuntimeOptions {
  botCommand?: SpawnerOptions['botCommand'];
  run?: SpawnerOptions['run'];
  /** Provider ledger rows for a lane. Omit and the ledger stays empty. */
  ledgerRows?: (lane: string) => LedgerRow[];
  /** Run random chaos and the boss schedule from the wave clock. Defaults to true. */
  clock?: boolean;
  post?: RunnerEngineOptions['post'];
}

/** The `LiveEngine` for `LiveServer`, plus the ledger payload function. */
export function createLiveRuntime(opts: LiveRuntimeOptions = {}) {
  let record: ((ev: HauntEvent) => void) | undefined;
  let endWave: (() => void) | undefined;
  let clock: WaveClock | undefined;
  let demo: DemoPlayer | undefined;
  let spawner: LaneSpawner | undefined;
  const engine: RunnerEngine = new RunnerEngine({
    post: opts.post,
    sendArm: (lane, arm) => spawner?.send(lane, arm),
    onWaveStart: (wave, settings, lanes) => {
      if (opts.clock !== false && record) {
        clock = new WaveClock({
          engine, record, wave, orders: settings.orders, seed: settings.seed,
          frequency: engine.chaosMode.frequency, speed: settings.speed,
          bossEnabled: () => engine.chaosMode.mode === 'random',
        });
        clock.start();
      }
      spawner?.start(wave, settings, lanes);
    },
    onWaveStop: () => { clock?.stop(); clock = undefined; demo?.stop(); demo = undefined; spawner?.stop(); },
  });
  if (opts.botCommand) {
    spawner = new LaneSpawner({
      engine, botCommand: opts.botCommand, run: opts.run,
      onEvent: (lane, ev) => { record?.({ detail: {}, ...ev, lane } as unknown as HauntEvent); },
      onWaveDone: () => { clock?.stop(); clock = undefined; demo?.stop(); demo = undefined; endWave?.(); },
    });
  }

  const live: LiveEngine = {
    startWave(wave, settings, rec, end) { record = rec; endWave = end; engine.startWave(wave, settings, rec); },
    stopWave: () => engine.stopWave(),
    setSpeed: (s) => engine.setSpeed(s),
    chaos: (req) => engine.chaos(req),
    setChaosMode: (m) => engine.setChaosMode(m),
    startDemo(script, speed) {
      if (!record) throw new Error('start a wave before the demo');
      demo?.stop();
      demo = new DemoPlayer(engine, record, loadDemo(script), speed ?? engine.speed);
      demo.start();
    },
    stopDemo() { demo?.stop(); demo = undefined; },
  };
  const ledger = () => buildLedger(engine.lanes, opts.ledgerRows ?? (() => []));
  return { engine, live, ledger, get spawner() { return spawner; } };
}
