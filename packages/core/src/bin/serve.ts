// H7: `haunt serve [--port 7070] [--mode live|mock]`. A thin wrapper: starts `npm run live` (default) or `npm run mock` on 127.0.0.1.
import { spawn } from 'node:child_process';
import { join } from 'node:path';

export interface ServePlan { script: string; args: string[]; env: Record<string, string> }

/** The child to run, or an error message. `live` takes the port as HAUNT_PORT, `mock` as PORT. */
export function planServe(argv: string[], root: string): ServePlan | { error: string } {
  const val = (n: string): string | undefined => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const mode = val('--mode') ?? 'live';
  if (mode !== 'live' && mode !== 'mock') return { error: '--mode: one of live | mock' };
  const portRaw = val('--port');
  if (portRaw !== undefined && !(Number.isInteger(Number(portRaw)) && Number(portRaw) >= 0 && Number(portRaw) < 65536)) return { error: '--port: a number from 0 to 65535' };
  const script = join(root, 'packages', 'core', 'src', 'bin', `${mode}.ts`);
  const env: Record<string, string> = portRaw === undefined ? {} : mode === 'live' ? { HAUNT_PORT: portRaw } : { PORT: portRaw };
  return { script, args: [join(root, 'tools', 'run-ts.mjs'), script], env };
}

export async function serveCommand(argv: string[], root: string): Promise<number> {
  const plan = planServe(argv, root);
  if ('error' in plan) { console.error(plan.error); return 2; }
  const child = spawn(process.execPath, plan.args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...plan.env } });
  const fwd = (sig: NodeJS.Signals) => () => { child.kill(sig); };
  process.on('SIGINT', fwd('SIGINT'));
  process.on('SIGTERM', fwd('SIGTERM'));
  return new Promise((done) => {
    child.on('error', (e) => { console.error(String(e)); done(3); });
    child.on('close', (code) => done(code ?? 0));
  });
}
