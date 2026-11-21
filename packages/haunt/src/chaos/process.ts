// Runner side of the kill rendezvous: a real child process and a real SIGKILL.
// Spec: runtime.md section 1 (spawn process.execPath directly, no shell) and section 3.
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { HookPoint } from '../sdk';
import type { ChaosDirector, Fired } from './director';

export interface Exit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export type BotMessage = Record<string, unknown>;

/** One bot process. Messages are JSON lines: bot to runner on stdout, runner to bot on stdin. */
export class BotProcess {
  private readonly child: ChildProcess;
  readonly exited: Promise<Exit>;
  readonly pid: number;
  private readonly listeners: ((m: BotMessage) => void)[] = [];

  constructor(command: string, args: string[], env: Record<string, string> = {}) {
    // No shell, no npx: the pid we kill is the bot itself, so SIGKILL hits the right process on Windows and Linux.
    this.child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'inherit'],
      windowsHide: true,
      env: { ...process.env, ...env },
    });
    this.pid = this.child.pid ?? -1;
    this.exited = new Promise((res) => this.child.once('exit', (code, signal) => res({ code, signal })));
    this.child.stdin!.on('error', () => {}); // writing to a dead bot is not an error for the runner
    createInterface({ input: this.child.stdout! }).on('line', (line) => {
      let m: BotMessage;
      try {
        m = JSON.parse(line) as BotMessage;
      } catch {
        return; // not a protocol line
      }
      for (const l of [...this.listeners]) l(m);
    });
  }

  onMessage(fn: (m: BotMessage) => void): void {
    this.listeners.push(fn);
  }

  /** The process is still running, so a message sent now can be heard. */
  get alive(): boolean {
    return this.child.exitCode === null && this.child.signalCode === null;
  }

  send(msg: BotMessage): void {
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.stdin!.write(`${JSON.stringify(msg)}\n`);
  }

  /** Next message with this `k`. */
  waitFor(k: string, timeoutMs = 5000): Promise<BotMessage> {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`timed out waiting for ${k}`)), timeoutMs);
      const fn = (m: BotMessage) => {
        if (m.k !== k) return;
        clearTimeout(t);
        this.listeners.splice(this.listeners.indexOf(fn), 1);
        res(m);
      };
      this.listeners.push(fn);
    });
  }

  /** Real kill: immediate TerminateProcess on Windows, SIGKILL elsewhere. */
  kill(): void {
    this.child.kill('SIGKILL');
  }
}

export interface Killed {
  fired: Fired;
  exit: Exit;
}

/**
 * Wire a process to the director. On `at_point` the director decides whether the armed crash fires;
 * if so the process is SIGKILLed and the result says when to restart it. The runner owns the restart timer.
 */
export function serveRendezvous(
  proc: BotProcess, director: ChaosDirector, lane: string, onKilled: (k: Killed) => void,
): void {
  proc.onMessage((m) => {
    if (m.k !== 'at_point') return;
    const fired = director.onAtPoint(lane, m.point as HookPoint);
    if (!fired) {
      proc.send({ k: 'proceed' });
      return;
    }
    proc.kill();
    void proc.exited.then((exit) => onKilled({ fired, exit }));
  });
}
