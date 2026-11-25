// Own-bot quickstart (.kiro/specs/own-bot-quickstart): turns `npm run own-bot -- <path-or-command>` into a bot command for every lane.
import { existsSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { findPython } from './inbox-command';

export type OwnBot = { ok: true; command: string; args: string[] } | { ok: false; error: string };

export interface OwnBotDeps {
  cwd?: string;
  exists?: (p: string) => boolean;
  python?: () => string | undefined;
}

/** Splits a command line on spaces, keeping "double quoted" parts together. */
export function splitCommand(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]!);
}

/**
 * A path to a `.mjs`, `.js` or `.py` file runs with node or python. Anything else is a command line (`"deno run bot.ts"`, `./my-bot`),
 * whose first word must be an existing file or a command found by the shell later. A path that looks like a file and is missing is refused.
 */
export function resolveOwnBot(arg: string | undefined, deps: OwnBotDeps = {}): OwnBot {
  const text = (arg ?? '').trim();
  if (!text) return { ok: false, error: 'usage: npm run own-bot -- <path-to-bot | "command line">' };
  const cwd = deps.cwd ?? process.cwd();
  const exists = deps.exists ?? existsSync;
  const abs = resolve(cwd, text);
  const ext = extname(text).toLowerCase();
  if (['.mjs', '.js', '.cjs', '.py'].includes(ext)) {
    if (!exists(abs)) return { ok: false, error: `no such file: ${abs}` };
    if (ext === '.py') {
      const py = (deps.python ?? findPython)();
      return py ? { ok: true, command: py, args: [abs] } : { ok: false, error: 'Python 3.11 or newer was not found on PATH (tried python, python3, py)' };
    }
    return { ok: true, command: process.execPath, args: [abs] };
  }
  const words = splitCommand(text);
  const [head, ...rest] = words;
  if (!head) return { ok: false, error: 'empty command' };
  // A first word that is a relative or absolute path must exist; a bare word (`deno`, `ruby`) is looked up on PATH when it runs.
  if (/[\\/]/.test(head) && !exists(resolve(cwd, head))) return { ok: false, error: `no such file: ${resolve(cwd, head)}` };
  return { ok: true, command: /[\\/]/.test(head) ? resolve(cwd, head) : head, args: rest };
}
