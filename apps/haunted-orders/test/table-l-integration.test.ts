// PT-C9 / P17, integration mode: table L rows that need the bot runtime (L3 degrades, L7 parks) run against the real bot bundles
// and must agree with the outcome table in shared/outcomes.ts. Timing-sensitive, so a modest speed and two tiers.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startProvider } from '../../../packages/core/src/provider';
import { CORE_CREATURES, EXTRA_CREATURES } from '../../../packages/haunt/src/creatures';
import { resolveOutcome } from '../../../packages/haunt/src/shared/outcomes';
import { createLiveCellRunner } from '../../../packages/haunt/src/sweep';

const root = resolve(__dirname, '../../..');
const creatures = [...CORE_CREATURES, ...EXTRA_CREATURES];
const ROWS = [
  { id: 'L3', creature: 'goblin', fault: 'updates_down', stage: 'updates' },
  { id: 'L7', creature: 'phantom_car', fault: 'car_accident', stage: 'handoff' },
] as const;
const PASSING = new Set(['pass', 'recovered_late']);

let prov: Awaited<ReturnType<typeof startProvider>>;
const runDir = mkdtempSync(join(tmpdir(), 'haunt-table-l-'));
beforeAll(async () => {
  execFileSync(process.execPath, [join(root, 'tools/build-bots.mjs')], { cwd: root, stdio: 'pipe' });
  prov = await startProvider({ port: 0 });
}, 60000);
afterAll(async () => {
  await prov?.close();
  rmSync(runDir, { recursive: true, force: true });
});

describe('table L in integration mode (P17)', () => {
  for (const row of ROWS) {
    for (const tier of ['rookie', 'phoenix'] as const) {
      it(`${row.id} ${row.fault} at ${row.stage}, ${tier}: the live bot agrees with the outcome table`, async () => {
        const run = createLiveCellRunner({
          command: process.execPath, args: [join(root, 'dist/bots', `${tier}.js`)], runDir, tier, orders: 1, speed: 2, creatures,
          provider: {
            url: prov.url,
            reset: () => prov.provider.reset(),
            ledger: (lane) => prov.provider.ledger(lane),
            post: async (body) => { prov.provider.addFault(body); },
          },
        });
        const out = await run({ stage: row.stage, creature: row.creature, fault: row.fault }, 1);
        const outcome = typeof out === 'string' ? out : out.outcome;
        const want = resolveOutcome('orders', tier, row.fault, row.stage)!.outcome;
        expect(PASSING.has(outcome)).toBe(want !== 'FAILED');
      }, 90000);
    }
  }
});
