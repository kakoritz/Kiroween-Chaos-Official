// Runner process loop for one lane: start the bot, serve the kill rendezvous, restart after the
// director's delay until the bot exits on its own. Spec: runtime.md sections 1 and 3.
import { BotProcess, serveRendezvous, type ChaosDirector, type Exit, type Killed } from '../chaos';
import { DecisionBroker, parseAsk, type DecisionAnswer, type DecisionAsk } from './decisions';

export interface LaneLoopOptions {
  lane: string;
  director: ChaosDirector;
  command: string;
  args: string[];
  env?: Record<string, string>;
  sleep?: (ms: number) => Promise<void>;
  /** Hard stop on restarts so a bot that always dies cannot loop forever. */
  maxStarts?: number;
  /** How long a bot may stay alive after `shutdown` before the runner kills it (default 5000). A bot that never exits would keep the wave from ending. */
  shutdownGraceMs?: number;
  /** How long a started bot may take to say `ready` before the runner kills it (default 5000). */
  readyTimeoutMs?: number;
  /** Aborting kills the current bot and ends the loop without a restart. */
  signal?: AbortSignal;
  onStart?: (n: number, pid: number) => void;
  onKilled?: (k: Killed) => void;
  onRestart?: (n: number, delayMs: number) => void;
  /** Event-shaped bot lines (with `type`), to be enveloped and forwarded as contract events (runtime.md section 2). */
  onEvent?: (ev: Record<string, unknown>) => void;
  /** Called with a sender for each new bot process, so the caller can push control lines (arm) mid-run. */
  onProcess?: (send: (m: Record<string, unknown>) => void) => void;
  /** The bot reached a hook (`at_point`). Runs before the rendezvous replies, so a file fault lands before the bot's next read. */
  onAtPoint?: (point: string, ctx: Record<string, unknown>) => void;
  /**
   * The bot found a wrong order and asks what to do (`{k:'decision_needed'}`). Resolve with the answer; the loop sends it
   * back as `{k:'decision'}`. Without it the loop decides at once with the bot's own default (source `default`), which is
   * what headless runs and sweeps do. `alive` tells whether the asking process can still hear the answer.
   */
  onDecision?: (ask: DecisionAsk, alive: () => boolean) => Promise<DecisionAnswer>;
}

export interface LaneLoopResult {
  starts: number;
  kills: Killed[];
  /** Exit of the last process. */
  exit: Exit;
  /** True when the last process left without a chaos kill. */
  clean: boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function runLane(o: LaneLoopOptions): Promise<LaneLoopResult> {
  const sleep = o.sleep ?? defaultSleep;
  const max = o.maxStarts ?? 10;
  const kills: Killed[] = [];
  // Headless decisions: nobody to ask, so the bot's own default applies at once (source `default`), once per wrong order.
  const headless = new DecisionBroker({ emit: (_lane, ev) => o.onEvent?.(ev as unknown as Record<string, unknown>), timeoutMs: () => 0 });
  for (let n = 1; ; n++) {
    if (o.signal?.aborted) return { starts: n - 1, kills, exit: { code: null, signal: null }, clean: false };
    const proc = new BotProcess(o.command, o.args, o.env);
    const onAbort = () => proc.kill();
    o.signal?.addEventListener('abort', onAbort, { once: true });
    o.onStart?.(n, proc.pid);
    let killed: Killed | null = null;
    if (o.onAtPoint) proc.onMessage((m) => { const msg = m as Record<string, unknown>; if (msg.k === 'at_point') o.onAtPoint!(String(msg.point), msg); });
    serveRendezvous(proc, o.director, o.lane, (k) => { killed = k; });
    proc.onMessage((m) => {
      const msg = m as Record<string, unknown>;
      if (typeof msg.type === 'string') o.onEvent?.(msg);
      else if (msg.k === 'idle') {
        proc.send({ k: 'shutdown' });
        const t = setTimeout(() => { if (proc.alive) proc.kill(); }, o.shutdownGraceMs ?? 5000);
        (t as { unref?: () => void }).unref?.();
        void proc.exited.then(() => clearTimeout(t));
      }
      else if (msg.k === 'decision_needed') {
        const ask = parseAsk(msg);
        if (!ask) return;
        const answer: Promise<DecisionAnswer> = o.onDecision
          ? o.onDecision(ask, () => proc.alive)
          : headless.ask(o.lane, ask, () => proc.alive);
        void answer.then((a) => proc.send({ k: 'decision', order: ask.order, choice: a.choice, source: a.source }));
      }
    });
    try {
      await proc.waitFor('ready', o.readyTimeoutMs ?? 5000);
    } catch (e) {
      proc.kill();
      o.signal?.removeEventListener('abort', onAbort);
      throw e;
    }
    proc.send({ k: 'go', arms: o.director.pendingArms(o.lane) });
    o.onProcess?.((m) => proc.send(m as never));
    const exit = await proc.exited;
    o.signal?.removeEventListener('abort', onAbort);
    if (o.signal?.aborted) return { starts: n, kills, exit, clean: false };
    // The kill callback runs on the same exit promise; give it a turn to land.
    await Promise.resolve();
    const k = killed as Killed | null;
    if (!k) return { starts: n, kills, exit, clean: true };
    kills.push(k);
    o.onKilled?.(k);
    if (n >= max) return { starts: n, kills, exit, clean: false };
    o.onRestart?.(n + 1, k.fired.restartMs);
    await sleep(k.fired.restartMs);
    o.director.processUp(o.lane);
  }
}
