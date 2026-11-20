// Live ramp runner adapter: drives N concurrent lanes of the bot with no chaos and measures per-order latency.
import { mkdirSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ChaosDirector } from '../chaos';
import { lanePaths, prepareLane, runLane } from '../runner';
import type { RampStepRun, RunRampStep } from './executor';

export interface LiveRampRunnerOptions {
  /** Process that runs the bot, e.g. process.execPath. */
  command: string;
  args: string[];
  /** Scratch directory; each step gets its own subfolder. */
  runDir: string;
  env?: Record<string, string>;
  now?: () => number;
}

/**
 * Builds a RunRampStep: `concurrency` lanes run in parallel, each with its share of the orders.
 * Latency is the time from step start until the order file lands in the lane's `done/` folder.
 * Orders left in `failed/` or never finished count as failed.
 */
export function createLiveRampRunner(o: LiveRampRunnerOptions): RunRampStep {
  const now = o.now ?? Date.now;
  mkdirSync(o.runDir, { recursive: true });
  const base = mkdtempSync(join(o.runDir, 'ramp-'));
  let stepNo = 0;
  return async (concurrency: number, orders: number, seed: number): Promise<RampStepRun> => {
    const dir = join(base, `step-${++stepNo}`);
    const lanes = Math.max(1, Math.floor(concurrency));
    const share = Array.from({ length: lanes }, (_, i) => Math.floor(orders / lanes) + (i < orders % lanes ? 1 : 0));
    const prepared = share.map((n, i) => prepareLane(dir, i + 1, `${seed}-${i}`, n));
    const t0 = now();
    await Promise.all(prepared.map(async (p, i) => {
      const director = new ChaosDirector();
      director.addLane(`L${i + 1}`, []);
      await runLane({
        lane: `L${i + 1}`, director, command: o.command, args: o.args, maxStarts: 1,
        env: { ...o.env, HAUNT_DIR: p.paths.root, HAUNT_LANE: `L${i + 1}` },
      });
    }));
    const durationMs = now() - t0;
    const latenciesMs: number[] = [];
    for (let i = 0; i < lanes; i++) {
      const done = lanePaths(dir, i + 1).done;
      for (const f of readdirSync(done)) latenciesMs.push(Math.max(0, statSync(join(done, f)).mtimeMs - t0));
    }
    return { latenciesMs, failed: Math.max(0, orders - latenciesMs.length), durationMs };
  };
}
