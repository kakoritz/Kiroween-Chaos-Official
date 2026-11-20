// Runner process loop for one lane: start the bot, serve the kill rendezvous, restart after the
// director's delay until the bot exits on its own. Spec: runtime.md sections 1 and 3.
import { BotProcess, serveRendezvous, type ChaosDirector, type Exit, type Killed } from '../chaos';

export interface LaneLoopOptions {
  lane: string;
  director: ChaosDirector;
  command: string;
  args: string[];
  env?: Record<string, string>;
  sleep?: (ms: number) => Promise<void>;
  /** Hard stop on restarts so a bot that always dies cannot loop forever. */
  maxStarts?: number;
  /** Aborting kills the current bot and ends the loop without a restart. */
  signal?: AbortSignal;
  onStart?: (n: number, pid: number) => void;
  onKilled?: (k: Killed) => void;
  onRestart?: (n: number, delayMs: number) => void;
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
  for (let n = 1; ; n++) {
    if (o.signal?.aborted) return { starts: n - 1, kills, exit: { code: null, signal: null }, clean: false };
    const proc = new BotProcess(o.command, o.args, o.env);
    const onAbort = () => proc.kill();
    o.signal?.addEventListener('abort', onAbort, { once: true });
    o.onStart?.(n, proc.pid);
    let killed: Killed | null = null;
    serveRendezvous(proc, o.director, o.lane, (k) => { killed = k; });
    await proc.waitFor('ready');
    proc.send({ k: 'go', arms: o.director.pendingArms(o.lane) });
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
