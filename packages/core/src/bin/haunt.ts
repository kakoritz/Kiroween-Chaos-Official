// `npm run haunt -- sweep [--tier rookie] [--seed 1] [--orders 2] [--speed 4] [--config path] [--bot path] [--out dir]`
// Runs one creature fault per stage against a built bot (npm run build:bots) and a local provider on 127.0.0.1,
// prints the coverage matrix and the grade, and writes a deterministic report JSON.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadHauntConfig } from '../../../haunt/src/config';
import { CORE_CREATURES, EXTRA_CREATURES } from '../../../haunt/src/creatures';
import { planSweep, renderMatrix, runSweep, sweepReportJson, createLiveCellRunner, type RunCell } from '../../../haunt/src/sweep';
import { startProvider } from '../provider/server';

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (name: string, def?: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : def;
};

async function sweep(): Promise<number> {
  const tier = opt('tier', 'phoenix')!;
  const seed = Number(opt('seed', '1'));
  const orders = Number(opt('orders', '2'));
  const speed = Number(opt('speed', '4'));
  if (![seed, orders, speed].every((n) => Number.isFinite(n) && n > 0)) { console.error('seed, orders and speed must be positive numbers'); return 2; }
  const root = process.cwd();
  const configPath = resolve(opt('config', join(root, 'apps', 'haunted-orders', 'haunt.yaml'))!);
  const bot = resolve(opt('bot', join(root, 'dist', 'bots', `${tier}.js`))!);
  const outDir = resolve(opt('out', join(root, '.haunt', 'sweeps'))!);
  const loaded = loadHauntConfig(configPath);
  if (!loaded.ok) { console.error(`config errors:\n${loaded.errors.join('\n')}`); return 2; }
  const creatures = [...CORE_CREATURES, ...EXTRA_CREATURES];
  const plan = planSweep(loaded.config, creatures, { catalogStages: true });

  const prov = await startProvider({ port: 0 });
  const runDir = join(root, '.haunt', 'sweep-run', `${tier}-${process.pid}`);
  try {
    const live = createLiveCellRunner({
      command: process.execPath, args: [bot], runDir, tier, orders, speed, cellTimeoutMs: Number(opt('cell-timeout', '30000')),
      recoverMs: loaded.config.targets.recoverMs,
      creatures,
      provider: {
        url: prov.url,
        reset: () => prov.provider.reset(),
        ledger: (lane) => prov.provider.ledger(lane),
        post: async (body) => { prov.provider.addFault(body); },
      },
    });
    const runCell: RunCell = async (cell, s) => {
      const r = await live(cell, s);
      console.error(`${cell.stage}/${cell.creature}: ${typeof r === 'string' ? r : r.outcome}`);
      return r;
    };
    const report = await runSweep(plan, runCell, seed);
    console.log(renderMatrix(report.matrix));
    console.log(`grade ${report.grade} (reliability ${report.reliability}), seed ${seed}, tier ${tier}`);
    mkdirSync(outDir, { recursive: true });
    const file = join(outDir, `sweep-${tier}-seed${seed}.json`);
    writeFileSync(file, sweepReportJson(report));
    console.log(`report ${file}`);
    return 0;
  } finally {
    await prov.close();
    rmSync(runDir, { recursive: true, force: true });
  }
}

if (cmd === 'sweep') {
  process.exitCode = await sweep();
} else {
  console.log(`usage: npm run haunt -- sweep [--tier rookie|retrier|journaler|reconciler|phoenix] [--seed N] [--orders N] [--speed N] [--config path] [--bot path] [--out dir]`);
  process.exitCode = cmd ? 2 : 0;
}
