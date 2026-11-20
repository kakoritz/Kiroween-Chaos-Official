// Process adapter (H3.7): starts any CLI or worker from the haunt.yaml `start` line, SIGKILLs it, restarts it, and
// feeds and removes input files. No shell: the pid we kill is the process itself.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';

export interface ProcessExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface ProcessAdapterOptions {
  /** The `start` command line from haunt.yaml. */
  start: string;
  cwd?: string;
  env?: Record<string, string>;
  /** Folder the process reads (`inputs` in haunt.yaml). Created on demand. */
  inputDir?: string;
}

/** Split a command line into argv. Supports single and double quotes; no shell expansion. */
export function parseCommandLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let has = false;
  for (const ch of line.trim()) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || cur) out.push(cur);
      cur = '';
      has = false;
    } else cur += ch;
  }
  if (quote) throw new Error('unterminated quote in start command');
  if (has || cur) out.push(cur);
  if (out.length === 0) throw new Error('empty start command');
  return out;
}

export class ProcessAdapter {
  private child: ChildProcess | undefined;
  private exitPromise: Promise<ProcessExit> | undefined;
  private lines: string[] = [];
  private starts = 0;

  constructor(private readonly opts: ProcessAdapterOptions) {}

  get running(): boolean {
    return !!this.child && this.child.exitCode === null && this.child.signalCode === null;
  }

  get pid(): number {
    return this.child?.pid ?? -1;
  }

  /** How many times the process has been started (1 after start, +1 per restart). */
  get startCount(): number {
    return this.starts;
  }

  /** Resolves when the current process exits. */
  get exited(): Promise<ProcessExit> {
    if (!this.exitPromise) throw new Error('process was never started');
    return this.exitPromise;
  }

  /** Captured stdout lines across all runs. */
  output(): string[] {
    return [...this.lines];
  }

  start(): void {
    if (this.running) throw new Error('already running');
    const [cmd, ...args] = parseCommandLine(this.opts.start);
    const child = spawn(cmd, args, {
      cwd: this.opts.cwd,
      env: { ...process.env, ...this.opts.env },
      stdio: ['ignore', 'pipe', 'inherit'],
      windowsHide: true,
    });
    this.child = child;
    this.starts++;
    let buf = '';
    child.stdout!.on('data', (d: Buffer) => {
      buf += d.toString();
      const parts = buf.split(/\r?\n/);
      buf = parts.pop() ?? '';
      this.lines.push(...parts);
    });
    this.exitPromise = new Promise((res) => {
      child.once('error', () => res({ code: -1, signal: null }));
      child.once('exit', (code, signal) => {
        if (buf) this.lines.push(buf);
        res({ code, signal });
      });
    });
  }

  /** Real kill: immediate TerminateProcess on Windows, SIGKILL elsewhere. Resolves with the exit. */
  async kill(): Promise<ProcessExit> {
    if (!this.running) return this.exited;
    this.child!.kill('SIGKILL');
    return this.exited;
  }

  /** Kill (if running), wait `delayMs`, start again. */
  async restart(delayMs = 0): Promise<void> {
    if (this.running) await this.kill();
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    this.start();
  }

  /** Write an input file into the input folder. `name` is reduced to its base name. Returns the path. */
  feedInput(name: string, content: string): string {
    const path = this.inputPath(name);
    writeFileSync(path, content);
    return path;
  }

  /** Remove an input file (the missing-file fault). Missing files are not an error. */
  removeInput(name: string): void {
    rmSync(this.inputPath(name), { force: true });
  }

  private inputPath(name: string): string {
    if (!this.opts.inputDir) throw new Error('no inputDir configured');
    mkdirSync(this.opts.inputDir, { recursive: true });
    return join(this.opts.inputDir, basename(name));
  }
}
