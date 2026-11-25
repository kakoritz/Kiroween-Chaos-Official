// Live runtime: ties the runner pieces to the live server. Per-lane bot spawning, demo script playback, the wave
// clock, the ledger endpoint payload and the hardening spec reader. Spec: runtime.md sections 4, 16, 19; PROTOCOL.md.
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { HauntEvent } from '../../../haunt/src/score/score';
import { RunnerEngine, type EngineWaveSettings, type RunnerEngineOptions } from '../../../haunt/src/runner/engine';
import { corruptNext, hauntFile, injectDuplicate, lanePathsAt, prepareLane, restoreOrder, tiersForLanes, typoOrder } from '../../../haunt/src/runner/lanes';
import { runLane, type LaneLoopOptions, type LaneLoopResult } from '../../../haunt/src/runner/loop';
import { BOSS_DURATION_MS, WaveClock } from '../../../haunt/src/runner/live';
import { RepeatDetector, postProviderArm } from '../../../haunt/src/runner/provider';
import { DecisionBroker, type DecisionAnswer, type DecisionAsk } from '../../../haunt/src/runner/decisions';
import { DECISION_TIMEOUT_MS } from '../../../haunt/src/shared/catalog';
import { tierById } from '../../../haunt/src/pipeline/pipeline';
import { tierOfLane } from '../../../haunt/src/tournament/rounds';
import type { BossId } from '../../../haunt/src/chaos/catalog';
import type { LedgerRow } from '../provider';
import { DetailNormalizer, SettleGate } from './normalize';
import { APPS } from '../../../haunt/src/shared/catalog';
import { LaneTravel, travelAt } from '../../../haunt/src/runner/travel';
import { crewPartsEnv } from '../../../haunt/src/campaign/crew';
import { loadCampaign } from '../../../haunt/src/campaign/load';
import { planScripts } from '../../../haunt/src/campaign/wave-config';
import { loadDemo, type DemoPress, type DemoScript } from './demo';
import { inboxBotCommand, inboxTarget, writeInboxMail } from './inbox-command';
import { writeStreamJobs } from '../../../../apps/haunted-stream/src/jobs';
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
  /** The lane's bot reached a hook. `env` is the bot's environment (`HAUNT_ORDERS_DIR`, `HAUNT_SEED`). Runs before the bot is released. */
  onAtPoint?: (lane: string, point: string, ctx: Record<string, unknown>, env: Record<string, string>) => void;
  /** The lane's bot found a wrong order and asks for a decision. Without it each lane decides at once with the bot's default. */
  onDecision?: (lane: string, ask: DecisionAsk, alive: () => boolean, env: Record<string, string>) => Promise<DecisionAnswer>;
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
          ...(this.o.onAtPoint ? { onAtPoint: (point: string, ctx: Record<string, unknown>) => this.o.onAtPoint!(lane, point, ctx, cmd.env ?? {}) } : {}),
          ...(this.o.onDecision ? { onDecision: (ask: DecisionAsk, alive: () => boolean) => this.o.onDecision!(lane, ask, alive, cmd.env ?? {}) } : {}),
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
export interface BotCommandOptions {
  root: string; runDir: string; providerUrl: string; botsDir?: string;
  /** Called once per wave before its first lane spawns (runtime.md section 31: reset the provider). */
  onWave?: (wave: number) => void;
  /** Folder of per-lane policy overlays (`lane-<n>.policy.json`, TV3-C8). A lane with a file gets `HAUNT_POLICY`. */
  policyDir?: string;
  /** Bundle name to run instead of `<tier>` (for example `rookie.hardened` for the `loop` wave 2, runtime.md section 32). */
  bundleFor?: (lane: string, wave: number, tier: string) => string | undefined;
  /** Own-bot quickstart: run this command on every lane instead of a built bundle (docs/OWN-BOT.md). */
  custom?: { command: string; args: string[] };
}

/** Folder of one wave inside the run folder. Waves are isolated (runtime.md section 31). */
export const waveDir = (runDir: string, wave: number): string => join(runDir, `wave-${wave}`);

export function makeBotCommand(o: BotCommandOptions): SpawnerOptions['botCommand'] {
  const botsDir = o.botsDir ?? join(o.root, 'dist', 'bots');
  const attempts = new Map<string, number>();
  let lastWave = 0;
  return (lane, wave, settings) => {
    if (wave !== lastWave) {
      // A wave starts clean: a journal or done/ left by an earlier server run would make a journaled bot skip every order.
      lastWave = wave;
      attempts.clear();
      rmSync(waveDir(o.runDir, wave), { recursive: true, force: true });
      o.onWave?.(wave);
    }
    const tier = settings.tournament
      ? tierById(tierOfLane(Number(lane)))
      : tiersForLanes(settings.lanes, settings.tiers, settings.campaign ? { parts: settings.campaign.parts } : undefined)[Number(lane) - 1];
    if (!tier) return undefined;
    const bundle = o.bundleFor?.(lane, wave, tier.id) ?? tier.id;
    // The Stream app has its own bundles, built next to the orders ones (stream-pack-app SP-C3).
    const file = settings.app === 'stream' ? join(o.root, 'dist', 'stream-bots', `${tier.id}.js`) : join(botsDir, `${bundle}.js`);
    // SH-C6: the inbox app runs the Python bot for real; without Python it falls back to the built TypeScript bots.
    const inbox = settings.app === 'inbox' ? inboxTarget(o.root, tier.id) : undefined;
    if (!inbox && !o.custom && !existsSync(file)) return undefined;
    const dir = waveDir(o.runDir, wave);
    const { paths } = prepareLane(dir, Number(lane), settings.seed, settings.orders);
    const attempt = (attempts.get(lane) ?? 0) + 1;
    attempts.set(lane, attempt);
    if (inbox) writeInboxMail(paths.orders, settings.orders, inbox.corpus);
    if (settings.app === 'stream') writeStreamJobs(paths.orders, settings.orders);
    const env = {
      HAUNT_RUN_DIR: dir, HAUNT_LANE: lane, HAUNT_TIER: tier.id, HAUNT_SEED: String(settings.seed),
      HAUNT_PROVIDER: o.providerUrl, HAUNT_ORDERS_DIR: paths.orders, HAUNT_SPEED: String(settings.speed),
      HAUNT_ATTEMPT: String(attempt), HAUNT_APP: settings.app,
      ...(o.policyDir && existsSync(join(o.policyDir, `lane-${lane}.policy.json`)) ? { HAUNT_POLICY: join(o.policyDir, `lane-${lane}.policy.json`) } : {}),
      ...(tier.id === 'crew' ? { HAUNT_PARTS: crewPartsEnv(tier.use) } : {}),
    };
    if (o.custom) return { command: o.custom.command, args: o.custom.args, env };
    if (inbox) return inboxBotCommand(inbox, env);
    return { command: process.execPath, args: [file], env };
  };
}

// ---- demo playback ----

/** Plays a demo script against the engine. Stepped with elapsed real ms; `start` attaches it to a timer. */
export class DemoPlayer {
  private phase: 'idle' | 'warned' | 'live' | 'done' = 'idle';
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastT = 0;
  /** Per press: `firedAt` (1x ms) once fired, `dueAt` once a `when` matched and is waiting out its delay. */
  private readonly st: { firedAt?: number; dueAt?: number; orders: Set<string> }[];
  finished = false;

  constructor(
    private readonly engine: RunnerEngine,
    private readonly record: (ev: HauntEvent) => void,
    readonly script: DemoScript,
    private readonly speed = 1,
  ) {
    this.st = script.presses.map(() => ({ orders: new Set<string>() }));
  }

  private fire(i: number, t: number): void {
    const p = this.script.presses[i]!;
    this.st[i]!.firedAt = t;
    try {
      this.engine.chaos({
        lane: p.lane, fault: p.fault, creature: p.creature, scope: p.scope, point: p.point,
        ...(p.outageMs !== undefined ? { outageMs: p.outageMs } : {}), source: p.fuzz ? ('fuzz' as const) : ('demo' as const), ...(p.fuzz ? { fuzz: p.fuzz } : {}),
      });
    } catch { /* lane at the depth limit or not in the wave: a press is best effort */ }
  }

  /** Feed a wave event. A `when` press arms on the first matching event after the previous `when` press of its lane. */
  observe(ev: { type?: string; lane?: unknown; stage?: unknown; order?: unknown; detail?: unknown }): void {
    const { presses } = this.script;
    for (let i = 0; i < presses.length; i++) {
      const p = presses[i]!;
      const w = p.when;
      const s = this.st[i]!;
      if (!w || (s.firedAt !== undefined && !p.forEachOrder) || s.dueAt !== undefined && !p.forEachOrder) continue;
      // Per lane: an earlier unfired loose `when` press of the same lane goes first. A press pinned to an order and a stage
      // (a tournament plan) needs no queue: it matches exactly one event, and a queue would freeze the whole lane behind one
      // press that can never match (a second press at an earlier stage of the same order).
      const pinned = (q: DemoPress): boolean => q.when?.order !== undefined && q.when.stage !== undefined;
      if (!pinned(p) && presses.some((q, j) => j < i && q.when?.lane === w.lane && !pinned(q) && this.st[j]!.firedAt === undefined && this.st[j]!.dueAt === undefined && !q.forEachOrder)) continue;
      if (ev.type !== w.event || String(ev.lane) !== String(w.lane)) continue;
      if (w.stage !== undefined && ev.stage !== w.stage) continue;
      if (w.order !== undefined && ev.order !== w.order) continue;
      if (w.attempt !== undefined && (ev.detail as { attempt?: number } | undefined)?.attempt !== w.attempt) continue;
      if (p.forEachOrder) {
        const o = String(ev.order ?? '');
        if (s.orders.has(o)) continue;
        s.orders.add(o);
      }
      s.dueAt = this.lastT + (p.delayMs ?? 0);
      // No delay: press now, inside the event that matched. A stage lasts only its work time at speed 4, so waiting for the next tick can miss it.
      if (!p.delayMs) {
        if (p.forEachOrder) s.dueAt = undefined;
        this.fire(i, this.lastT);
      }
      if (!p.forEachOrder && !pinned(p)) break;
    }
  }

  /** Fire every press and boss phase due at `elapsedMs` real ms since playback start. Script times are 1x. */
  step(elapsedMs: number): void {
    const t = elapsedMs * this.speed;
    this.lastT = t;
    const { presses, boss } = this.script;
    for (let i = 0; i < presses.length; i++) {
      const p = presses[i]!;
      const s = this.st[i]!;
      if (p.when) {
        if (s.dueAt !== undefined && t >= s.dueAt) {
          s.dueAt = p.forEachOrder ? undefined : s.dueAt;
          if (p.forEachOrder || s.firedAt === undefined) this.fire(i, t);
        }
      } else if (s.firedAt === undefined) {
        const prev = p.afterPrevMs !== undefined ? this.st[i - 1]!.firedAt : undefined;
        const due = p.afterPrevMs !== undefined ? (prev === undefined ? Infinity : prev + p.afterPrevMs) : (p.atMs ?? Infinity);
        if (t >= due) this.fire(i, t);
      }
    }
    if (boss) {
      if (this.phase === 'idle' && t >= boss.warnAtMs) {
        this.phase = 'warned';
        this.record({ type: 'boss_warning', detail: { boss: boss.id, startsInMs: Math.round((boss.startAtMs - boss.warnAtMs) / this.speed) } });
      }
      if (this.phase === 'warned' && t >= boss.startAtMs) {
        this.phase = 'live';
        this.record({ type: 'boss_start', detail: { boss: boss.id } });
        const lanes = Object.fromEntries(this.engine.lanes.map((l) => [l, { state: 'working' as const, stage: 'ship' }]));
        for (const { lane, req } of this.engine.director.bossArms(boss.id as BossId, lanes)) {
          try { this.engine.chaos({ lane: Number(lane), fault: req.fault, point: req.point, forMs: req.forMs, source: 'boss' }); } catch { /* depth limit */ }
        }
      }
      if (this.phase === 'live' && t >= boss.startAtMs + BOSS_DURATION_MS) {
        this.phase = 'done';
        this.record({ type: 'boss_end', detail: { boss: boss.id, durationMs: Math.round(BOSS_DURATION_MS / this.speed) } });
      }
    }
    this.finished = presses.every((p, i) => !p.forEachOrder && this.st[i]!.firedAt !== undefined) && (!boss || this.phase === 'done');
  }

  start(now: () => number = Date.now): void {
    if (this.timer) return;
    const t0 = now();
    // 10 ms ticks: at speed 4 a stage lasts about 75 ms, so a 50 ms tick let presses land after the stage had ended.
    this.timer = setInterval(() => { this.step(now() - t0); if (this.finished) this.stop(); }, 10);
    (this.timer as { unref?: () => void }).unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}

// ---- ledger and hardening payloads ----

/** Provider ledger kind to contract effect kind (CONTRACT.md: account_create | charge | email | dispatch | notify | ticket; v1.2 adds order and store). */
const EFFECT_KIND: Record<string, string> = { account: 'account_create', reply: 'email' };

/** `GET /api/ledger` body: per lane, rows by kind with repeat counts (PROTOCOL.md). */
export function buildLedger(lanes: readonly string[], rowsOf: (lane: string) => LedgerRow[]): { lanes: unknown[] } {
  return {
    lanes: lanes.map((lane) => {
      const rows = rowsOf(lane);
      const det = new RepeatDetector();
      const repeatsByKind: Record<string, number> = {};
      const byKind: Record<string, { rows: number; repeats: number }> = {};
      for (const r of rows) {
        // Same names as the `effect` events (reply is an email, account is account_create), so the arena's columns agree with its live counts.
        const wire = EFFECT_KIND[r.kind] ?? r.kind;
        const e = (byKind[wire] ??= { rows: 0, repeats: 0 });
        e.rows++;
        const rep = det.add(r);
        if (rep) { e.repeats++; repeatsByKind[wire] = (repeatsByKind[wire] ?? 0) + 1; }
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
  /** Starting chaos mode. Defaults to `random`: the intensity dial drives the creatures. `manual` waits for explicit presses. */
  chaosMode?: 'off' | 'manual' | 'random';
  post?: RunnerEngineOptions['post'];
  /** Events about the finished wave, emitted before the next `wave_start`. */
  betweenWaves?: LiveEngine['betweenWaves'];
  /** Enforce travel gaps between a lane's events (contract rule 40). Defaults to true; false passes bot events through. */
  travel?: boolean;
  /** Clock and sleep for the travel scheduler (tests). */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** The `LiveEngine` for `LiveServer`, plus the ledger payload function. */
export function createLiveRuntime(opts: LiveRuntimeOptions = {}) {
  let record: ((ev: HauntEvent) => void) | undefined;
  let endWave: (() => void) | undefined;
  let clock: WaveClock | undefined;
  let demo: DemoPlayer | undefined;
  // Campaign night plan (CP-C2): one player per script, started with the wave when `settings.campaign` is set.
  let night: DemoPlayer[] = [];
  const stopNight = (): void => { for (const p of night) p.stop(); night = []; laneStage.clear(); laneSeen.clear(); };
  const startNight = (settings: EngineWaveSettings): void => {
    stopNight();
    if (!settings.campaign || !record) return;
    const n = loadCampaign().nights.find((x) => x.id === settings.campaign!.night);
    if (!n) return;
    night = planScripts(n).map((s) => new DemoPlayer(engine, record!, s as DemoScript, engine.speed));
    for (const p of night) p.start();
  };
  // Campaign nights press provider faults mid-stage, so the engine must know the stage a lane is in (and release deferred faults).
  const laneStage = new Map<string, string>();
  // The stage a lane was last seen in until its order ends: between two stages the lane travels, and the director still needs a stage to press at.
  const laneSeen = new Map<string, string>();
  // A tournament round presses faults by stage too, so it tracks the lane stage the same way.
  let tourneyOn = false;
  let dialBeforeTournament: ReturnType<RunnerEngine['getIntensity']> | undefined;
  // The seeded director (intensity dial) runs in random mode, except while a scripted demo, a campaign night or a tournament round owns the wave: their presses are the story.
  const directorOn = (): boolean => engine.chaosMode.mode === 'random' && night.length === 0 && !demo && !tourneyOn;
  const trackNight = (e: { type?: string; lane?: unknown; stage?: unknown }): void => {
    if (e.lane === undefined) return;
    const lane = String(e.lane);
    if (e.type === 'stage_start' && typeof e.stage === 'string') {
      laneStage.set(lane, e.stage);
      laneSeen.set(lane, e.stage);
      if (opts.post) for (const arm of engine.director.onStageStart(lane, e.stage)) void postProviderArm(opts.post, lane, e.stage, arm);
    } else if (e.type === 'stage_done' || e.type === 'order_done' || e.type === 'order_failed' || e.type === 'order_parked') laneStage.delete(lane);
    // The director's stack empties as the story moves on (design.md section 5): a stage that completed drops its fired faults, an order that ended drops what never fired.
    // Without it the stack fills to the depth limit and the lane gets no more creatures for the rest of the wave.
    if (e.type === 'order_done' || e.type === 'order_failed' || e.type === 'order_parked' || e.type === 'order_quarantined') laneSeen.delete(lane);
    try {
      if (e.type === 'stage_done' || e.type === 'stage_fail') engine.director.stageComplete(lane);
      else if (e.type === 'order_done' || e.type === 'order_failed' || e.type === 'order_parked' || e.type === 'order_quarantined') engine.director.orderEnd(lane);
    } catch { /* a lane the director does not know */ }
  };
  let spawner: LaneSpawner | undefined;
  let curApp = 'orders';
  let curPace = 'normal';
  let resetTravel: () => void = () => {};
  const norm = new DetailNormalizer();
  let gate: SettleGate | undefined;
  // Wrong order (design.md section 8): the broker owns each decision from `decision_needed` to `decision_made`.
  let botEvent: (lane: string, ev: Record<string, unknown>) => void | Promise<void> = () => {};
  const laneEnv = new Map<string, Record<string, string>>();
  const decisions = new DecisionBroker({
    emit: (lane, ev) => botEvent(lane, ev as unknown as Record<string, unknown>),
    timeoutMs: () => Math.max(1, Math.round(DECISION_TIMEOUT_MS / (engine.speed || 1))),
    onResolved: (lane, order, a) => {
      // A redo runs the order again from the file the customer actually sent.
      const env = laneEnv.get(lane);
      if (a.choice === 'redo' && env?.HAUNT_ORDERS_DIR) restoreOrder(lanePathsAt(dirname(env.HAUNT_ORDERS_DIR)), order);
    },
  });
  // Ledger rows become `repeat` events for the running wave (design.md section 8: repeats feed the wave grade).
  const repeats = new RepeatDetector();
  // Set once the bot spawner exists: runs `fn` after the lane's queued bot events, so a provider effect cannot overtake the lane's `process_up` (rule 6).
  let onLaneQueue: ((lane: string, fn: () => void) => boolean) | undefined;
  const ledgerRow = (row: LedgerRow, replayed = false): void => {
    if (!record) return;
    if (onLaneQueue?.(String(row.lane), () => ledgerRowNow(row, replayed))) return;
    ledgerRowNow(row, replayed);
  };
  const ledgerRowNow = (row: LedgerRow, replayed: boolean): void => {
    if (!record) return;
    const kind = EFFECT_KIND[row.kind] ?? row.kind;
    const key = row.key ?? (row.index === null || row.index === undefined ? `${row.order}:${row.kind}` : `${row.order}:${row.kind}:${row.index}`);
    // PROTOCOL.md rule 8: every provider row is an `effect`, and its `repeat` follows it immediately.
    record({ type: 'effect', lane: row.lane, order: row.order, detail: { kind, key, replayed, ...(typeof row.amount === 'number' ? { amount: row.amount } : {}) } } as HauntEvent);
    if (replayed) return;
    const r = repeats.add(row);
    if (r) record({ type: 'repeat', lane: row.lane, order: row.order, detail: { kind, key: r.key, count: r.count } } as HauntEvent);
  };
  const engine: RunnerEngine = new RunnerEngine({
    post: opts.post,
    laneInfo: (lane) => ({ state: 'working', stage: laneStage.get(lane) ?? null }),
    sendArm: (lane, arm) => spawner?.send(lane, arm),
    onWaveStart: (wave, settings, lanes) => {
      repeats.reset();
      if (opts.clock !== false && record) {
        clock = new WaveClock({
          engine, record, wave, orders: settings.orders, seed: settings.seed,
          frequency: engine.chaosMode.frequency, speed: settings.speed, show: true,
          laneInfo: (lane) => ({ state: 'working', stage: laneSeen.get(lane) ?? null }),
          randomEnabled: directorOn, bossEnabled: directorOn,
        });
        clock.start();
      }
      spawner?.start(wave, settings, lanes);
    },
    onWaveStop: () => { tourneyOn = false; clock?.stop(); clock = undefined; demo?.stop(); demo = undefined; stopNight(); spawner?.stop(); },
  });
  engine.setChaosMode({ mode: opts.chaosMode ?? 'random', frequency: engine.chaosMode.frequency, seed: engine.chaosMode.seed });
  if (opts.botCommand) {
    // Server-enforced travel gaps (contract rule 40): a per-lane queue holds each bot event until its gap has passed.
    const chains = new Map<string, Promise<void>>();
    const travels = new Map<string, LaneTravel>();
    let epoch = 0;
    const travelOf = (lane: string): LaneTravel => {
      let t = travels.get(lane);
      if (!t) {
        const stages = APPS[(curApp as keyof typeof APPS)]?.stages ?? APPS.orders.stages;
        t = new LaneTravel(() => travelAt(curPace, engine.speed), stages[stages.length - 1]!.id, opts.now, opts.sleep);
        travels.set(lane, t);
      }
      return t;
    };
    // A recorder that throws on one event must not reject the lane's chain: a rejected chain skips every later event of the lane and keeps `idle` from ever settling, so the wave never ends.
    const safe = (fn: () => void): void => { try { fn(); } catch (e) { console.error('[live] dropped an event after an error:', e); } };
    const idle = (): Promise<unknown> => Promise.allSettled([...chains.values()]);
    spawner = new LaneSpawner({
      engine, botCommand: opts.botCommand, run: opts.run,
      // order_typo (design.md section 8): at the bot's `input_read` the next order file is swapped for a different cart,
      // and the provider is told to complain about that order, before the bot reads it.
      onAtPoint: (lane, point, ctx, env) => {
        laneEnv.set(lane, env);
        if (point !== 'input_read' || typeof ctx.order !== 'string' || !env.HAUNT_ORDERS_DIR) return;
        const paths = lanePathsAt(dirname(env.HAUNT_ORDERS_DIR));
        if (!existsSync(join(paths.orders, `${ctx.order}.json`))) return;
        const arm = engine.director.onInputRead(lane, ctx.order);
        if (!arm) return;
        // Input faults (campaign night 3): the order file is changed just before the bot reads it.
        if (arm.fault === 'missing_file') {
          const restore = hauntFile(paths, `${ctx.order}.json`);
          const t = setTimeout(restore, Math.max(50, Math.round((arm.forMs ?? 6000) / (engine.speed || 1))));
          (t as { unref?: () => void }).unref?.();
          return;
        }
        if (arm.fault === 'duplicate_request') { injectDuplicate(paths); return; }
        if (arm.fault === 'malformed_payload') { corruptNext(paths); return; }
        typoOrder(paths, ctx.order, env.HAUNT_SEED ?? '1');
        if (opts.post) void postProviderArm(opts.post, lane, 'create', arm);
      },
      onDecision: (lane, ask, alive, env) => {
        laneEnv.set(lane, env);
        return decisions.ask(lane, ask, alive);
      },
      onEvent: botEvent = (lane, ev) => {
        // A fault pressed by hand that waits for a later stage (director deferred) reaches the provider when the bot itself gets there:
        // the bot runs ahead of what the arena shows, so waiting for the shown stage_start would be too late.
        if (opts.post && ev.type === 'stage_start' && typeof ev.stage === 'string') for (const arm of engine.director.onStageStart(lane, ev.stage)) void postProviderArm(opts.post, lane, ev.stage, arm);
        if (opts.travel === false) { for (const e of norm.shape(lane, { detail: {}, ...ev, lane })) safe(() => record?.({ ...e, lane } as unknown as HauntEvent)); return; }
        const my = epoch;
        const lt = travelOf(lane);
        const next = (chains.get(lane) ?? Promise.resolve()).then(async () => {
          if (my !== epoch) return;
          // Wait per shaped event: a replayed `stage_done{skipped}` becomes a `stage_start` + `stage_done` pair, and that `stage_start` owes its gap too.
          for (const e of norm.shape(lane, { detail: {}, ...ev, lane })) {
            await lt.wait(e);
            if (my !== epoch) return;
            safe(() => record?.(lt.annotate({ ...e, lane }) as unknown as HauntEvent));
          }
        });
        chains.set(lane, next);
        return next;
      },
      onWaveDone: () => {
        // The drain can outlive a stop + start: only the wave that began it may end the current one.
        const my = epoch;
        void idle().then(() => { if (my !== epoch) return; clock?.stop(); clock = undefined; demo?.stop(); demo = undefined; stopNight(); gate?.finish(); endWave?.(); });
      },
    });
    resetTravel = () => { epoch++; chains.clear(); travels.clear(); };
    onLaneQueue = (lane, fn) => {
      if (opts.travel === false || !chains.has(lane)) return false;
      const my = epoch;
      chains.set(lane, chains.get(lane)!.then(() => { if (my === epoch) safe(fn); }));
      return true;
    };
  }

  const live: LiveEngine = {
    startWave(wave, settings, rec, end) {
      resetTravel();
      decisions.clear();
      laneEnv.clear();
      curApp = settings.app;
      curPace = settings.pace;
      norm.begin(settings.orders);
      const g = new SettleGate((e) => rec(e as unknown as HauntEvent));
      gate = g;
      record = (e) => {
        // A campaign night presses by stage, so the lane's stage must already be the stage that just started when its plan reads the event (otherwise a press lands on the next order).
        const night1 = night.length > 0;
        if (night1) trackNight(e as never);
        engine.observe(e as unknown as HauntEvent); g.push(e as unknown as Record<string, any>); demo?.observe(e as never); for (const p of night) p.observe(e as never);
        if (!night1) trackNight(e as never);
      };
      endWave = end;
      engine.startWave(wave, settings, record);
      startNight(settings);
      tourneyOn = !!settings.tournament;
      if (!settings.tournament && dialBeforeTournament) {
        // The first wave after a tournament: the dial goes back to where the player left it, so a plain wave is not run at the last round's level.
        const d = dialBeforeTournament;
        dialBeforeTournament = undefined;
        engine.setIntensity(d.level, { autoRamp: d.autoRamp, everyN: d.everyN, max: d.max });
        record({ type: 'intensity', detail: { level: d.level, source: 'plan', autoRamp: d.autoRamp } } as unknown as HauntEvent);
      }
      if (settings.tournament) {
        // Tournament round: the dial goes to the round's level and every live lane meets the one seeded storm.
        dialBeforeTournament ??= engine.getIntensity();
        engine.setIntensity(settings.tournament.level);
        record({ type: 'intensity', detail: { level: settings.tournament.level, source: 'plan', autoRamp: false } } as unknown as HauntEvent);
        demo?.stop();
        demo = new DemoPlayer(engine, record, settings.tournament.script as DemoScript, engine.speed);
        demo.start();
      }
    },
    betweenWaves: opts.betweenWaves,
    stopWave: () => { resetTravel(); decisions.clear(); engine.stopWave(); },
    setSpeed: (s) => engine.setSpeed(s),
    chaos: (req) => engine.chaos(req),
    decide: (lane, order, choice) => decisions.answer(String(lane), order, choice),
    setChaosMode: (m) => engine.setChaosMode(m),
    setIntensity: (level, o) => engine.setIntensity(level, o),
    addCurse: (lane, kind, endpoint, source) => engine.addCurse(lane, kind, endpoint, source),
    endCurse: (lane, id) => engine.endCurse(lane, id),
    clearCurses: () => engine.clearCurses(),
    bindEmit: (fn) => engine.bindEmit(fn),
    assignCurses: (lanes, level, seed, round) => engine.assignCurses(lanes, level, seed, round),
    getIntensity: () => engine.getIntensity(),
    assertFloor: () => engine.assertFloor(),
    startDemo(script, speed) {
      if (!record) throw new Error('start a wave before the demo');
      demo?.stop();
      demo = new DemoPlayer(engine, record, loadDemo(script), speed ?? engine.speed);
      demo.start();
    },
    stopDemo() { demo?.stop(); demo = undefined; },
  };
  const ledger = () => buildLedger(engine.lanes, opts.ledgerRows ?? (() => []));
  return { engine, live, ledger, ledgerRow, get spawner() { return spawner; } };
}
