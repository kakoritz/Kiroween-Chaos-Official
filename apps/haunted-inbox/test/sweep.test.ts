// H3.8: the sweep's live cell runner drives the Python inbox through its haunt.yaml start line (127.0.0.1 only).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startProvider } from '../../../packages/core/src/provider';
import { parseCommandLine } from '../../../packages/haunt/src/adapters';
import { loadHauntConfig } from '../../../packages/haunt/src/config';
import { CORE_CREATURES, EXTRA_CREATURES } from '../../../packages/haunt/src/creatures';
import { createLiveCellRunner, planSweep } from '../../../packages/haunt/src/sweep';
import { pyTest } from '../../../packages/core/test/python-skip';

const root = resolve(__dirname, '../../..');
const app = join(root, 'apps/haunted-inbox');

function findPython(): string | null {
  for (const c of ['python', 'python3', 'py']) {
    try {
      const v = execFileSync(c, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      if (/Python 3\.(1[1-9]|[2-9]\d)/.test(v)) return c;
    } catch { /* try the next one */ }
  }
  return null;
}
const py = findPython();
const pyIt = pyTest(py);
const creatures = [...CORE_CREATURES, ...EXTRA_CREATURES];

describe('sweep over the Python inbox', () => {
  it('plans cells on the inbox stages from haunt.yaml', () => {
    const r = loadHauntConfig(join(app, 'haunt.yaml'));
    if (!r.ok) throw new Error('config invalid');
    const plan = planSweep(r.config, creatures);
    expect(plan.stages).toEqual(['login', 'ingest', 'validate', 'dedupe', 'triage', 'assign', 'sla', 'notify', 'escalate', 'resolve', 'close']);
    expect(plan.cells.some((c) => c.stage === 'assign' && c.creature === 'reaper')).toBe(true);
  });

  pyIt('a Reaper crash at assign recovers with no repeated ticket (phoenix)', async () => {
    const r = loadHauntConfig(join(app, 'haunt.yaml'));
    if (!r.ok) throw new Error('config invalid');
    const [, ...args] = parseCommandLine(r.config.start);
    const prov = await startProvider({ port: 0 });
    const runDir = mkdtempSync(join(tmpdir(), 'haunt-inbox-sweep-'));
    try {
      const run = createLiveCellRunner({
        command: py!, args: args.map((a) => join(app, a)), runDir, tier: 'phoenix', orders: 2, speed: 8,
        app: r.config.name,
        seedInput: (dir, count) => { execFileSync(py!, [join(app, 'bot/make_inbox.py'), dir, String(count)]); },
        creatures,
        provider: {
          url: prov.url,
          reset: () => prov.provider.reset(),
          ledger: (lane) => prov.provider.ledger(lane),
          post: async (body) => { prov.provider.addFault(body); },
        },
      });
      const out = await run({ stage: 'assign', creature: 'reaper', fault: 'crash' }, 1);
      expect(typeof out === 'string' ? out : out.outcome).toBe('pass');
    } finally {
      await prov.close();
      rmSync(runDir, { recursive: true, force: true });
    }
  }, 60000);
});
