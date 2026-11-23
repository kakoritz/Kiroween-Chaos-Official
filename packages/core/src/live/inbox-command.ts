// SH-C6: the live runner spawns the Python Haunted Inbox (apps/haunted-inbox/bot) for real when the arena app is `inbox`.
// Same HAUNT_* environment as the TypeScript bots; the lane folder holds the 12-message corpus instead of orders.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Tiers the Python bot knows (haunt_py.TIERS) plus `crew`, which bot/crew.py builds from HAUNT_PARTS. */
export const INBOX_TIERS: readonly string[] = ['rookie', 'retrier', 'journaler', 'reconciler', 'phoenix', 'crew'];

let cached: string | null | undefined;

/** Python 3.11+ on PATH (`python`, `python3` or `py`), or undefined. Looked up once. */
export function findPython(): string | undefined {
  if (cached !== undefined) return cached ?? undefined;
  cached = null;
  for (const c of ['python', 'python3', 'py']) {
    try {
      const v = execFileSync(c, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      if (/Python 3\.(1[1-9]|[2-9]\d)/.test(v)) { cached = c; break; }
    } catch { /* try the next one */ }
  }
  return cached ?? undefined;
}

export interface InboxTarget { command: string; script: string; corpus: string }

/** Where the live runner finds the Python inbox, or undefined when the app or Python is missing or the tier is unknown. */
export function inboxTarget(root: string, tierId: string): InboxTarget | undefined {
  if (!INBOX_TIERS.includes(tierId)) return undefined;
  const dir = join(root, 'apps', 'haunted-inbox');
  const script = join(dir, 'bot', tierId === 'crew' ? 'crew.py' : 'run.py');
  const corpus = join(dir, 'data', 'emails.json');
  if (!existsSync(script) || !existsSync(corpus)) return undefined;
  const command = findPython();
  return command ? { command, script, corpus } : undefined;
}

/** Overwrites `ord-0001.json ...` in a lane folder with the corpus messages, the same files make_inbox.py writes. */
export function writeInboxMail(ordersDir: string, count: number, corpusFile: string): void {
  const corpus = JSON.parse(readFileSync(corpusFile, 'utf8')) as Record<string, unknown>[];
  if (corpus.length === 0) return;
  for (let i = 1; i <= count; i++) {
    // A corpus that cycles gets a new external id each time round (the same text is a new request, not a webhook retry).
    const base = corpus[(i - 1) % corpus.length]!;
    const cycle = Math.floor((i - 1) / corpus.length);
    const mail = cycle > 0 && typeof base.id === 'string' ? { ...base, id: `${base.id}-c${cycle + 1}` } : base;
    writeFileSync(join(ordersDir, `ord-${String(i).padStart(4, '0')}.json`), JSON.stringify(mail));
  }
}

/** The bot command for one inbox lane. `env` is the shared HAUNT_* environment of the lane. */
export function inboxBotCommand(t: InboxTarget, env: Record<string, string>): { command: string; args: string[]; env: Record<string, string> } {
  return { command: t.command, args: [t.script], env: { ...env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } };
}
